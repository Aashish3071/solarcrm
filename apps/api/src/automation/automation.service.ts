import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { AutomationRule, Prisma, Project, Role as DbRole } from "@prisma/client";
import {
  ASSIGNMENT_STAGES,
  STAGE_DEFS,
  availableStages,
  pickAssignee,
  responsibleRole,
  slaState,
  type Candidate,
  type Role,
  type Stage,
  type Strategy,
} from "@solarcrm/shared";
import { AuditService } from "../common/audit.service";
import { PrismaService } from "../prisma.service";
import { ProjectsService, projectCode } from "../projects/projects.service";
import { EventBus } from "./event-bus";

const HOUR = 3600_000;
const TICK_MS = Number(process.env.AUTOMATION_TICK_MS ?? 60_000);

const openStages = (p: Project) =>
  availableStages({ completed: p.completedStages as Stage[], skipped: p.skippedStages as Stage[], loanRequired: p.loanRequired });

/**
 * Addendum FR-A01 – A05. Reacts to workflow events and runs a periodic SLA
 * check. Every decision is written to AutomationRun; suggestions become tasks
 * a person applies, so nothing is assigned silently in SUGGEST mode.
 */
@Injectable()
export class AutomationService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {}

  onModuleInit() {
    this.bus.on("lead.created", ({ projectId }) => this.onLeadCreated(projectId));
    this.bus.on("stages.changed", ({ projectId, openBefore }) => this.onStagesChanged(projectId, openBefore));
    if (process.env.AUTOMATION_TICK !== "off") {
      this.timer = setInterval(() => this.tick().catch((e) => console.error("[automation] tick failed", e)), TICK_MS);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private rules(kind: AutomationRule["kind"], trigger: string) {
    return this.prisma.automationRule.findMany({ where: { kind, trigger, active: true } });
  }

  private log(rule: AutomationRule | null, projectId: string | null, outcome: string, detail: Prisma.InputJsonValue) {
    return this.prisma.automationRun.create({ data: { ruleId: rule?.id ?? null, projectId, outcome, detail } });
  }

  /** Open work per person, used by least-load and capacity checks. */
  async candidates(role: DbRole): Promise<Candidate[]> {
    const users = await this.prisma.user.findMany({ where: { role, active: true } });
    const open = { NOT: { completedStages: { has: "INCENTIVE_CALCULATED" } } };
    return Promise.all(
      users.map(async (u) => ({
        id: u.id,
        name: u.name,
        openLoad:
          role === "SALES"
            ? await this.prisma.project.count({ where: { ownerId: u.id, ...open } })
            : await this.prisma.projectAssignment.count({ where: { userId: u.id, role, project: open } }),
        lastAssignedAt: u.lastAssignedAt,
        awayUntil: u.awayUntil,
        maxOpen: u.maxOpen,
        territories: u.territories,
      })),
    );
  }

  /** Person who owns a stage: project owner for Sales stages, else the assigned person, else the role queue. */
  private async responsible(p: Project, stage: Stage): Promise<{ ownerId: string | null; ownerRole: string }> {
    const role = responsibleRole(stage);
    if (!role) return { ownerId: null, ownerRole: "ADMIN" };
    if (role === "SALES") return { ownerId: p.ownerId, ownerRole: "SALES" };
    const a = await this.prisma.projectAssignment.findUnique({ where: { projectId_role: { projectId: p.id, role: role as DbRole } } });
    return { ownerId: a?.userId ?? null, ownerRole: role };
  }

  // ---------------------------------------------------------------- routing
  async onLeadCreated(projectId: string) {
    const p = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!p) return;
    for (const rule of await this.rules("ROUTING", "LEAD_CREATED")) {
      const cfg = rule.config as { strategy: Strategy; onlyPartnerLeads?: boolean };
      if (cfg.onlyPartnerLeads && p.leadSource !== "SALES_PARTNER") continue;
      const pick = pickAssignee(await this.candidates("SALES"), cfg.strategy, { now: new Date(), address: p.address });
      if (rule.mode === "AUTO" && pick.userId) {
        await this.setOwner(p.id, pick.userId, null, `Rule "${rule.name}": ${pick.reason}`);
        await this.log(rule, p.id, "ASSIGNED", { ownerId: pick.userId, reason: pick.reason });
      } else {
        await this.createTask(p, {
          kind: "ASSIGNMENT",
          title: pick.userId ? `Route new lead ${p.customerName}` : `Route new lead ${p.customerName} (no one available)`,
          stage: "LEAD_CREATED",
          ownerId: null,
          ownerRole: "ADMIN",
          dueAt: new Date(Date.now() + HOUR),
          suggestion: { kind: "OWNER", role: "SALES", userId: pick.userId, reason: pick.reason },
          dedupeKey: `${p.id}:route:${rule.id}`,
        });
        await this.log(rule, p.id, pick.userId ? "SUGGESTED" : "NO_CANDIDATE", { userId: pick.userId, reason: pick.reason });
      }
    }
  }

  async setOwner(projectId: string, userId: string, byUserId: string | null, reason: string) {
    const before = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await this.prisma.$transaction([
      this.prisma.project.update({ where: { id: projectId }, data: { ownerId: userId } }),
      this.prisma.user.update({ where: { id: userId }, data: { lastAssignedAt: new Date() } }),
      // Sales follow-ups move with the lead.
      this.prisma.task.updateMany({ where: { projectId, status: "OPEN", ownerRole: "SALES" }, data: { ownerId: userId } }),
    ]);
    await this.audit.record({
      actorId: byUserId, action: "project.owner_changed", entity: "Project", entityId: projectId,
      meta: { from: before.ownerId, to: userId, by: byUserId ? "USER" : "RULE", reason },
    });
  }

  // ----------------------------------------------------------- stage events
  async onStagesChanged(projectId: string, openBefore: Stage[]) {
    const p = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!p) return;
    const openNow = openStages(p);
    const closed = openBefore.filter((s) => !openNow.includes(s));
    const opened = openNow.filter((s) => !openBefore.includes(s));

    if (closed.length) {
      // Follow-ups and suggestions stop once their stage moves on (FR-A03).
      await this.prisma.task.updateMany({
        where: { projectId, status: "OPEN", stage: { in: closed }, kind: { in: ["FOLLOW_UP", "ASSIGNMENT"] } },
        data: { status: "CANCELLED", completedAt: new Date() },
      });
      await this.prisma.slaTimer.updateMany({ where: { projectId, stage: { in: closed }, resolvedAt: null }, data: { resolvedAt: new Date() } });
    }
    for (const stage of opened) await this.onStageOpened(p, stage);

    // A role assigned by hand closes its pending suggestion.
    const pending = await this.prisma.task.findMany({ where: { projectId, status: "OPEN", kind: "ASSIGNMENT" } });
    for (const t of pending) {
      const s = t.suggestion as { kind?: string; role?: string } | null;
      if (s?.kind !== "ROLE" || !s.role) continue;
      const has = await this.prisma.projectAssignment.findUnique({ where: { projectId_role: { projectId, role: s.role as DbRole } } });
      if (has) await this.prisma.task.update({ where: { id: t.id }, data: { status: "CANCELLED", completedAt: new Date() } });
    }
  }

  private async onStageOpened(p: Project, stage: Stage) {
    const now = new Date();
    for (const rule of await this.rules("SLA", stage)) {
      const cfg = rule.config as { targetHours: number; warnPct: number; escalateTo: string };
      const data = {
        ruleId: rule.id, targetHours: cfg.targetHours, warnPct: cfg.warnPct, escalateTo: cfg.escalateTo,
        startedAt: now, pausedAt: null, pausedMs: 0, warnedAt: null, breachedAt: null, resolvedAt: null,
      };
      await this.prisma.slaTimer.upsert({ where: { projectId_stage: { projectId: p.id, stage } }, create: { projectId: p.id, stage, ...data }, update: data });
      await this.log(rule, p.id, "SLA_STARTED", { stage, targetHours: cfg.targetHours });
    }

    for (const rule of await this.rules("FOLLOW_UP", stage)) {
      const cfg = rule.config as { title: string; offsetsHours: number[] };
      const owner = await this.responsible(p, stage);
      for (const [i, h] of cfg.offsetsHours.entries()) {
        await this.createTask(p, {
          kind: "FOLLOW_UP",
          title: cfg.offsetsHours.length > 1 ? `${cfg.title} (${i + 1} of ${cfg.offsetsHours.length})` : cfg.title,
          stage,
          ...owner,
          dueAt: new Date(now.getTime() + h * HOUR),
          suggestion: undefined,
          dedupeKey: `${p.id}:fu:${rule.id}:${stage}:${h}:${now.getTime()}`,
        });
      }
      await this.log(rule, p.id, "FOLLOW_UPS_CREATED", { stage, count: cfg.offsetsHours.length });
    }

    for (const rule of await this.rules("ASSIGNMENT", stage)) {
      const cfg = rule.config as { strategy: Strategy; role?: Role; roles?: Role[] };
      const roles = cfg.roles ?? (cfg.role ? [cfg.role] : []);
      for (const role of roles) {
        if (role === "LOAN_OFFICER" && !p.loanRequired) continue;
        const already = await this.prisma.projectAssignment.findUnique({ where: { projectId_role: { projectId: p.id, role: role as DbRole } } });
        if (already && !ASSIGNMENT_STAGES[stage]) continue;
        const pick = pickAssignee(await this.candidates(role as DbRole), cfg.strategy, { now, address: p.address });
        const stageBound = ASSIGNMENT_STAGES[stage] === role;
        // Who normally makes this assignment: Sales for stage-bound ones, Office Executive after initiation (FR-014).
        const assigner = stageBound ? await this.responsible(p, stage) : await this.responsibleOffice(p);

        if (rule.mode === "AUTO" && pick.userId) {
          const ok = await this.applyAssignment(p.id, stage, role, pick.userId, stageBound);
          await this.log(rule, p.id, ok ? "ASSIGNED" : "AUTO_FAILED", { role, userId: pick.userId, reason: pick.reason });
          if (ok) continue;
        }
        await this.createTask(p, {
          kind: "ASSIGNMENT",
          title: `Assign ${STAGE_ROLE_LABEL[role] ?? role}`,
          stage: stageBound ? stage : "PROJECT_INITIATED_TEAM",
          ...assigner,
          dueAt: new Date(now.getTime() + 4 * HOUR),
          suggestion: { kind: stageBound ? "STAGE" : "ROLE", stage, role, userId: pick.userId, reason: pick.reason },
          dedupeKey: `${p.id}:as:${rule.id}:${role}:${now.getTime()}`,
        });
        await this.log(rule, p.id, pick.userId ? "SUGGESTED" : "NO_CANDIDATE", { role, userId: pick.userId, reason: pick.reason });
      }
    }
  }

  private async responsibleOffice(p: Project) {
    const a = await this.prisma.projectAssignment.findUnique({ where: { projectId_role: { projectId: p.id, role: "OFFICE_EXECUTIVE" } } });
    return { ownerId: a?.userId ?? null, ownerRole: "OFFICE_EXECUTIVE" };
  }

  /** AUTO mode: stage-bound assignments complete their stage as SYSTEM (all gates still apply). */
  async applyAssignment(projectId: string, stage: Stage, role: Role, userId: string, stageBound: boolean): Promise<boolean> {
    try {
      if (stageBound) {
        const field = role === "SITE_SUPERVISOR" ? "supervisorId" : "officeExecutiveId";
        await this.projects.completeStageAsSystem(projectId, stage, { [field]: userId });
      } else {
        await this.prisma.projectAssignment.upsert({
          where: { projectId_role: { projectId, role: role as DbRole } },
          create: { projectId, role: role as DbRole, userId, assignedBy: "SYSTEM" },
          update: { userId, assignedBy: "SYSTEM", assignedAt: new Date() },
        });
        await this.audit.record({ action: "project.assigned", entity: "Project", entityId: projectId, meta: { role, userId, by: "RULE" } });
      }
      await this.prisma.user.update({ where: { id: userId }, data: { lastAssignedAt: new Date() } });
      return true;
    } catch (e) {
      console.warn("[automation] auto-assignment failed", e);
      return false;
    }
  }

  private async createTask(p: Project, t: Omit<Prisma.TaskUncheckedCreateInput, "projectId">) {
    await this.prisma.task.upsert({ where: { dedupeKey: t.dedupeKey }, create: { ...t, projectId: p.id }, update: {} });
  }

  // ------------------------------------------------------------------- SLA tick
  /** Checks live SLA clocks; warns once, breaches once and escalates to the configured role queue. */
  async tick(now = new Date()) {
    const timers = await this.prisma.slaTimer.findMany({ where: { resolvedAt: null }, include: { project: true } });
    for (const t of timers) {
      const s = slaState(t, now);
      if (s.state === "WARN" && !t.warnedAt) {
        await this.prisma.slaTimer.update({ where: { id: t.id }, data: { warnedAt: now } });
        await this.log(null, t.projectId, "SLA_WARNING", { stage: t.stage });
      }
      if (s.state === "BREACHED" && !t.breachedAt) {
        await this.prisma.slaTimer.update({ where: { id: t.id }, data: { breachedAt: now, warnedAt: t.warnedAt ?? now } });
        await this.createTask(t.project, {
          kind: "SLA_ESCALATION",
          title: `SLA breached: ${STAGE_DEFS[t.stage as Stage]?.label ?? t.stage} for ${t.project.customerName} (${projectCode(t.project)})`,
          stage: t.stage,
          ownerId: null,
          ownerRole: t.escalateTo,
          dueAt: now,
          suggestion: undefined,
          dedupeKey: `${t.id}:breach:${t.startedAt.getTime()}`,
        });
        await this.log(null, t.projectId, "SLA_BREACHED", { stage: t.stage, escalatedTo: t.escalateTo });
        this.bus.emit("sla.breached", { projectId: t.projectId, stage: t.stage as Stage });
      }
    }
  }
}

const STAGE_ROLE_LABEL: Partial<Record<Role, string>> = {
  SITE_SUPERVISOR: "Site Supervisor",
  OFFICE_EXECUTIVE: "Office Executive",
  LOAN_OFFICER: "Loan Officer",
  DISCOM_OFFICER: "DISCOM Officer",
  PROJECT_ENGINEER: "Project Engineer",
  SALES: "Sales owner",
};
