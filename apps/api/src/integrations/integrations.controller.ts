import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { DISCOM_STATUSES } from "@solarcrm/shared";
import type { Request } from "express";
import { z } from "zod";
import { EventBus } from "../automation/event-bus";
import { Public, RequireModule } from "../common/auth-context";
import { PrismaService } from "../prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { INBOUND, IntegrationsService, OUTBOUND, verify } from "./integrations.service";

// Booklet §6.4 inbound: payment status from the gateway.
const GatewayBody = z.object({
  project_id: z.string().optional(),
  amount: z.coerce.number().positive(),
  utr: z.string().trim().min(1).max(60),
  status: z.enum(["success", "failed"]),
  timestamp: z.string().optional(),
});
// Booklet §8.2 inbound: DISCOM status update.
const DiscomBody = z.object({
  project_id: z.string().regex(/^SLR-\d{4}-\d{1,7}$/),
  discom_application_no: z.string().trim().min(1).max(60),
  status: z.string().trim().min(1).max(60),
  meter_number: z.string().trim().max(60).optional(),
  updated_on: z.string().optional(),
});

/** Map external DISCOM wording to our status list; unknown values are logged and ignored. */
const DISCOM_MAP: Record<string, (typeof DISCOM_STATUSES)[number]> = {
  submitted: "SUBMITTED", "under review": "UNDER_REVIEW", returned: "RETURNED", "returned for correction": "RETURNED",
  "meter approved": "METER_APPROVED", "meter installed": "METER_INSTALLED", "final approved": "FINAL_APPROVED", approved: "FINAL_APPROVED",
};

@Controller("integrations")
export class IntegrationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly projects: ProjectsService,
    private readonly bus: EventBus,
  ) {}

  /**
   * Signed webhooks from external systems (Booklet §7, §10): HMAC-SHA256 of
   * the raw body with the connector's shared secret in `x-solarcrm-signature`.
   * Manual screens keep working; a webhook only fills in what a person would.
   */
  @Public()
  @Post("inbound/:connector")
  @HttpCode(200)
  async inbound(@Param("connector") connector: string, @Req() req: Request & { rawBody?: Buffer }, @Body() body: unknown) {
    const cfg = INBOUND[connector];
    if (!cfg) throw new NotFoundException();
    const secret = process.env[cfg.env];
    const sig = req.headers["x-solarcrm-signature"] as string | undefined;
    if (!secret || !req.rawBody || !verify(secret, req.rawBody, sig)) {
      await this.integrations.log(connector, "INBOUND", "rejected", "401", { reason: secret ? "bad signature" : "connector not configured" });
      throw new UnauthorizedException();
    }

    if (connector === "payment-gateway") {
      const parsed = GatewayBody.safeParse(body);
      if (!parsed.success) return this.bad(connector, parsed.error.issues);
      const b = parsed.data;
      if (b.status === "success") {
        // Treated as bank evidence for reconciliation; Accounts still approves (FR-010).
        const imp = await this.prisma.bankStatementImport.create({ data: { fileName: "payment-gateway", uploadedById: "system", lineCount: 1 } });
        await this.prisma.bankStatementLine.createMany({
          data: [{ importId: imp.id, txnDate: new Date(b.timestamp ?? Date.now()), amount: b.amount, reference: b.utr, narration: `Gateway ${b.project_id ?? ""}`.trim() }],
          skipDuplicates: true,
        });
      }
      await this.integrations.log(connector, "INBOUND", `payment.${b.status}`, "200", { utr: b.utr, amount: b.amount });
      return { ok: true };
    }

    // DISCOM
    const parsed = DiscomBody.safeParse(body);
    if (!parsed.success) return this.bad(connector, parsed.error.issues);
    const b = parsed.data;
    const status = DISCOM_MAP[b.status.toLowerCase()];
    const seq = Number(b.project_id.split("-")[2]);
    const p = await this.prisma.project.findUnique({ where: { seq }, include: { discom: true } });
    if (!p?.discom || p.discom.applicationNo !== b.discom_application_no) {
      await this.integrations.log(connector, "INBOUND", "discom.unmatched", "404", { project_id: b.project_id, application: b.discom_application_no });
      throw new NotFoundException("No matching DISCOM application.");
    }
    if (!status) {
      await this.integrations.log(connector, "INBOUND", "discom.unknown_status", "422", { status: b.status }, p.id);
      return { ok: false, error: "Unknown status" };
    }
    if (status === "FINAL_APPROVED") {
      if (b.meter_number) await this.prisma.discomApplication.update({ where: { projectId: p.id }, data: { meterNumber: b.meter_number } });
      try {
        await this.projects.completeStageAsSystem(p.id, "FINAL_DISCOM_APPROVED", { finalApprovalDate: b.updated_on });
      } catch (e) {
        // e.g. installation not complete yet: record the status, a person completes it later.
        await this.prisma.discomApplication.update({ where: { projectId: p.id }, data: { status: "METER_APPROVED", updatedById: "system" } });
        await this.integrations.log(connector, "INBOUND", "discom.final_deferred", "202", { reason: (e as Error).message }, p.id);
        return { ok: true, deferred: true };
      }
    } else {
      await this.prisma.discomApplication.update({
        where: { projectId: p.id },
        data: { status, meterNumber: b.meter_number ?? p.discom.meterNumber, updatedById: "system" },
      });
      this.bus.emit("track.updated", { projectId: p.id, kind: "DISCOM", status });
    }
    await this.integrations.log(connector, "INBOUND", "discom.status", "200", { status }, p.id);
    return { ok: true };
  }

  private async bad(connector: string, issues: unknown) {
    await this.integrations.log(connector, "INBOUND", "invalid", "400", { issues: JSON.parse(JSON.stringify(issues)) });
    return { ok: false, error: "Invalid payload" };
  }

  /** Admin view: which connectors are configured, outbox state and the call log. */
  @Get("status")
  @RequireModule("settings")
  async status() {
    const [outbox, log] = await Promise.all([
      this.prisma.integrationOutbox.groupBy({ by: ["connector", "status"], _count: true }),
      this.prisma.integrationLog.findMany({ orderBy: { at: "desc" }, take: 50 }),
    ]);
    return {
      inbound: Object.entries(INBOUND).map(([key, c]) => ({ key, label: c.label, configured: !!process.env[c.env], url: `/api/integrations/inbound/${key}` })),
      outbound: Object.entries(OUTBOUND).map(([key, c]) => ({
        key, label: c.label, configured: !!process.env[c.env],
        counts: Object.fromEntries(outbox.filter((o) => o.connector === key).map((o) => [o.status, o._count])),
      })),
      log,
    };
  }

  @Post("deliver")
  @HttpCode(200)
  @RequireModule("settings")
  async deliver() {
    await this.integrations.deliver();
    return { ok: true };
  }
}
