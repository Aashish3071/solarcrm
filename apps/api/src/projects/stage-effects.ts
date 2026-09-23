import { Prisma, type PrismaClient, type Project } from "@prisma/client";
import { expectedEndDate, initialSkipped, type Stage, type StageInput } from "@solarcrm/shared";
import type { AuthUser } from "../common/auth-context";

type Tx = Prisma.TransactionClient | PrismaClient;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const dec = (v: unknown) => new Prisma.Decimal(Number(v));

const latestDoc = (db: Tx, projectId: string, type: Prisma.DocumentWhereInput["type"]) =>
  db.document.findFirst({ where: { projectId, type }, orderBy: { uploadedAt: "desc" }, select: { id: true } });

/**
 * Facts the server derives from its own records. They override anything the
 * client sent, so a browser cannot claim a photo or approval that doesn't exist.
 */
export async function serverFacts(db: Tx, project: Project, stage: Stage, durationDays: number): Promise<StageInput> {
  switch (stage) {
    case "DESIGN_UPLOADED":
      return {
        designDocId: (await latestDoc(db, project.id, "DESIGN"))?.id,
        installationPlanDocId: (await latestDoc(db, project.id, "INSTALLATION_PLAN"))?.id,
      };
    case "PROJECT_PLANNED":
      return { durationDays };
    case "MATERIAL_READY":
    case "RECEIVED_AT_SITE": {
      const plan = await db.projectPlan.findUnique({ where: { projectId: project.id } });
      return { plannedAt: plan?.plannedStart?.toISOString(), actualAt: new Date().toISOString() };
    }
    case "INSTALLATION_DONE":
      return { photoCount: await db.document.count({ where: { projectId: project.id, type: "INSTALLATION_PHOTO" } }) };
    case "COMPLETED":
      return { completionCertificateDocId: (await latestDoc(db, project.id, "COMPLETION_CERTIFICATE"))?.id };
    case "LOAN_PROCESSED": {
      const loan = await db.loanApplication.findUnique({ where: { projectId: project.id } });
      return {
        requestedAmount: loan ? Number(loan.requestedAmount) : undefined,
        approvedAmount: loan?.status === "APPROVED" && loan.approvedAmount ? Number(loan.approvedAmount) : undefined,
        clientReconfirmed: !!loan?.clientReconfirmedAt,
      };
    }
    case "FINAL_DISCOM_APPROVED": {
      const d = await db.discomApplication.findUnique({ where: { projectId: project.id } });
      return { meterNumber: d?.meterNumber ?? undefined };
    }
    default:
      return {};
  }
}

/**
 * Checks that need the database and so cannot live in the shared rules.
 * Returns human-readable errors.
 */
export async function preCheck(db: Tx, project: Project, stage: Stage, input: StageInput): Promise<string[]> {
  if (stage === "ADVANCE_LOGGED") {
    // The same bank transfer cannot be logged twice (supports FR-010 verification).
    const utr = str(input.utr);
    const dup = utr && (await db.payment.findFirst({ where: { utr, status: { not: "REJECTED" } } }));
    if (dup) return ["This UTR number has already been logged."];
  }
  if (stage === "PAYMENT_VERIFIED") {
    const pending = await db.payment.findFirst({ where: { projectId: project.id, kind: "ADVANCE", status: "LOGGED" } });
    if (!pending) return ["There is no logged advance payment to verify."];
  }
  if (stage === "LOAN_PROCESSED") {
    const loan = await db.loanApplication.findUnique({ where: { projectId: project.id } });
    if (loan?.status !== "APPROVED") return ["The bank has not approved the loan yet."];
  }
  if (stage === "CUSTOMER_CONFIRMED") {
    const terms = await db.salesTerms.findUnique({ where: { projectId: project.id } });
    if (!terms) return ["Finalize the package, cost and payment terms first."];
  }
  return [];
}

