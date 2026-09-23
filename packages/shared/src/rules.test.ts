import { describe, expect, it } from "vitest";
import {
  expectedEndDate,
  validateDelayRemark,
  validateDiscount,
  validateInstallation,
  validateLeadSource,
  validatePaymentEntry,
  validateVisitSchedule,
} from "./rules";

const at = (h: number) => new Date(Date.UTC(2026, 8, 1, 0) + h * 3600_000);

describe("FR-001 lead source", () => {
  it.each([
    ["DIRECT", null, 0],
    ["SALES_PARTNER", "p1", 0],
    ["SALES_PARTNER", null, 1],
    ["WEBSITE", null, 1],
    [undefined, null, 1],
  ])("%s / partner %s → %i errors", (src, partner, n) => {
    expect(validateLeadSource(src, partner)).toHaveLength(n);
  });
});

describe("FR-005 visit schedule", () => {
  it("requires a date", () => {
    expect(validateVisitSchedule({ assignedAt: at(0), scheduledAt: null })).toHaveLength(1);
  });
  it("accepts exactly 24h without a reason", () => {
    expect(validateVisitSchedule({ assignedAt: at(0), scheduledAt: at(24) })).toEqual([]);
  });
  it("requires a reason beyond 24h", () => {
    expect(validateVisitSchedule({ assignedAt: at(0), scheduledAt: at(25) })).toHaveLength(1);
    expect(validateVisitSchedule({ assignedAt: at(0), scheduledAt: at(25), reason: "  " })).toHaveLength(1);
    expect(validateVisitSchedule({ assignedAt: at(0), scheduledAt: at(25), reason: "Customer away" })).toEqual([]);
  });
});

describe("FR-009 payment entry", () => {
  it("needs amount, mode and UTR", () => {
    expect(validatePaymentEntry({})).toHaveLength(3);
    expect(validatePaymentEntry({ amount: 45000, mode: "NEFT", utr: "N123" })).toEqual([]);
    expect(validatePaymentEntry({ amount: 0, mode: "NEFT", utr: "N123" })).toHaveLength(1);
    expect(validatePaymentEntry({ amount: 10, mode: "BITCOIN", utr: "x" })).toHaveLength(1);
  });
});

describe("FR-039 discount ceiling", () => {
  it.each([
    [0, 0],
    [3, 0],
    [4, 0],
    [4.01, 1],
    [-1, 1],
    [NaN, 1],
  ])("%f%% → %i errors", (d, n) => {
    expect(validateDiscount(d)).toHaveLength(n);
  });
  it("respects a configured ceiling", () => {
    expect(validateDiscount(3.5, 3)).toHaveLength(1);
  });
});

describe("FR-027/029 delay remark", () => {
  it("only when late", () => {
    expect(validateDelayRemark({ plannedAt: at(10), actualAt: at(9) })).toEqual([]);
    expect(validateDelayRemark({ plannedAt: at(10), actualAt: at(11) })).toHaveLength(1);
    expect(validateDelayRemark({ plannedAt: at(10), actualAt: at(11), remark: "Truck delayed" })).toEqual([]);
  });
});

describe("FR-031 installation", () => {
  it("requires dates and a photo", () => {
    expect(validateInstallation({ photoCount: 0 })).toHaveLength(3);
    expect(validateInstallation({ startedAt: at(0), endedAt: at(5), photoCount: 1 })).toEqual([]);
    expect(validateInstallation({ startedAt: at(5), endedAt: at(0), photoCount: 1 })).toHaveLength(1);
  });
});

describe("FR-026 expected end date", () => {
  it("adds configured days", () => {
    expect(expectedEndDate(new Date("2026-09-01T00:00:00Z"), 12).toISOString()).toBe("2026-09-13T00:00:00.000Z");
  });
});
