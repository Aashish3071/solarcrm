import type { Role } from "./roles";
import {
  validateDelayRemark,
  validateDiscount,
  validateInstallation,
  validatePaymentEntry,
  validateVisitSchedule,
} from "./rules";

/**
 * The 23 lifecycle stages from FRD §5, modelled as a dependency graph rather
 * than a single linear status: after Project Initiated, government
 * registration, loan, DISCOM and design proceed in parallel (FRD §4.4–4.7).
 * A stage can be completed once all its prerequisites are completed or skipped.
 */
export const STAGES = [
  "LEAD_CREATED",
  "REQUIREMENT_CAPTURED",
  "SUPERVISOR_ASSIGNED",
  "VISIT_SCHEDULED",
  "VISIT_COMPLETED",
  "SALES_FINALIZED",
  "CUSTOMER_CONFIRMED",
  "ADVANCE_LOGGED",
  "PAYMENT_VERIFIED",
  "PROJECT_INITIATED",
  "GOV_REGISTERED",
  "LOAN_PROCESSED",
  "DISCOM_APPLIED",
  "DESIGN_UPLOADED",
  "PROJECT_PLANNED",
  "MATERIAL_READY",
  "DISPATCHED",
  "RECEIVED_AT_SITE",
  "INSTALLATION_DONE",
  "COMPLETED",
  "FINAL_DISCOM_APPROVED",
  "PAYMENTS_COLLECTED",
  "INCENTIVE_CALCULATED",
] as const;

export type Stage = (typeof STAGES)[number];

export interface ProjectState {
  completed: readonly Stage[];
  skipped: readonly Stage[];
  loanRequired: boolean;
  supervisorAssignedAt?: Date | null;
  discountCeilingPct?: number;
}

export type StageInput = Record<string, unknown>;

interface StageDef {
  number: number;
  label: string;
  actors: readonly Role[];
  /** Completed by the system rather than a person (FRD actor "System"). */
  system?: boolean;
  requires: readonly Stage[];
  frd: string;
  guard?: (input: StageInput, project: ProjectState) => string[];
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN);
const date = (v: unknown) => (v instanceof Date ? v : typeof v === "string" && v ? new Date(v) : null);
const required = (input: StageInput, fields: Record<string, string>) =>
  Object.entries(fields).filter(([k]) => !str(input[k]) && input[k] !== true).map(([, msg]) => msg);

