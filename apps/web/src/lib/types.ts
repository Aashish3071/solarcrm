import type { TaskRow } from "@/components/TaskActions";
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
  gov: { status: string; registrationNo: string | null } | null;
  loan: { status: string; bank: string; approvedAmount: string | null; requestedAmount: string; clientReconfirmedAt: string | null } | null;
  discom: { status: string; applicationNo: string; meterNumber: string | null } | null;
  plan: {
    plannedStart: string | null; expectedEnd: string | null; actualStart: string | null; actualEnd: string | null;
    materialReadyAt: string | null; dispatchedAt: string | null; receivedAt: string | null;
  } | null;
  install: { trainingAssigneeId: string | null; trainingCompletedAt: string | null; completedAt: string | null } | null;
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
  documents: { id: string; type: string; stage: string; fileName: string; mimeType: string; size: number; uploadedAt: string }[];
  gov: { status: string; registrationNo: string | null; registrationDate: string | null; notes: string | null } | null;
  loan: {
    bank: string;
    status: string;
    requestedAmount: string;
    approvedAmount: string | null;
    clientReconfirmedAt: string | null;
    notes: string | null;
    split: { bank: string; customer: string } | null;
  } | null;
  discom: { applicationNo: string; status: string; meterNumber: string | null; finalApprovalDate: string | null; notes: string | null } | null;
  plan: {
    revisitAt: string | null;
    revisitNotes: string | null;
    plannedStart: string | null;
    expectedEnd: string | null;
    actualStart: string | null;
    actualEnd: string | null;
    rescheduleCount: number;
    delayReason: string | null;
    materialReadyAt: string | null;
    readyRemark: string | null;
    dispatchedAt: string | null;
    receivedAt: string | null;
    receivedRemark: string | null;
  } | null;
  install: { startedAt: string | null; endedAt: string | null; trainingAssigneeId: string | null; trainingCompletedAt: string | null; completedAt: string | null } | null;
  schedule: { id: string; position: number; label: string; payer: "CUSTOMER" | "BANK"; amount: string; dueDate: string }[];
  incentive: {
    incentivePct?: string;
    incentiveAmount?: string;
    partnerCommissionPct: string;
    partnerCommissionAmount: string;
    provisional: boolean;
    calculatedAt: string;
  } | null;
}

export const PAYMENT_KIND_LABEL: Record<Payment["kind"], string> = {
  ADVANCE: "Advance",
  LOAN_INSTALMENT_1: "Loan instalment 1",
  LOAN_INSTALMENT_2: "Loan instalment 2",
  COLLECTION: "Collection",
};

export interface WorkData {
  counts: { overdue: number; dueToday: number; completedToday: number; next7Days: number; slaBreached: number };
  tasks: TaskRow[];
  clocks: { projectId: string; projectCode: string; customerName: string; stage: string; label: string; state: "OK" | "WARN" | "BREACHED" | "PAUSED"; dueAt: string; remainingMs: number }[];
}

