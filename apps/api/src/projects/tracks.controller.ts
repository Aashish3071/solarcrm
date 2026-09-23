import { Body, Controller, ForbiddenException, HttpCode, NotFoundException, Param, Post, Put } from "@nestjs/common";
import { Prisma, type Project } from "@prisma/client";
import {
  DISCOM_STATUSES,
  GOV_STATUSES,
  LOAN_STATUSES,
  PAYMENT_MODES,
  availableStages,
  expectedEndDate,
  validatePaymentEntry,
  type Role,
  type Stage,
} from "@solarcrm/shared";
import { z } from "zod";
import { AuditService } from "../common/audit.service";
import { CurrentUser, RequireModule, type AuthUser } from "../common/auth-context";
import { ConfigParamsService } from "../common/config-params.service";
import { parse, RuleViolation } from "../common/validation";
import { PrismaService } from "../prisma.service";
import { ProjectsService } from "./projects.service";

const GovBody = z.object({
  status: z.enum(GOV_STATUSES),
  registrationNo: z.string().trim().max(60).optional(),
  registrationDate: z.string().optional(),
  notes: z.string().trim().max(1000).optional(),
});
const LoanBody = z.object({
  bank: z.string().trim().min(1, "Bank / NBFC is required").max(120),
  status: z.enum(LOAN_STATUSES),
  requestedAmount: z.coerce.number().positive(),
  approvedAmount: z.coerce.number().positive().optional(),
  notes: z.string().trim().max(1000).optional(),
});
const DiscomBody = z.object({
  applicationNo: z.string().trim().min(1, "Application number is required").max(60),
  status: z.enum(DISCOM_STATUSES),
  meterNumber: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(1000).optional(),
});
const RescheduleBody = z.object({ startDate: z.string().min(1), reason: z.string().trim().min(1, "A reason is required") });
const TrainingBody = z.object({ assigneeId: z.string().min(1) });
const PaymentBody = z.object({
  kind: z.enum(["LOAN_INSTALMENT_1", "LOAN_INSTALMENT_2", "COLLECTION"]),
  amount: z.coerce.number(),
  mode: z.string(),
  utr: z.string(),
});
const VerifyBody = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), reason: z.string().trim().optional() });

/**
 * Progress updates for manual external steps (Booklet §6: status + document
 * upload until an API exists) and the post-initiation actions that are not
 * stage completions on their own.
 */
