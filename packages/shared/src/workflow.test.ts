import { describe, expect, it } from "vitest";
import {
  STAGES,
  STAGE_DEFS,
  availableStages,
  checkCompletion,
  currentStage,
  initialSkipped,
  type ProjectState,
  type Stage,
} from "./workflow";

const upTo = (last: Stage): Stage[] => STAGES.slice(0, STAGES.indexOf(last) + 1);
const state = (completed: Stage[], loanRequired = true): ProjectState => ({
  completed,
  skipped: initialSkipped(loanRequired),
  loanRequired,
  supervisorAssignedAt: new Date("2026-09-01T00:00:00Z"),
});

describe("stage definitions", () => {
  it("has 23 stages numbered in order", () => {
    expect(STAGES).toHaveLength(23);
    STAGES.forEach((s, i) => expect(STAGE_DEFS[s].number).toBe(i + 1));
  });
  it("only depends on earlier stages", () => {
    for (const s of STAGES) {
      for (const r of STAGE_DEFS[s].requires) expect(STAGES.indexOf(r)).toBeLessThan(STAGES.indexOf(s));
    }
  });
});

describe("gates", () => {
  it("blocks advance payment before customer confirmation (FR-008)", () => {
    const r = checkCompletion("ADVANCE_LOGGED", "SALES", state(upTo("SALES_FINALIZED")), { amount: 1, mode: "NEFT", utr: "x" });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Customer Confirmation/);
  });

  it("blocks initiation until Accounts approves (FR-010/011)", () => {
    expect(checkCompletion("PROJECT_INITIATED", "SALES", state(upTo("ADVANCE_LOGGED")), { officeExecutiveId: "u1" }).ok).toBe(false);
    expect(checkCompletion("PAYMENT_VERIFIED", "ACCOUNTS", state(upTo("ADVANCE_LOGGED")), { decision: "REJECTED" }).ok).toBe(false);
    expect(checkCompletion("PAYMENT_VERIFIED", "ACCOUNTS", state(upTo("ADVANCE_LOGGED")), { decision: "APPROVED" }).ok).toBe(true);
  });

  it("enforces the role for each stage", () => {
    const p = state(upTo("ADVANCE_LOGGED"));
    expect(checkCompletion("PAYMENT_VERIFIED", "SALES", p, { decision: "APPROVED" }).errors[0]).toMatch(/role/);
    expect(checkCompletion("PAYMENT_VERIFIED", "ADMIN", p, { decision: "APPROVED" }).ok).toBe(true);
  });

  it("rejects discounts above 4% at finalization", () => {
    const p = state(upTo("VISIT_COMPLETED"));
    const base = { finalCost: 270000, paymentTerms: "30/60/10" };
    expect(checkCompletion("SALES_FINALIZED", "SALES", p, { ...base, discountPct: 4.5 }).ok).toBe(false);
    expect(checkCompletion("SALES_FINALIZED", "SALES", p, { ...base, discountPct: 3.5 }).ok).toBe(true);
  });

  it("requires loan re-confirmation when approved amount changes (FR-017/018)", () => {
    const p = state(upTo("PROJECT_INITIATED"));
    expect(checkCompletion("LOAN_PROCESSED", "LOAN_OFFICER", p, { requestedAmount: 200000, approvedAmount: 180000 }).ok).toBe(false);
    expect(
      checkCompletion("LOAN_PROCESSED", "LOAN_OFFICER", p, { requestedAmount: 200000, approvedAmount: 180000, clientReconfirmed: true }).ok,
    ).toBe(true);
  });

  it("requires the FR-002 requirement fields", () => {
    const p = state(["LEAD_CREATED"]);
    const base = { requiredKw: 5, projectType: "Residential", packageName: "Standard" };
    expect(checkCompletion("REQUIREMENT_CAPTURED", "SALES", p, {}).errors.length).toBeGreaterThanOrEqual(4);
    expect(checkCompletion("REQUIREMENT_CAPTURED", "SALES", p, { ...base, loanRequired: true }).errors).toEqual(["Enter the loan amount."]);
    expect(checkCompletion("REQUIREMENT_CAPTURED", "SALES", p, { ...base, loanRequired: true, loanAmount: 200000 }).ok).toBe(true);
    expect(checkCompletion("REQUIREMENT_CAPTURED", "SALES", p, { ...base, loanRequired: false }).ok).toBe(true);
  });

  it("requires feasibility and actual capacity after the visit (FR-006)", () => {
    const p = state(upTo("VISIT_SCHEDULED"));
    expect(checkCompletion("VISIT_COMPLETED", "SITE_SUPERVISOR", p, { feasible: true }).ok).toBe(false);
    expect(checkCompletion("VISIT_COMPLETED", "SITE_SUPERVISOR", p, { feasible: true, actualKw: 4.5 }).ok).toBe(true);
  });

  it("system-only stages cannot be completed by people", () => {
    const p = state(STAGES.filter((s) => s !== "INCENTIVE_CALCULATED"));
    expect(checkCompletion("INCENTIVE_CALCULATED", "SALES", p).ok).toBe(false);
    expect(checkCompletion("INCENTIVE_CALCULATED", "SYSTEM", p).ok).toBe(true);
  });
});

describe("parallel tracks after initiation", () => {
  it("opens government, loan, DISCOM and design together", () => {
    expect(availableStages(state(upTo("PROJECT_INITIATED")))).toEqual([
      "GOV_REGISTERED",
      "LOAN_PROCESSED",
      "DISCOM_APPLIED",
      "DESIGN_UPLOADED",
    ]);
  });

  it("skips loan when not required (FR-013)", () => {
    const p = state(upTo("PROJECT_INITIATED"), false);
    expect(availableStages(p)).not.toContain("LOAN_PROCESSED");
  });

  it("payment collection waits for loan when a loan exists", () => {
    const done = STAGES.filter((s) => s !== "LOAN_PROCESSED" && STAGES.indexOf(s) < STAGES.indexOf("PAYMENTS_COLLECTED"));
    const withLoan = state(done, true);
    expect(checkCompletion("PAYMENTS_COLLECTED", "ACCOUNTS", withLoan, { allPaymentsVerified: true }).ok).toBe(false);
    const noLoan = state(done, false);
    expect(checkCompletion("PAYMENTS_COLLECTED", "ACCOUNTS", noLoan, { allPaymentsVerified: true }).ok).toBe(true);
  });

  it("reports the earliest open stage as current", () => {
    expect(currentStage(state([]))).toBe("LEAD_CREATED");
    expect(currentStage(state(["LEAD_CREATED"]))).toBe("REQUIREMENT_CAPTURED");
    expect(currentStage(state([...STAGES]))).toBeNull();
  });
});
