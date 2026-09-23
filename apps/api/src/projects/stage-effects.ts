import { Prisma, type PrismaClient, type Project } from "@prisma/client";
import { initialSkipped, type Stage, type StageInput } from "@solarcrm/shared";
import type { AuthUser } from "../common/auth-context";

type Tx = Prisma.TransactionClient | PrismaClient;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const dec = (v: unknown) => new Prisma.Decimal(Number(v));

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
    default:
      return;
  }
}
