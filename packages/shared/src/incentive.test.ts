import { describe, expect, it } from "vitest";
import { DEFAULT_INCENTIVE_RULES as R, calculateIncentive, incentivePct } from "./incentive";

describe("FR-040 in-house incentive", () => {
  // Booklet §13 asks for checks at 1%, 3%, 3.5% and 4%.
  it.each([
    [0, 1.9],
    [1, 1.6],
    [3, 1],
    [3.5, 0.5], // the FRD's worked example
    [4, 0],
  ])("discount %f%% → incentive %f%%", (d, want) => {
    expect(incentivePct(d, R)).toBeCloseTo(want, 4);
  });

  it("refuses discounts above the ceiling or negative", () => {
    expect(() => incentivePct(4.01, R)).toThrow();
    expect(() => incentivePct(-1, R)).toThrow();
  });

  it("uses configured percentages (FR-043)", () => {
    expect(incentivePct(3, { ...R, fixedPct: 2 })).toBe(2);
  });
});

describe("FR-041/042 partner commission", () => {
  it("Full Sales Partner keeps unused discount", () => {
    const r = calculateIncentive({ orderValue: 100000, discountPct: 2, partnerType: "FULL", rules: R });
    expect(r.partnerCommissionPct).toBe(7);
    expect(r.partnerCommissionAmount).toBe(7000);
    expect(r.incentiveAmount).toBe(1300);
    expect(r.provisional).toBe(true);
  });
  it("Lead-only and direct leads earn no partner commission", () => {
    expect(calculateIncentive({ orderValue: 100000, discountPct: 2, partnerType: "LEAD_ONLY", rules: R }).partnerCommissionAmount).toBe(0);
    expect(calculateIncentive({ orderValue: 100000, discountPct: 2, partnerType: null, rules: R }).partnerCommissionAmount).toBe(0);
  });
});
