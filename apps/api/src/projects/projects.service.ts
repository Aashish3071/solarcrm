import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Project, type Role as DbRole } from "@prisma/client";
import {
  STAGE_DEFS,
  calculateIncentive,
  availableStages,
  checkCompletion,
  currentStage,
  initialSkipped,
  stagesReopenedByPaymentRejection,
  validateLeadSource,
  type ProjectState,
  type Role,
  type Stage,
  type StageInput,
} from "@solarcrm/shared";
import { AuditService } from "../common/audit.service";
import type { AuthUser } from "../common/auth-context";
import { ConfigParamsService } from "../common/config-params.service";
import { RuleViolation } from "../common/validation";
import { EventBus } from "../automation/event-bus";
import { applyEffects, preCheck, serverFacts } from "./stage-effects";
import { PrismaService } from "../prisma.service";

export interface CreateLeadInput {
  customerName: string;
  phone: string;
  email?: string;
  address: string;
  leadSource: "DIRECT" | "SALES_PARTNER";
  partnerId?: string;
}

/** Roles that see every project; everyone else sees only projects they are assigned to. */
const SEES_ALL: readonly Role[] = ["ADMIN", "SALES", "ACCOUNTS"];

/** Stages whose completion assigns a person (FR-004, FR-011). */
const ASSIGNS: Partial<Record<Stage, { field: string; role: DbRole }>> = {
  SUPERVISOR_ASSIGNED: { field: "supervisorId", role: "SITE_SUPERVISOR" },
  PROJECT_INITIATED: { field: "officeExecutiveId", role: "OFFICE_EXECUTIVE" },
};

/** Who may assign whom after initiation (FR-014, FR-015). */
const ASSIGNERS: Partial<Record<DbRole, readonly Role[]>> = {
  LOAN_OFFICER: ["OFFICE_EXECUTIVE"],
  DISCOM_OFFICER: ["OFFICE_EXECUTIVE"],
  PROJECT_ENGINEER: ["OFFICE_EXECUTIVE"],
  SITE_SUPERVISOR: ["SALES", "PROJECT_ENGINEER"],
};

