import { Body, Controller, Get, NotFoundException, Param, Post, Put, HttpCode } from "@nestjs/common";
import type { Prisma, Role as DbRole } from "@prisma/client";
import { STRATEGIES, pickAssignee, type Strategy } from "@solarcrm/shared";
import { z } from "zod";
import { AuditService } from "../common/audit.service";
import { CurrentUser, RequireModule, type AuthUser } from "../common/auth-context";
import { parse, RuleViolation } from "../common/validation";
import { PrismaService } from "../prisma.service";
import { AutomationService } from "./automation.service";

const RuleBody = z.object({
  mode: z.enum(["SUGGEST", "AUTO"]).optional(),
  active: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
const PersonBody = z.object({
  awayUntil: z.string().nullable().optional(),
  maxOpen: z.number().int().min(1).max(1000).nullable().optional(),
  territories: z.array(z.string().regex(/^\d{1,6}$/, "Territories are PIN code prefixes")).max(50).optional(),
});

/** Validates rule config per kind so the engine never reads malformed data. */
function checkConfig(kind: string, c: Record<string, unknown>): string[] {
  const e: string[] = [];
  if (kind === "ROUTING" || kind === "ASSIGNMENT") {
    if (!(STRATEGIES as readonly string[]).includes(String(c.strategy))) e.push("Choose a valid strategy.");
  }
  if (kind === "FOLLOW_UP") {
    if (typeof c.title !== "string" || !c.title.trim()) e.push("Follow-up title is required.");
    const o = c.offsetsHours;
    if (!Array.isArray(o) || o.length === 0 || o.length > 10 || o.some((h) => typeof h !== "number" || h <= 0 || h > 24 * 60)) {
      e.push("Follow-up times must be 1–10 positive hour values.");
    }
  }
  if (kind === "SLA") {
    if (typeof c.targetHours !== "number" || c.targetHours <= 0 || c.targetHours > 24 * 90) e.push("SLA target must be between 0 and 2160 hours.");
    if (typeof c.warnPct !== "number" || c.warnPct < 1 || c.warnPct > 99) e.push("Warn threshold must be 1–99%.");
    if (typeof c.escalateTo !== "string") e.push("Choose who to escalate to.");
  }
  return e;
}

/** Addendum FR-A05: rules, dry run, run log and availability. */
@Controller("automation")
@RequireModule("automation")
export class AutomationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly automation: AutomationService,
    private readonly audit: AuditService,
  ) {}

  @Get("rules")
  rules() {
    return this.prisma.automationRule.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }] });
  }

  @Put("rules/:id")
  async update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const b = parse(RuleBody, body);
    const rule = await this.prisma.automationRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException("Rule not found.");
    const config = b.config ? { ...(rule.config as object), ...b.config } : (rule.config as object);
    const errors = checkConfig(rule.kind, config as Record<string, unknown>);
    if (errors.length) throw new RuleViolation(errors);
    const updated = await this.prisma.automationRule.update({
      where: { id },
      data: { mode: b.mode, active: b.active, config: config as Prisma.InputJsonValue, version: { increment: 1 } },
    });
    await this.audit.record({
      actorId: user.id, action: "automation.rule_changed", entity: "AutomationRule", entityId: id,
      meta: { from: { mode: rule.mode, active: rule.active, config: rule.config as Prisma.InputJsonValue }, to: { mode: updated.mode, active: updated.active, config: updated.config as Prisma.InputJsonValue } },
    });
    return updated;
  }

  /** Who a routing/assignment rule would pick right now, without changing anything. */
  @Post("rules/:id/dry-run")
  @HttpCode(200)
  async dryRun(@Param("id") id: string) {
    const rule = await this.prisma.automationRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException("Rule not found.");
    if (rule.kind !== "ROUTING" && rule.kind !== "ASSIGNMENT") throw new RuleViolation(["Dry run is available for routing and assignment rules."]);
    const cfg = rule.config as { strategy: Strategy; role?: string; roles?: string[] };
    const roles = rule.kind === "ROUTING" ? ["SALES"] : (cfg.roles ?? [cfg.role!]);
    return Promise.all(
      roles.map(async (role) => {
        const candidates = await this.automation.candidates(role as DbRole);
        const pick = pickAssignee(candidates, cfg.strategy, { now: new Date() });
        return { role, pick, candidates: candidates.map((c) => ({ name: c.name, openLoad: c.openLoad, away: !!(c.awayUntil && c.awayUntil > new Date()), maxOpen: c.maxOpen })) };
      }),
    );
  }

  @Get("runs")
  async runs() {
    const rows = await this.prisma.automationRun.findMany({ orderBy: { at: "desc" }, take: 100, include: { rule: { select: { name: true } } } });
    return rows.map((r) => ({ id: r.id, rule: r.rule?.name ?? "SLA monitor", projectId: r.projectId, outcome: r.outcome, detail: r.detail, at: r.at }));
  }

  @Get("people")
  people() {
    return this.prisma.user.findMany({
      where: { active: true, role: { notIn: ["ADMIN", "CUSTOMER", "SALES_PARTNER"] } },
      select: { id: true, name: true, role: true, awayUntil: true, maxOpen: true, territories: true, lastAssignedAt: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    });
  }

  @Put("people/:id")
  async person(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const b = parse(PersonBody, body);
    if (!(await this.prisma.user.findUnique({ where: { id } }))) throw new NotFoundException("User not found.");
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        awayUntil: b.awayUntil === undefined ? undefined : b.awayUntil ? new Date(b.awayUntil) : null,
        maxOpen: b.maxOpen,
        territories: b.territories,
      },
      select: { id: true, name: true, role: true, awayUntil: true, maxOpen: true, territories: true },
    });
    await this.audit.record({ actorId: user.id, action: "automation.availability_changed", entity: "User", entityId: id, meta: b as Prisma.InputJsonValue });
    return updated;
  }

  /** Runs the SLA check now (the background loop does this every minute). */
  @Post("tick")
  @HttpCode(200)
  async tick() {
    await this.automation.tick();
    return { ok: true };
  }
}