/** Writes the stage's business data (FR fields) inside the completion transaction. */
export async function applyEffects(tx: Tx, project: Project, stage: Stage, input: StageInput, user: AuthUser) {
  switch (stage) {
    case "REQUIREMENT_CAPTURED": {
      const loanRequired = input.loanRequired === true;
      await tx.project.update({
        where: { id: project.id },
        data: {
          requiredKw: dec(input.requiredKw),
          loanRequired,
          loanAmount: loanRequired ? dec(input.loanAmount) : null,
          projectType: str(input.projectType),
          packageName: str(input.packageName),
          skippedStages: initialSkipped(loanRequired),
        },
      });
      return;
    }
    case "VISIT_SCHEDULED":
      await tx.siteVisit.upsert({
        where: { projectId: project.id },
        create: { projectId: project.id, scheduledAt: new Date(String(input.scheduledAt)), lateReason: str(input.reason) },
        update: { scheduledAt: new Date(String(input.scheduledAt)), lateReason: str(input.reason) },
      });
      return;
    case "VISIT_COMPLETED":
      await tx.siteVisit.update({
        where: { projectId: project.id },
        data: {
          completedAt: new Date(),
          actualKw: dec(input.actualKw),
          feasible: input.feasible === true,
          suggestedPackage: str(input.suggestedPackage),
          deviations: str(input.deviations),
          siteNotes: str(input.siteNotes),
        },
      });
      return;
    case "SALES_FINALIZED": {
      const data = {
        packageName: str(input.packageName) ?? project.packageName ?? "",
        finalCost: dec(input.finalCost),
        discountPct: dec(input.discountPct),
        paymentTerms: String(input.paymentTerms).trim(),
        finalizedById: user.id,
        finalizedAt: new Date(),
      };
      await tx.salesTerms.upsert({ where: { projectId: project.id }, create: { projectId: project.id, ...data }, update: data });
      return;
    }
    case "CUSTOMER_CONFIRMED":
      await tx.salesTerms.update({
        where: { projectId: project.id },
        data: { confirmedAt: new Date(), confirmedById: user.id, confirmationNote: str(input.note) },
      });
      return;
    case "ADVANCE_LOGGED":
      await tx.payment.create({
        data: {
          projectId: project.id,
          kind: "ADVANCE",
          amount: dec(input.amount),
          mode: String(input.mode),
          utr: String(input.utr).trim(),
          loggedById: user.id,
        },
      });
      return;
    case "PAYMENT_VERIFIED": {
      const pending = await tx.payment.findFirstOrThrow({
        where: { projectId: project.id, kind: "ADVANCE", status: "LOGGED" },
        orderBy: { loggedAt: "desc" },
      });
      await tx.payment.update({ where: { id: pending.id }, data: { status: "APPROVED", verifiedById: user.id, verifiedAt: new Date() } });
      return;
    }
    case "GOV_REGISTERED": {
      const data = {
        status: "REGISTERED",
        registrationNo: String(input.registrationNo).trim(),
        registrationDate: new Date(String(input.registrationDate)),
        notes: str(input.notes),
        updatedById: user.id,
      };
      await tx.govRegistration.upsert({ where: { projectId: project.id }, create: { projectId: project.id, ...data }, update: data });
      return;
    }
    case "DISCOM_APPLIED": {
      const data = {
        applicationNo: String(input.applicationNo).trim(),
        status: str(input.status) ?? "SUBMITTED",
        meterNumber: str(input.meterNumber),
        notes: str(input.notes),
        updatedById: user.id,
      };
      await tx.discomApplication.upsert({ where: { projectId: project.id }, create: { projectId: project.id, ...data }, update: data });
      return;
    }
    case "DESIGN_UPLOADED": {
      const data = { revisitAt: new Date(String(input.revisitAt)), revisitNotes: str(input.revisitNotes) };
      await tx.projectPlan.upsert({ where: { projectId: project.id }, create: { projectId: project.id, ...data }, update: data });
      return;
    }
    case "PROJECT_PLANNED": {
      const start = new Date(String(input.startDate));
      const data = { plannedStart: start, expectedEnd: expectedEndDate(start, Number(input.durationDays)) };
      await tx.projectPlan.upsert({ where: { projectId: project.id }, create: { projectId: project.id, ...data }, update: data });
      return;
    }
    case "MATERIAL_READY":
      await tx.projectPlan.update({ where: { projectId: project.id }, data: { materialReadyAt: new Date(), readyRemark: str(input.remark) } });
      return;
    case "DISPATCHED":
      await tx.projectPlan.update({ where: { projectId: project.id }, data: { dispatchedAt: new Date() } });
      return;
    case "RECEIVED_AT_SITE":
      await tx.projectPlan.update({ where: { projectId: project.id }, data: { receivedAt: new Date(), receivedRemark: str(input.remark) } });
      return;
    case "INSTALLATION_DONE": {
      const startedAt = new Date(String(input.startedAt));
      const endedAt = new Date(String(input.endedAt));
      await tx.installation.upsert({
        where: { projectId: project.id },
        create: { projectId: project.id, startedAt, endedAt },
        update: { startedAt, endedAt },
      });
      await tx.projectPlan.update({ where: { projectId: project.id }, data: { actualStart: startedAt, actualEnd: endedAt } });
      return;
    }
    case "COMPLETED":
      await tx.installation.update({ where: { projectId: project.id }, data: { completedAt: new Date() } });
      return;
    case "FINAL_DISCOM_APPROVED":
      await tx.discomApplication.update({
        where: { projectId: project.id },
        data: { status: "FINAL_APPROVED", finalApprovalDate: input.finalApprovalDate ? new Date(String(input.finalApprovalDate)) : new Date(), updatedById: user.id },
      });
      return;
    default:
      return;
  }
}