export const STAGE_DEFS: Record<Stage, StageDef> = {
  LEAD_CREATED: { number: 1, label: "Lead Created", actors: ["SALES", "SALES_PARTNER"], requires: [], frd: "FR-001" },
  REQUIREMENT_CAPTURED: {
    number: 2, label: "Requirement Captured", actors: ["SALES"], requires: ["LEAD_CREATED"], frd: "FR-002",
    guard: (i) => {
      const errors = required(i, { projectType: "Select the project type.", packageName: "Select the package." });
      if (!(num(i.requiredKw) > 0)) errors.push("Required capacity (kW) must be greater than zero.");
      if (typeof i.loanRequired !== "boolean") errors.push("Record whether a loan is required.");
      else if (i.loanRequired && !(num(i.loanAmount) > 0)) errors.push("Enter the loan amount.");
      return errors;
    },
  },
  SUPERVISOR_ASSIGNED: {
    number: 3, label: "Site Supervisor Assigned", actors: ["SALES"], requires: ["REQUIREMENT_CAPTURED"], frd: "FR-004",
    guard: (i) => required(i, { supervisorId: "Select a Site Supervisor." }),
  },
  VISIT_SCHEDULED: {
    number: 4, label: "Site Visit Scheduled", actors: ["SITE_SUPERVISOR"], requires: ["SUPERVISOR_ASSIGNED"], frd: "FR-005",
    guard: (i, p) =>
      p.supervisorAssignedAt
        ? validateVisitSchedule({ assignedAt: p.supervisorAssignedAt, scheduledAt: date(i.scheduledAt), reason: str(i.reason) })
        : ["Supervisor assignment time is missing."],
  },
  VISIT_COMPLETED: {
    number: 5, label: "Site Visit Completed", actors: ["SITE_SUPERVISOR"], requires: ["VISIT_SCHEDULED"], frd: "FR-006",
    guard: (i) => [
      ...(typeof i.feasible === "boolean" ? [] : ["Record whether the site is feasible."]),
      ...(num(i.actualKw) > 0 ? [] : ["Enter the feasible capacity (kW) found on site."]),
    ],
  },
  SALES_FINALIZED: {
    number: 6, label: "Sales Finalization", actors: ["SALES"], requires: ["VISIT_COMPLETED"], frd: "FR-007, FR-039",
    guard: (i, p) => [
      ...(num(i.finalCost) > 0 ? [] : ["Final cost must be greater than zero."]),
      ...validateDiscount(num(i.discountPct), p.discountCeilingPct ?? 4),
      ...required(i, { paymentTerms: "Payment terms are required." }),
    ],
  },
  CUSTOMER_CONFIRMED: { number: 7, label: "Customer Confirmation", actors: ["SALES", "CUSTOMER"], requires: ["SALES_FINALIZED"], frd: "FR-008" },
  ADVANCE_LOGGED: {
    number: 8, label: "Advance Payment Logged", actors: ["SALES"], requires: ["CUSTOMER_CONFIRMED"], frd: "FR-009",
    guard: (i) => validatePaymentEntry({ amount: num(i.amount), mode: str(i.mode), utr: str(i.utr) }),
  },
  PAYMENT_VERIFIED: {
    number: 9, label: "Payment Verified", actors: ["ACCOUNTS"], requires: ["ADVANCE_LOGGED"], frd: "FR-010",
    guard: (i) => (i.decision === "APPROVED" ? [] : ["Only an approved payment completes this stage."]),
  },
  PROJECT_INITIATED: {
    number: 10, label: "Project Initiated", actors: ["SALES"], requires: ["PAYMENT_VERIFIED"], frd: "FR-011",
    guard: (i) => required(i, { officeExecutiveId: "Assign an Office Executive." }),
  },
  GOV_REGISTERED: {
    number: 11, label: "Government Registration", actors: ["OFFICE_EXECUTIVE"], requires: ["PROJECT_INITIATED"], frd: "FR-012",
    guard: (i) => required(i, { registrationNo: "Registration number is required.", registrationDate: "Registration date is required." }),
  },
  LOAN_PROCESSED: {
    number: 12, label: "Loan Processing", actors: ["LOAN_OFFICER"], requires: ["PROJECT_INITIATED"], frd: "FR-016–FR-019",
    guard: (i) => {
      const requested = num(i.requestedAmount);
      const approved = num(i.approvedAmount);
      if (!(approved > 0)) return ["Approved loan amount is required."];
      if (approved !== requested && i.clientReconfirmed !== true) {
        return ["Approved amount differs from requested; Sales must re-confirm with the client first."];
      }
      return [];
    },
  },
  DISCOM_APPLIED: {
    number: 13, label: "DISCOM Application", actors: ["DISCOM_OFFICER"], requires: ["PROJECT_INITIATED"], frd: "FR-021",
    guard: (i) => required(i, { applicationNo: "DISCOM application number is required." }),
  },
  DESIGN_UPLOADED: {
    number: 14, label: "Site Revisit & Design", actors: ["SITE_SUPERVISOR"], requires: ["PROJECT_INITIATED"], frd: "FR-023, FR-024",
    guard: (i) => required(i, {
      revisitAt: "Record the site revisit date.",
      designDocId: "Upload the final site design.",
      installationPlanDocId: "Upload the installation plan.",
    }),
  },
  PROJECT_PLANNED: {
    number: 15, label: "Project Planning", actors: ["PROJECT_ENGINEER"], requires: ["DESIGN_UPLOADED"], frd: "FR-015, FR-025, FR-026",
    guard: (i) => required(i, { startDate: "Project start date is required." }),
  },
  MATERIAL_READY: {
    number: 16, label: "Material Ready to Dispatch", actors: ["STORE_MANAGER"], requires: ["PROJECT_PLANNED"], frd: "FR-027",
    guard: (i) => delay(i),
  },
  DISPATCHED: { number: 17, label: "Dispatched", actors: ["STORE_MANAGER"], system: true, requires: ["MATERIAL_READY"], frd: "FR-028" },
  RECEIVED_AT_SITE: {
    number: 18, label: "Received at Site", actors: ["SITE_SUPERVISOR"], requires: ["DISPATCHED"], frd: "FR-029",
    guard: (i) => delay(i),
  },
  INSTALLATION_DONE: {
    number: 19, label: "Installation / Execution", actors: ["SITE_SUPERVISOR", "PROJECT_ENGINEER"], requires: ["RECEIVED_AT_SITE"], frd: "FR-031",
    guard: (i) => validateInstallation({ startedAt: date(i.startedAt), endedAt: date(i.endedAt), photoCount: num(i.photoCount) || 0 }),
  },
  COMPLETED: {
    number: 20, label: "Completion", actors: ["PROJECT_ENGINEER", "OFFICE_EXECUTIVE"], requires: ["INSTALLATION_DONE"], frd: "FR-032, FR-033",
    guard: (i) => required(i, { completionCertificateDocId: "Upload the signed completion certificate." }),
  },
  FINAL_DISCOM_APPROVED: {
    number: 21, label: "Final DISCOM Approval", actors: ["DISCOM_OFFICER"], requires: ["DISCOM_APPLIED", "COMPLETED"], frd: "FR-034",
    guard: (i) => required(i, { meterNumber: "Meter number is required." }),
  },
  PAYMENTS_COLLECTED: {
    number: 22, label: "Payment Collection", actors: ["SALES", "ACCOUNTS"], requires: ["COMPLETED", "LOAN_PROCESSED"], frd: "FR-036–FR-038",
    guard: (i) => (i.allPaymentsVerified === true ? [] : ["All scheduled payments must be verified by Accounts."]),
  },
  INCENTIVE_CALCULATED: {
    number: 23, label: "Incentive / Commission", actors: [], system: true, requires: ["PAYMENTS_COLLECTED"], frd: "FR-039–FR-043",
  },
};

