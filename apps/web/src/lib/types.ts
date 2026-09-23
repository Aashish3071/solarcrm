import type { Role, Stage } from "@solarcrm/shared";

export interface ProjectRow {
  id: string;
  code: string;
  customerName: string;
  phone: string;
  address: string;
  requiredKw: string | null;
  loanRequired: boolean;
  loanAmount: string | null;
  projectType: string | null;
  packageName: string | null;
  leadSource: "DIRECT" | "SALES_PARTNER";
  partnerName: string | null;
  ownerName: string | null;
  completedStages: Stage[];
  skippedStages: Stage[];
  currentStage: Stage | null;
  currentStageNumber: number;
  availableStages: Stage[];
  createdAt: string;
}

/** Row shape returned by GET /projects (list), with summary joins. */
export interface ProjectListRow extends ProjectRow {
  team: Partial<Record<Role, string>>;
  visit: { scheduledAt: string | null; completedAt: string | null; feasible: boolean | null } | null;
  terms: { finalCost: string; discountPct: string; confirmedAt: string | null } | null;
}

export interface Payment {
  id: string;
  kind: "ADVANCE" | "LOAN_INSTALMENT_1" | "LOAN_INSTALMENT_2" | "COLLECTION";
  amount: string;
  mode: string;
  utr: string;
  status: "LOGGED" | "APPROVED" | "REJECTED";
  loggedAt: string;
  verifiedAt: string | null;
  rejectionReason: string | null;
}

export interface ProjectDetail extends ProjectRow {
  email: string | null;
  assignments: { role: Role; userId: string; name: string; assignedAt: string }[];
  events: { stage: Stage; action: "COMPLETED" | "REOPENED"; actorRole: Role; at: string }[];
  siteVisit: {
    scheduledAt: string | null;
    lateReason: string | null;
    completedAt: string | null;
    actualKw: string | null;
    feasible: boolean | null;
    suggestedPackage: string | null;
    deviations: string | null;
    siteNotes: string | null;
  } | null;
  terms: {
    packageName: string;
    finalCost: string;
    discountPct: string;
    paymentTerms: string;
    finalizedAt: string;
    confirmedAt: string | null;
    confirmationNote: string | null;
  } | null;
  payments: Payment[];
}

export const PAYMENT_KIND_LABEL: Record<Payment["kind"], string> = {
  ADVANCE: "Advance",
  LOAN_INSTALMENT_1: "Loan instalment 1",
  LOAN_INSTALMENT_2: "Loan instalment 2",
  COLLECTION: "Collection",
};
