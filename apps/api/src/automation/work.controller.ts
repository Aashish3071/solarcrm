import { Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Put } from "@nestjs/common";
import type { Prisma, Role as DbRole } from "@prisma/client";
import { STAGE_DEFS, isRole, slaState, type Stage } from "@solarcrm/shared";
import { z } from "zod";
import { AuditService } from "../common/audit.service";
import { CurrentUser, RequireModule, type AuthUser } from "../common/auth-context";
import { parse, RuleViolation } from "../common/validation";
import { PrismaService } from "../prisma.service";
import { ProjectsService, projectCode } from "../projects/projects.service";
import { AutomationService } from "./automation.service";

const SnoozeBody = z.object({ hours: z.coerce.number().min(1).max(24 * 14) });
const ApplyBody = z.object({ userId: z.string().min(1).optional() });
const OwnerBody = z.object({ userId: z.string().min(1), reason: z.string().trim().min(1, "A reason is required") });

const startOfDay = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/** My Work (FR-A03/A04): tasks, follow-ups and SLA clocks for the signed-in person. */
@Controller()
export class WorkController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly automation: AutomationService,
    private readonly audit: AuditService,
  ) {}

  private mine(user: AuthUser): Prisma.TaskWhereInput {
    return { OR: [{ ownerId: user.id }, { ownerId: null, ownerRole: user.role }], project: this.projects.scope(user) };
  }

  @Get("work")
  @RequireModule("myWork", "dashboard")
  async work(@CurrentUser() user: AuthUser) {
    const now = new Date();
    const [tasks, doneToday, timers] = await Promise.all([
      this.prisma.task.findMany({
        where: { ...this.mine(user), status: "OPEN" },
        orderBy: { dueAt: "asc" },
        take: 200,
        include: { project: { select: { id: true, seq: true, createdAt: true, customerName: true } } },
      }),
      this.prisma.task.count({ where: { ...this.mine(user), status: "DONE", completedAt: { gte: startOfDay() } } }),
      this.prisma.slaTimer.findMany({
        where: { resolvedAt: null, project: this.projects.scope(user) },
        include: { project: { include: { assignments: true } } },
      }),
    ]);
    const endToday = new Date(startOfDay().getTime() + 86400_000);
    const week = new Date(now.getTime() + 7 * 86400_000);

    // SLA clocks for stages this person is responsible for.
    const clocks = timers
      .filter((t) => {
        const actors = STAGE_DEFS[t.stage as Stage]?.actors ?? [];
        if (user.role === "ADMIN") return true;
        if (!actors.includes(user.role)) return false;
        if (user.role === "SALES") return t.project.ownerId === user.id;
        if (user.role === "ACCOUNTS" || user.role === "STORE_MANAGER") return true;
        return t.project.assignments.some((a) => a.userId === user.id && a.role === user.role);
      })
      .map((t) => {
        const s = slaState(t, now);
        return {
          projectId: t.projectId,
          projectCode: projectCode(t.project),
          customerName: t.project.customerName,
          stage: t.stage,
          label: STAGE_DEFS[t.stage as Stage]?.label ?? t.stage,
          state: s.state,
          dueAt: s.dueAt,
          remainingMs: s.remainingMs,
        };
      })
      .sort((a, b) => a.remainingMs - b.remainingMs);

    return {
      counts: {
        overdue: tasks.filter((t) => t.dueAt < now).length,
        dueToday: tasks.filter((t) => t.dueAt >= now && t.dueAt < endToday).length,
        completedToday: doneToday,
        next7Days: tasks.filter((t) => t.dueAt >= endToday && t.dueAt < week).length,
        slaBreached: clocks.filter((c) => c.state === "BREACHED").length,
      },
      tasks: tasks.map((t) => ({
        id: t.id,
        kind: t.kind,
        title: t.title,
        stage: t.stage,
        dueAt: t.dueAt,
        queue: t.ownerId ? null : t.ownerRole,
        suggestion: t.suggestion,
        projectId: t.project.id,
        projectCode: projectCode(t.project),
        customerName: t.project.customerName,
      })),
      clocks,
    };
  }

  private async task(user: AuthUser, id: string) {
    const t = await this.prisma.task.findFirst({ where: { id, ...this.mine(user) } });
    if (!t) throw new NotFoundException("Task not found.");
    if (t.status !== "OPEN") throw new RuleViolation(["This task is already closed."]);
    return t;
  }

  @Post("tasks/:id/done")
  @HttpCode(200)
  async done(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.task(user, id);
    await this.prisma.task.update({ where: { id }, data: { status: "DONE", completedAt: new Date(), completedById: user.id } });
    return { ok: true };
  }

  @Post("tasks/:id/snooze")
  @HttpCode(200)
  async snooze(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const { hours } = parse(SnoozeBody, body);
    const t = await this.task(user, id);
    await this.prisma.task.update({ where: { id }, data: { dueAt: new Date(Math.max(Date.now(), t.dueAt.getTime()) + hours * 3600_000) } });
    return { ok: true };
  }

  /**
   * Apply an assignment suggestion (or a person chosen instead). Goes through
   * the normal workflow path, so the caller's role and every gate still apply.
   */
  @Post("tasks/:id/apply")
  @HttpCode(200)
  async apply(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const { userId: chosen } = parse(ApplyBody, body ?? {});
    const t = await this.task(user, id);
    const s = t.suggestion as { kind: "OWNER" | "STAGE" | "ROLE"; stage?: Stage; role: string; userId: string | null } | null;
    if (t.kind !== "ASSIGNMENT" || !s) throw new RuleViolation(["This task has nothing to apply."]);
    const userId = chosen ?? s.userId;
    if (!userId) throw new RuleViolation(["Choose a person to assign."]);
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target?.active || target.role !== s.role) throw new RuleViolation(["Choose an active person with the right role."]);

    if (s.kind === "OWNER") {
      if (user.role !== "ADMIN") throw new ForbiddenException("Only a manager can route leads.");
      await this.automation.setOwner(t.projectId, userId, user.id, chosen ? "Manager override" : "Applied routing suggestion");
    } else if (s.kind === "STAGE" && s.stage) {
      const field = s.role === "SITE_SUPERVISOR" ? "supervisorId" : "officeExecutiveId";
      await this.projects.completeStage(user, t.projectId, s.stage, { [field]: userId });
    } else if (isRole(s.role)) {
      await this.projects.assign(user, t.projectId, s.role as DbRole, userId);
    }
    await this.prisma.user.update({ where: { id: userId }, data: { lastAssignedAt: new Date() } });
    await this.prisma.task.update({ where: { id }, data: { status: "DONE", completedAt: new Date(), completedById: user.id } });
    await this.audit.record({
      actorId: user.id, action: "automation.suggestion_applied", entity: "Project", entityId: t.projectId,
      meta: { taskId: id, role: s.role, userId, overridden: !!chosen && chosen !== s.userId },
    });
    return { ok: true };
  }

  /** FR-A05: manager reassigns the lead owner, with a reason, at any time. */
  @Put("projects/:id/owner")
  @RequireModule("automation")
  async owner(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const b = parse(OwnerBody, body);
    const target = await this.prisma.user.findUnique({ where: { id: b.userId } });
    if (!target?.active || target.role !== "SALES") throw new RuleViolation(["Choose an active Sales person."]);
    if (!(await this.prisma.project.findUnique({ where: { id } }))) throw new NotFoundException("Project not found.");
    await this.automation.setOwner(id, b.userId, user.id, b.reason);
    return this.projects.get(user, id);
  }
}