function delay(i: StageInput): string[] {
  const plannedAt = date(i.plannedAt);
  const actualAt = date(i.actualAt) ?? new Date();
  return plannedAt ? validateDelayRemark({ plannedAt, actualAt, remark: str(i.remark) }) : [];
}

/** Stages that are skipped rather than completed, e.g. loan when not required (FR-013). */
export function initialSkipped(loanRequired: boolean): Stage[] {
  return loanRequired ? [] : ["LOAN_PROCESSED"];
}

function done(stage: Stage, p: ProjectState) {
  return p.completed.includes(stage) || p.skipped.includes(stage);
}

/** Stages whose prerequisites are met and that are not yet done. */
export function availableStages(p: ProjectState): Stage[] {
  return STAGES.filter((s) => !done(s, p) && STAGE_DEFS[s].requires.every((r) => done(r, p)));
}

/** The earliest stage that is not yet done; used as the headline "current stage". */
export function currentStage(p: ProjectState): Stage | null {
  return STAGES.find((s) => !done(s, p)) ?? null;
}

export interface CompletionCheck {
  ok: boolean;
  errors: string[];
}

/**
 * Server-side gate for completing a stage. `actor` is either a user role or
 * "SYSTEM". ADMIN may act on any stage (for operational support; revisit with
 * the permission matrix, open point 13).
 */
export function checkCompletion(
  stage: Stage,
  actor: Role | "SYSTEM",
  project: ProjectState,
  input: StageInput = {},
): CompletionCheck {
  const def = STAGE_DEFS[stage];
  if (done(stage, project)) return { ok: false, errors: [`${def.label} is already done.`] };

  const missing = def.requires.filter((r) => !done(r, project));
  if (missing.length) {
    return { ok: false, errors: missing.map((r) => `${STAGE_DEFS[r].label} must be completed first.`) };
  }

  const allowed =
    actor === "ADMIN" || (actor === "SYSTEM" ? !!def.system : def.actors.includes(actor));
  if (!allowed) return { ok: false, errors: [`Your role cannot complete ${def.label}.`] };

  const errors = def.guard ? def.guard(input, project) : [];
  return { ok: errors.length === 0, errors };
}

/**
 * FR-010: a rejected payment sends the project back so Sales can re-log it.
 * Returns the stages to un-complete.
 */
export function stagesReopenedByPaymentRejection(): Stage[] {
  return ["ADVANCE_LOGGED"];
}
