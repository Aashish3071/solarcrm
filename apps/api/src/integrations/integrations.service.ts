import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createHmac, timingSafeEqual } from "node:crypto";
import { EventBus } from "../automation/event-bus";
import { PrismaService } from "../prisma.service";
import { projectCode } from "../projects/projects.service";

const MAX_ATTEMPTS = 5;
const TICK_MS = Number(process.env.INTEGRATION_TICK_MS ?? 30_000);

/** Outbound connectors and where they post (Booklet §6.7, §7). Unset URL → entries are SKIPPED. */
export const OUTBOUND: Record<string, { env: string; label: string }> = {
  accounting: { env: "ACCOUNTING_WEBHOOK_URL", label: "Accounting (Tally / Zoho Books / QuickBooks via integration layer)" },
};

/** Inbound connectors: shared secret per connector for HMAC-SHA256 signatures (Booklet §10). */
export const INBOUND: Record<string, { env: string; label: string }> = {
  "payment-gateway": { env: "INTEGRATION_SECRET_PAYMENT_GATEWAY", label: "Payment gateway (Razorpay / PayU / Cashfree)" },
  discom: { env: "INTEGRATION_SECRET_DISCOM", label: "DISCOM status updates" },
};

export function sign(secret: string, body: Buffer | string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verify(secret: string, body: Buffer, signature: string | undefined) {
  if (!signature) return false;
  const expected = Buffer.from(sign(secret, body), "hex");
  const got = Buffer.from(signature.replace(/^sha256=/, ""), "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/**
 * Integration layer inside the API (Booklet §7): logs every call, keeps one
 * connector's failure from affecting others, and delivers outbound events with
 * retries. CRM stays the source of truth; accounting sync is one-way (§6.7).
 */
@Injectable()
export class IntegrationsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
  ) {}

  onModuleInit() {
    // Verified payments and calculated incentives go to accounting (Booklet §7 data-flow table).
    this.bus.on("payment.decided", async ({ projectId, paymentId, approved }) => {
      if (!approved) return;
      const pay = await this.prisma.payment.findUnique({ where: { id: paymentId } });
      if (pay) await this.paymentEntry(projectId, pay.id);
    });
    this.bus.on("stages.changed", async ({ projectId, completedBefore }) => {
      const p = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (!p) return;
      const done = p.completedStages.filter((s) => !completedBefore.includes(s as never));
      if (done.includes("PAYMENT_VERIFIED")) {
        const adv = await this.prisma.payment.findFirst({ where: { projectId, kind: "ADVANCE", status: "APPROVED" }, orderBy: { verifiedAt: "desc" } });
        if (adv) await this.paymentEntry(projectId, adv.id);
      }
      if (done.includes("INCENTIVE_CALCULATED")) {
        const r = await this.prisma.incentiveResult.findUnique({ where: { projectId } });
        if (r) {
          await this.enqueue("accounting", "INCENTIVE_PAYOUT", projectId, `inc:${projectId}`, {
            project_id: projectCode(p),
            order_value: r.orderValue.toString(),
            sales_incentive: r.incentiveAmount.toString(),
            partner_commission: r.partnerCommissionAmount.toString(),
            provisional: r.provisional,
          });
        }
      }
    });
    if (process.env.INTEGRATION_TICK !== "off") {
      this.timer = setInterval(() => this.deliver().catch((e) => console.error("[integrations] delivery failed", e)), TICK_MS);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async paymentEntry(projectId: string, paymentId: string) {
    const pay = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { project: true } });
    if (!pay || pay.status !== "APPROVED") return;
    await this.enqueue("accounting", "PAYMENT_RECEIVED", projectId, `pay:${pay.id}`, {
      project_id: projectCode(pay.project),
      customer: pay.project.customerName,
      kind: pay.kind,
      amount: pay.amount.toString(),
      payment_mode: pay.mode,
      utr_number: pay.utr,
      verified_at: pay.verifiedAt?.toISOString() ?? null,
    });
  }

  enqueue(connector: string, event: string, projectId: string | null, dedupeKey: string, payload: Prisma.InputJsonValue) {
    return this.prisma.integrationOutbox.upsert({ where: { dedupeKey }, update: {}, create: { connector, event, projectId, payload, dedupeKey } });
  }

  log(connector: string, direction: "INBOUND" | "OUTBOUND", event: string, status: string, summary: Prisma.InputJsonValue, projectId?: string | null) {
    return this.prisma.integrationLog.create({ data: { connector, direction, event, status, summary, projectId: projectId ?? null } });
  }

  async deliver() {
    const queued = await this.prisma.integrationOutbox.findMany({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, take: 50 });
    for (const item of queued) {
      const url = process.env[OUTBOUND[item.connector]?.env ?? ""];
      if (!url) {
        await this.prisma.integrationOutbox.update({ where: { id: item.id }, data: { status: "SKIPPED", error: "Connector not configured (open point 14)." } });
        continue;
      }
      const body = JSON.stringify({ event: item.event, data: item.payload });
      const secret = process.env[`${OUTBOUND[item.connector].env}_SECRET`];
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": item.dedupeKey, ...(secret ? { "x-solarcrm-signature": `sha256=${sign(secret, body)}` } : {}) },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        await this.log(item.connector, "OUTBOUND", item.event, String(res.status), { dedupeKey: item.dedupeKey }, item.projectId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await this.prisma.integrationOutbox.update({ where: { id: item.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } } });
      } catch (e) {
        const attempts = item.attempts + 1;
        await this.prisma.integrationOutbox.update({
          where: { id: item.id },
          data: { attempts, status: attempts >= MAX_ATTEMPTS ? "FAILED" : "QUEUED", error: String((e as Error).message).slice(0, 300) },
        });
      }
    }
  }
}
