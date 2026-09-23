/**
 * FR-039 – FR-043 incentive and partner commission.
 *
 * The FRD fixes these points:
 *  - discount ≤ ceiling (4%)
 *  - discount ≤ 3%: 1% fixed incentive + 30% of the remaining margin
 *  - 3% – 4%: incentive reduces; 3.5% discount → 0.5% incentive (the one worked example)
 *  - Full Sales Partner: predefined commission (e.g. 5%); keeps the difference if it gives less discount
 *  - all percentages configurable per user/role
 *
 * Interpretations used until the client confirms (open points 10 and 11), so
 * every result is marked provisional:
 *  - "remaining margin" = the discount headroom not used below the full-incentive threshold (3% − discount)
 *  - between the threshold and the ceiling the incentive falls linearly from the fixed % to 0,
 *    which reproduces 3.5% → 0.5%
 *  - partner commission = commission % + (ceiling − discount); Lead-only partners earn nothing until rules are supplied
 */
export interface IncentiveRules {
  ceilingPct: number;
  fullIncentiveUpToPct: number;
  fixedPct: number;
  marginSharePct: number;
  partnerCommissionPct: number;
}

export const DEFAULT_INCENTIVE_RULES: IncentiveRules = {
  ceilingPct: 4,
  fullIncentiveUpToPct: 3,
  fixedPct: 1,
  marginSharePct: 30,
  partnerCommissionPct: 5,
};

export interface IncentiveResult {
  incentivePct: number;
  incentiveAmount: number;
  partnerCommissionPct: number;
  partnerCommissionAmount: number;
  provisional: true;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function incentivePct(discountPct: number, r: IncentiveRules): number {
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > r.ceilingPct) {
    throw new Error("Discount is outside the allowed range.");
  }
  if (discountPct <= r.fullIncentiveUpToPct) {
    return round4(r.fixedPct + (r.marginSharePct / 100) * (r.fullIncentiveUpToPct - discountPct));
  }
  const band = r.ceilingPct - r.fullIncentiveUpToPct;
  return round4(band > 0 ? r.fixedPct * ((r.ceilingPct - discountPct) / band) : 0);
}

export function calculateIncentive(input: {
  orderValue: number;
  discountPct: number;
  partnerType: "LEAD_ONLY" | "FULL" | null;
  rules: IncentiveRules;
}): IncentiveResult {
  const pct = incentivePct(input.discountPct, input.rules);
  const partnerPct =
    input.partnerType === "FULL" ? round4(input.rules.partnerCommissionPct + (input.rules.ceilingPct - input.discountPct)) : 0;
  return {
    incentivePct: pct,
    incentiveAmount: round2((input.orderValue * pct) / 100),
    partnerCommissionPct: partnerPct,
    partnerCommissionAmount: round2((input.orderValue * partnerPct) / 100),
    provisional: true,
  };
}