export const projectCode = (p: Pick<Project, "seq" | "createdAt">) =>
  `SLR-${p.createdAt.getUTCFullYear()}-${String(p.seq).padStart(5, "0")}`;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigParamsService,
    private readonly bus: EventBus,
  ) {}

  private openOf(p: Project): Stage[] {
    return availableStages({ completed: p.completedStages as Stage[], skipped: p.skippedStages as Stage[], loanRequired: p.loanRequired });
  }

  /** Automation completes stage-bound assignments as SYSTEM in AUTO mode; every gate still applies. */
  completeStageAsSystem(id: string, stage: Stage, input: StageInput) {
    const system: AuthUser = { id: "system", name: "Automation", email: "", role: "ADMIN", partnerId: null };
    return this.completeStage(system, id, stage, input, "SYSTEM");
  }

  /** Row-level scope (Booklet §10): who can see which projects. */
  scope(user: AuthUser): Prisma.ProjectWhereInput {
    if (SEES_ALL.includes(user.role)) return {};
    if (user.role === "SALES_PARTNER") return { partnerId: user.partnerId ?? "__none__" };
    // Store works across projects (Booklet §3 "Inventory/dispatch module"): every planned project.
    if (user.role === "STORE_MANAGER") return { completedStages: { has: "PROJECT_PLANNED" } };
    return { assignments: { some: { userId: user.id } } };
  }

  async list(user: AuthUser) {
    const rows = await this.prisma.project.findMany({
      where: this.scope(user),
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        owner: { select: { name: true } },
        partner: { select: { name: true } },
        assignments: { select: { role: true, user: { select: { name: true } } } },
        siteVisit: { select: { scheduledAt: true, completedAt: true, feasible: true } },
        terms: { select: { finalCost: true, discountPct: true, confirmedAt: true } },
        gov: { select: { status: true, registrationNo: true } },
        loan: { select: { status: true, bank: true, approvedAmount: true, requestedAmount: true, clientReconfirmedAt: true } },
        discom: { select: { status: true, applicationNo: true, meterNumber: true } },
        plan: { select: { plannedStart: true, expectedEnd: true, actualStart: true, actualEnd: true, materialReadyAt: true, dispatchedAt: true, receivedAt: true } },
        install: { select: { trainingAssigneeId: true, trainingCompletedAt: true, completedAt: true } },
      },
    });
    return rows.map((p) => ({
      ...this.toDto(p),
      team: Object.fromEntries(p.assignments.map((a) => [a.role, a.user.name])),
      visit: p.siteVisit,
      terms: p.terms && { finalCost: p.terms.finalCost.toString(), discountPct: p.terms.discountPct.toString(), confirmedAt: p.terms.confirmedAt },
      gov: p.gov,
      loan: p.loan && { ...p.loan, approvedAmount: p.loan.approvedAmount?.toString() ?? null, requestedAmount: p.loan.requestedAmount.toString() },
      discom: p.discom,
      plan: p.plan,
      install: p.install,
    }));
  }

  async get(user: AuthUser, id: string) {
    const p = await this.prisma.project.findFirst({
      where: { id, ...this.scope(user) },
      include: {
        owner: { select: { name: true } },
        partner: { select: { name: true } },
        assignments: { include: { user: { select: { id: true, name: true } } } },
        events: { orderBy: { at: "desc" }, take: 50 },
        siteVisit: true,
        terms: true,
        payments: { orderBy: { loggedAt: "desc" } },
        documents: { orderBy: { uploadedAt: "desc" } },
        gov: true,
        loan: true,
        discom: true,
        plan: true,
        install: true,
        schedule: { orderBy: { position: "asc" } },
        incentive: true,
      },
    });
    if (!p) throw new NotFoundException("Project not found.");
    return {
      ...this.toDto(p),
      assignments: p.assignments.map((a) => ({ role: a.role, userId: a.user.id, name: a.user.name, assignedAt: a.assignedAt })),
      events: p.events.map((e) => ({ stage: e.stage, action: e.action, actorRole: e.actorRole, at: e.at })),
      siteVisit: p.siteVisit && { ...p.siteVisit, actualKw: p.siteVisit.actualKw?.toString() ?? null },
      terms: p.terms && { ...p.terms, finalCost: p.terms.finalCost.toString(), discountPct: p.terms.discountPct.toString() },
      payments: p.payments.map((x) => ({ ...x, amount: x.amount.toString() })),
      documents: p.documents.map(({ storageKey, ...d }) => d),
      gov: p.gov,
      loan: p.loan && {
        ...p.loan,
        requestedAmount: p.loan.requestedAmount.toString(),
        approvedAmount: p.loan.approvedAmount?.toString() ?? null,
        // FR-019: split recalculated from the approved loan once terms are confirmed.
        split:
          p.terms && p.loan.approvedAmount && (p.loan.clientReconfirmedAt || p.loan.approvedAmount.equals(p.loan.requestedAmount))
            ? { bank: p.loan.approvedAmount.toString(), customer: p.terms.finalCost.minus(p.loan.approvedAmount).toString() }
            : null,
      },
      discom: p.discom,
      plan: p.plan,
      install: p.install,
      schedule: p.schedule.map((x) => ({ ...x, amount: x.amount.toString() })),
      // Sales Partners see only their commission; incentive of in-house staff is not shown to them.
      incentive:
        p.incentive && user.role !== "SALES_PARTNER"
          ? {
              incentivePct: p.incentive.incentivePct.toString(),
              incentiveAmount: p.incentive.incentiveAmount.toString(),
              partnerCommissionPct: p.incentive.partnerCommissionPct.toString(),
              partnerCommissionAmount: p.incentive.partnerCommissionAmount.toString(),
              provisional: p.incentive.provisional,
              calculatedAt: p.incentive.calculatedAt,
            }
          : p.incentive && {
              partnerCommissionPct: p.incentive.partnerCommissionPct.toString(),
              partnerCommissionAmount: p.incentive.partnerCommissionAmount.toString(),
              provisional: p.incentive.provisional,
              calculatedAt: p.incentive.calculatedAt,
            },
    };
  }

  async createLead(user: AuthUser, input: CreateLeadInput) {
    // A Sales Partner can only create leads for their own partner organisation.
    const partnerId = user.role === "SALES_PARTNER" ? user.partnerId : input.partnerId;
    const leadSource = user.role === "SALES_PARTNER" ? "SALES_PARTNER" : input.leadSource;
    const errors = validateLeadSource(leadSource, partnerId);
    if (errors.length) throw new RuleViolation(errors);
    if (partnerId && !(await this.prisma.partner.findUnique({ where: { id: partnerId } }))) {
      throw new RuleViolation(["Selected Sales Partner does not exist."]);
    }

    const project = await this.prisma.project.create({
      data: {
        customerName: input.customerName,
        phone: input.phone,
        email: input.email,
        address: input.address,
        leadSource,
        partnerId: leadSource === "SALES_PARTNER" ? partnerId : null,
        ownerId: user.id,
        completedStages: ["LEAD_CREATED"],
        skippedStages: [],
        events: { create: { stage: "LEAD_CREATED", action: "COMPLETED", actorId: user.id, actorRole: user.role, data: {} } },
      },
    });
    await this.audit.record({ actorId: user.id, action: "project.lead_created", entity: "Project", entityId: project.id });
    this.bus.emit("lead.created", { projectId: project.id });
    this.bus.emit("stages.changed", { projectId: project.id, openBefore: [] });
    return this.get(user, project.id);
  }

  async completeStage(user: AuthUser, id: string, stage: Stage, input: StageInput, actorRole: string = user.role) {
    const p = await this.prisma.project.findFirst({ where: { id, ...this.scope(user) } });
    if (!p) throw new NotFoundException("Project not found.");

    const openBefore = this.openOf(p);
    const state = await this.state(p);
    const durationDays = await this.config.number("planning.defaultDurationDays", 12);
    input = { ...input, ...(await serverFacts(this.prisma, p, stage, durationDays)) };
    const check = checkCompletion(stage, user.role, state, input);
    if (!check.ok) throw new RuleViolation(check.errors);

    const assign = ASSIGNS[stage];
    if (assign) await this.assertAssignable(String(input[assign.field]), assign.role);
    const dbErrors = await preCheck(this.prisma, p, stage, input);
    if (dbErrors.length) throw new RuleViolation(dbErrors);

    await this.prisma.$transaction(async (tx) => {
      // Optimistic check: fail if another request completed this stage meanwhile.
      const updated = await tx.project.updateMany({
        where: { id, NOT: { completedStages: { has: stage } } },
        data: {
          completedStages: { push: stage },
          ...(stage === "SUPERVISOR_ASSIGNED" ? { supervisorAssignedAt: new Date() } : {}),
        },
      });
      if (updated.count === 0) throw new RuleViolation([`${STAGE_DEFS[stage].label} is already done.`]);
      if (assign) {
        const userId = String(input[assign.field]);
        await tx.projectAssignment.upsert({
          where: { projectId_role: { projectId: id, role: assign.role } },
          create: { projectId: id, role: assign.role, userId, assignedBy: user.id },
          update: { userId, assignedBy: user.id, assignedAt: new Date() },
        });
      }
      await applyEffects(tx, p, stage, input, user);
      await tx.stageEvent.create({
        data: { projectId: id, stage, action: "COMPLETED", actorId: user.id, actorRole, data: input as Prisma.InputJsonValue },
      });
    });
    await this.audit.record({ actorId: user.id, action: "project.stage_completed", entity: "Project", entityId: id, meta: { stage } });
    if (stage === "PAYMENTS_COLLECTED") await this.calculateIncentive(id);
    this.bus.emit("stages.changed", { projectId: id, openBefore });
    return this.get(user, id);
  }

  /**
   * Stage 23 is completed by the system (FR-039 – FR-043): once collection is
   * complete the incentive and partner commission are calculated with the rules
   * in force now, and those rules are stored with the result.
   */
  async calculateIncentive(id: string) {
    const p = await this.prisma.project.findUniqueOrThrow({ where: { id }, include: { terms: true, partner: true } });
    const state = await this.state(p);
    const check = checkCompletion("INCENTIVE_CALCULATED", "SYSTEM", state);
    if (!check.ok || !p.terms) return;
    const rules = await this.config.incentiveRules(p.ownerId);
    const r = calculateIncentive({
      orderValue: Number(p.terms.finalCost),
      discountPct: Number(p.terms.discountPct),
      partnerType: p.partner?.type ?? null,
      rules,
    });
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.project.updateMany({
        where: { id, NOT: { completedStages: { has: "INCENTIVE_CALCULATED" } } },
        data: { completedStages: { push: "INCENTIVE_CALCULATED" } },
      });
      if (updated.count === 0) return;
      await tx.incentiveResult.create({
        data: {
          projectId: id,
          salesUserId: p.ownerId,
          partnerId: p.partnerId,
          orderValue: p.terms!.finalCost,
          discountPct: p.terms!.discountPct,
          incentivePct: new Prisma.Decimal(r.incentivePct),
          incentiveAmount: new Prisma.Decimal(r.incentiveAmount),
          partnerCommissionPct: new Prisma.Decimal(r.partnerCommissionPct),
          partnerCommissionAmount: new Prisma.Decimal(r.partnerCommissionAmount),
          rules: { ...rules },
          provisional: r.provisional,
        },
      });
      await tx.stageEvent.create({
        data: { projectId: id, stage: "INCENTIVE_CALCULATED", action: "COMPLETED", actorId: null, actorRole: "SYSTEM", data: { ...r } },
      });
    });
    await this.audit.record({ action: "incentive.calculated", entity: "Project", entityId: id, meta: { ...r } });
  }

  /** FR-010: Accounts rejects the logged payment; Sales must log it again. */
  async rejectPayment(user: AuthUser, id: string, reason: string) {
    if (user.role !== "ACCOUNTS" && user.role !== "ADMIN") throw new ForbiddenException("Only Accounts can reject payments.");
    const p = await this.prisma.project.findFirst({ where: { id, ...this.scope(user) } });
    if (!p) throw new NotFoundException("Project not found.");
    const state = await this.state(p);
    if (!availableStages(state).includes("PAYMENT_VERIFIED")) {
      throw new RuleViolation(["There is no logged payment awaiting verification."]);
    }
    const openBefore = this.openOf(p);
    const reopen = stagesReopenedByPaymentRejection();
    await this.prisma.$transaction([
      this.prisma.payment.updateMany({
        where: { projectId: id, kind: "ADVANCE", status: "LOGGED" },
        data: { status: "REJECTED", verifiedById: user.id, verifiedAt: new Date(), rejectionReason: reason },
      }),
      this.prisma.project.update({
        where: { id },
        data: { completedStages: p.completedStages.filter((s) => !reopen.includes(s as Stage)) },
      }),
      ...reopen.map((stage) =>
        this.prisma.stageEvent.create({
          data: { projectId: id, stage, action: "REOPENED", actorId: user.id, actorRole: user.role, data: { reason } },
        }),
      ),
    ]);
    await this.audit.record({ actorId: user.id, action: "payment.rejected", entity: "Project", entityId: id, meta: { reason } });
    this.bus.emit("stages.changed", { projectId: id, openBefore });
    return this.get(user, id);
  }

  async assign(user: AuthUser, id: string, role: DbRole, userId: string) {
    const allowed = ASSIGNERS[role];
    if (!allowed) throw new RuleViolation(["This role is assigned through its workflow stage."]);
    if (user.role !== "ADMIN" && !allowed.includes(user.role)) throw new ForbiddenException("Your role cannot make this assignment.");
    const p = await this.prisma.project.findFirst({ where: { id, ...this.scope(user) } });
    if (!p) throw new NotFoundException("Project not found.");
    if (role !== "SITE_SUPERVISOR" && !p.completedStages.includes("PROJECT_INITIATED")) {
      throw new RuleViolation(["The project must be initiated before assigning this role."]);
    }
    await this.assertAssignable(userId, role);
    await this.prisma.projectAssignment.upsert({
      where: { projectId_role: { projectId: id, role } },
      create: { projectId: id, role, userId, assignedBy: user.id },
      update: { userId, assignedBy: user.id, assignedAt: new Date() },
    });
    await this.audit.record({ actorId: user.id, action: "project.assigned", entity: "Project", entityId: id, meta: { role, userId } });
    this.bus.emit("stages.changed", { projectId: id, openBefore: this.openOf(p) });
    return this.get(user, id);
  }

  private async assertAssignable(userId: string, role: DbRole) {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target || !target.active || target.role !== role) {
      throw new RuleViolation([`Select an active ${STAGE_ROLE_LABEL[role] ?? role}.`]);
    }
  }

  async state(p: Project): Promise<ProjectState> {
    return {
      completed: p.completedStages as Stage[],
      skipped: p.skippedStages as Stage[],
      loanRequired: p.loanRequired,
      supervisorAssignedAt: p.supervisorAssignedAt,
      discountCeilingPct: await this.config.number("sales.discountCeilingPct", 4),
    };
  }

  toDto(p: Project & { owner?: { name: string }; partner?: { name: string } | null }) {
    const state: ProjectState = {
      completed: p.completedStages as Stage[],
      skipped: p.skippedStages as Stage[],
      loanRequired: p.loanRequired,
    };
    const current = currentStage(state);
    return {
      id: p.id,
      code: projectCode(p),
      customerName: p.customerName,
      phone: p.phone,
      email: p.email,
      address: p.address,
      requiredKw: p.requiredKw?.toString() ?? null,
      loanRequired: p.loanRequired,
      loanAmount: p.loanAmount?.toString() ?? null,
      projectType: p.projectType,
      packageName: p.packageName,
      leadSource: p.leadSource,
      partnerName: p.partner?.name ?? null,
      ownerName: p.owner?.name ?? null,
      completedStages: p.completedStages,
      skippedStages: p.skippedStages,
      currentStage: current,
      currentStageNumber: current ? STAGE_DEFS[current].number : 24,
      availableStages: availableStages(state),
      createdAt: p.createdAt,
    };
  }
}

const STAGE_ROLE_LABEL: Partial<Record<DbRole, string>> = {
  SITE_SUPERVISOR: "Site Supervisor",
  OFFICE_EXECUTIVE: "Office Executive",
  LOAN_OFFICER: "Loan Officer",
  DISCOM_OFFICER: "DISCOM Officer",
  PROJECT_ENGINEER: "Project Engineer",
};