@Controller("projects/:id")
@RequireModule("projects")
export class TracksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
    private readonly config: ConfigParamsService,
  ) {}

  private async load(user: AuthUser, id: string, roles: Role[]): Promise<Project> {
    if (user.role !== "ADMIN" && !roles.includes(user.role)) throw new ForbiddenException("Your role cannot update this.");
    const p = await this.prisma.project.findFirst({ where: { id, ...this.projects.scope(user) } });
    if (!p) throw new NotFoundException("Project not found.");
    return p;
  }

  private open(p: Project, stage: Stage) {
    return availableStages({ completed: p.completedStages as Stage[], skipped: p.skippedStages as Stage[], loanRequired: p.loanRequired }).includes(stage);
  }

  /** FR-012: Office Executive records portal status; "Registered" completes stage 11. */
  @Put("gov")
  async gov(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const b = parse(GovBody, body);
    const p = await this.load(user, id, ["OFFICE_EXECUTIVE"]);
    if (!this.open(p, "GOV_REGISTERED")) throw new RuleViolation(["Government registration is not open for this project."]);
    if (b.status === "REGISTERED") return this.projects.completeStage(user, id, "GOV_REGISTERED", b);
    const data = { status: b.status, registrationNo: b.registrationNo || null, notes: b.notes || null, updatedById: user.id };
    await this.prisma.govRegistration.upsert({ where: { projectId: id }, create: { projectId: id, ...data }, update: data });
    await this.audit.record({ actorId: user.id, action: "gov.updated", entity: "Project", entityId: id, meta: { status: b.status } });
    return this.projects.get(user, id);
  }

  /** FR-016/017: Loan Officer records the application and the bank's decision. */
  @Put("loan")
  async loan(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const b = parse(LoanBody, body);
    const p = await this.load(user, id, ["LOAN_OFFICER"]);
    if (!p.loanRequired) throw new RuleViolation(["This project does not need a loan."]);
    if (!this.open(p, "LOAN_PROCESSED")) throw new RuleViolation(["Loan processing is not open for this project."]);
    if (b.status === "APPROVED" && !b.approvedAmount) throw new RuleViolation(["Enter the approved loan amount."]);
    const existing = await this.prisma.loanApplication.findUnique({ where: { projectId: id } });
    const approved = b.approvedAmount ? new Prisma.Decimal(b.approvedAmount) : null;
    // A change to the approved amount needs a fresh client re-confirmation (FR-018).
    const keepReconfirm = existing?.clientReconfirmedAt && existing.approvedAmount && approved?.equals(existing.approvedAmount);
    const data = {
      bank: b.bank,
      status: b.status,
      requestedAmount: new Prisma.Decimal(b.requestedAmount),
      approvedAmount: approved,
      notes: b.notes || null,
      updatedById: user.id,
      ...(keepReconfirm ? {} : { clientReconfirmedAt: null, reconfirmedById: null }),
    };
    await this.prisma.loanApplication.upsert({ where: { projectId: id }, create: { projectId: id, ...data }, update: data });
    await this.audit.record({ actorId: user.id, action: "loan.updated", entity: "Project", entityId: id, meta: { status: b.status, approvedAmount: b.approvedAmount ?? null } });
    return this.projects.get(user, id);
  }

  /** FR-018: Sales re-confirms changed loan terms with the client. */
  @Post("loan/reconfirm")
  @HttpCode(200)
  async reconfirm(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.load(user, id, ["SALES"]);
    const loan = await this.prisma.loanApplication.findUnique({ where: { projectId: id } });
    if (loan?.status !== "APPROVED") throw new RuleViolation(["There is no approved loan to re-confirm."]);
    await this.prisma.loanApplication.update({ where: { projectId: id }, data: { clientReconfirmedAt: new Date(), reconfirmedById: user.id } });
    await this.audit.record({ actorId: user.id, action: "loan.reconfirmed", entity: "Project", entityId: id });
    return this.projects.get(user, id);
  }

  /** FR-021/022/034: DISCOM Officer submits and tracks the application. */
  @Put("discom")
  async discom(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const b = parse(DiscomBody, body);
    const p = await this.load(user, id, ["DISCOM_OFFICER"]);
    if (!p.completedStages.includes("DISCOM_APPLIED")) {
      if (!this.open(p, "DISCOM_APPLIED")) throw new RuleViolation(["DISCOM application is not open for this project."]);
      return this.projects.completeStage(user, id, "DISCOM_APPLIED", b);
    }
    if (p.completedStages.includes("FINAL_DISCOM_APPROVED")) throw new RuleViolation(["Final DISCOM approval is already recorded."]);
    await this.prisma.discomApplication.update({
      where: { projectId: id },
      data: {
        applicationNo: b.applicationNo,
        status: b.status === "FINAL_APPROVED" ? undefined : b.status,
        meterNumber: b.meterNumber || null,
        meterInstalledAt: b.status === "METER_INSTALLED" ? new Date() : undefined,
        notes: b.notes || null,
        updatedById: user.id,
      },
    });
    await this.audit.record({ actorId: user.id, action: "discom.updated", entity: "Project", entityId: id, meta: { status: b.status } });
    if (b.status === "FINAL_APPROVED") return this.projects.completeStage(user, id, "FINAL_DISCOM_APPROVED", {});
    return this.projects.get(user, id);
  }

  /** FR-025/026/030: reschedule the start; the expected end is recalculated and the change recorded. */
  @Put("plan/reschedule")
  async reschedule(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const b = parse(RescheduleBody, body);
    const p = await this.load(user, id, ["PROJECT_ENGINEER"]);
    if (!p.completedStages.includes("PROJECT_PLANNED")) throw new RuleViolation(["Plan the project before rescheduling."]);
    if (p.completedStages.includes("INSTALLATION_DONE")) throw new RuleViolation(["Installation is already complete."]);
    const start = new Date(b.startDate);
    if (Number.isNaN(start.getTime())) throw new RuleViolation(["Enter a valid start date."]);
    const days = await this.config.number("planning.defaultDurationDays", 12);
    await this.prisma.projectPlan.update({
      where: { projectId: id },
      data: { plannedStart: start, expectedEnd: expectedEndDate(start, days), rescheduleCount: { increment: 1 }, delayReason: b.reason },
    });
    await this.audit.record({ actorId: user.id, action: "plan.rescheduled", entity: "Project", entityId: id, meta: { startDate: b.startDate, reason: b.reason } });
    return this.projects.get(user, id);
  }

  /** FR-032: after completion the Project Engineer assigns client training. */
  @Put("training")
  async assignTraining(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const b = parse(TrainingBody, body);
    const p = await this.load(user, id, ["PROJECT_ENGINEER"]);
    if (!p.completedStages.includes("COMPLETED")) throw new RuleViolation(["Training is assigned after the project is completed."]);
    const assignee = await this.prisma.user.findUnique({ where: { id: b.assigneeId } });
    if (!assignee?.active || !["SITE_SUPERVISOR", "PROJECT_ENGINEER", "OFFICE_EXECUTIVE"].includes(assignee.role)) {
      throw new RuleViolation(["Choose an active Site Supervisor, Project Engineer or Office Executive."]);
    }
    await this.prisma.installation.update({ where: { projectId: id }, data: { trainingAssigneeId: b.assigneeId } });
    await this.audit.record({ actorId: user.id, action: "training.assigned", entity: "Project", entityId: id, meta: { assigneeId: b.assigneeId } });
    return this.projects.get(user, id);
  }

  /** FR-035: training done once the client-signed certificate is uploaded. */
  @Post("training/complete")
  @HttpCode(200)
  async completeTraining(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.load(user, id, ["PROJECT_ENGINEER", "OFFICE_EXECUTIVE", "SITE_SUPERVISOR"]);
    const inst = await this.prisma.installation.findUnique({ where: { projectId: id } });
    if (!inst?.trainingAssigneeId) throw new RuleViolation(["Training has not been assigned yet."]);
    if (user.role !== "ADMIN" && user.role !== "PROJECT_ENGINEER" && inst.trainingAssigneeId !== user.id) {
      throw new ForbiddenException("Only the assigned trainer can complete training.");
    }
    const cert = await this.prisma.document.count({ where: { projectId: id, type: "TRAINING_CERTIFICATE" } });
    if (!cert) throw new RuleViolation(["Upload the client-signed training certificate first."]);
    await this.prisma.installation.update({ where: { projectId: id }, data: { trainingCompletedAt: new Date() } });
    await this.audit.record({ actorId: user.id, action: "training.completed", entity: "Project", entityId: id });
    return this.projects.get(user, id);
  }

  /** FR-020, FR-036, FR-038: Sales logs loan instalments and scheduled collections. */
  @Post("payments")
  async logPayment(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const b = parse(PaymentBody, body);
    const p = await this.load(user, id, ["SALES"]);
    const errors = validatePaymentEntry(b);
    if (!(PAYMENT_MODES as readonly string[]).includes(b.mode)) errors.push("Payment mode is required.");
    if (errors.length) throw new RuleViolation(errors);
    if (!p.completedStages.includes("PROJECT_INITIATED")) throw new RuleViolation(["Log further payments after the project is initiated."]);
    if (b.kind !== "COLLECTION") {
      const loan = await this.prisma.loanApplication.findUnique({ where: { projectId: id } });
      if (!p.completedStages.includes("LOAN_PROCESSED") || !loan) throw new RuleViolation(["Loan instalments are logged after the loan is processed."]);
      if (b.kind === "LOAN_INSTALMENT_2") {
        const first = await this.prisma.payment.findFirst({ where: { projectId: id, kind: "LOAN_INSTALMENT_1", status: "APPROVED" } });
        if (!first) throw new RuleViolation(["The first loan instalment must be verified first."]);
      }
      const dupKind = await this.prisma.payment.findFirst({ where: { projectId: id, kind: b.kind, status: { not: "REJECTED" } } });
      if (dupKind) throw new RuleViolation(["This instalment has already been logged."]);
    }
    const dup = await this.prisma.payment.findFirst({ where: { utr: b.utr.trim(), status: { not: "REJECTED" } } });
    if (dup) throw new RuleViolation(["This UTR number has already been logged."]);
    await this.prisma.payment.create({
      data: { projectId: id, kind: b.kind, amount: new Prisma.Decimal(b.amount), mode: b.mode, utr: b.utr.trim(), loggedById: user.id },
    });
    await this.audit.record({ actorId: user.id, action: "payment.logged", entity: "Project", entityId: id, meta: { kind: b.kind, amount: b.amount } });
    return this.projects.get(user, id);
  }

  /** FR-020, FR-037, FR-038: Accounts verifies instalments and collections individually. */
  @Post("payments/:paymentId/verify")
  @HttpCode(200)
  async verifyPayment(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("paymentId") paymentId: string, @Body() body: unknown) {
    const b = parse(VerifyBody, body);
    await this.load(user, id, ["ACCOUNTS"]);
    const pay = await this.prisma.payment.findFirst({ where: { id: paymentId, projectId: id } });
    if (!pay) throw new NotFoundException("Payment not found.");
    if (pay.kind === "ADVANCE") throw new RuleViolation(["Verify the advance from the project's Payment Verified step."]);
    if (pay.status !== "LOGGED") throw new RuleViolation(["This payment has already been verified."]);
    if (b.decision === "REJECTED" && !b.reason) throw new RuleViolation(["A reason is required to reject a payment."]);
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: b.decision, verifiedById: user.id, verifiedAt: new Date(), rejectionReason: b.decision === "REJECTED" ? b.reason : null },
    });
    await this.audit.record({ actorId: user.id, action: `payment.${b.decision.toLowerCase()}`, entity: "Project", entityId: id, meta: { paymentId } });
    return this.projects.get(user, id);
  }
}
