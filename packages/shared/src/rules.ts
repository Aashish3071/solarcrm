// Validation rules from FRD §6 "Key Validations & Controls".
// Each returns a list of human-readable errors; an empty list means valid.

export const LEAD_SOURCES = ["DIRECT", "SALES_PARTNER"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const PAYMENT_MODES = ["NEFT", "RTGS", "IMPS", "UPI", "CHEQUE", "CASH"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

const HOUR_MS = 60 * 60 * 1000;

/** FR-001: lead source must be Direct Source or Sales Partner. */
export function validateLeadSource(source: unknown, partnerId?: string | null): string[] {
  if (source === "DIRECT") return [];
  if (source === "SALES_PARTNER") return partnerId ? [] : ["Select the Sales Partner for this lead."];
  return ["Lead source must be Direct Source or Sales Partner."];
}

/**
 * FR-005: visit date and time are mandatory; a reason is mandatory when the
 * visit is scheduled more than 24 hours after the supervisor was assigned.
 */
export function validateVisitSchedule(input: {
  assignedAt: Date;
  scheduledAt?: Date | null;
  reason?: string | null;
}): string[] {
  if (!input.scheduledAt || Number.isNaN(input.scheduledAt.getTime())) {
    return ["Visit date and time are required."];
  }
  const gap = input.scheduledAt.getTime() - input.assignedAt.getTime();
  if (gap > 24 * HOUR_MS && !input.reason?.trim()) {
    return ["A reason is required when the visit is more than 24 hours after assignment."];
  }
  return [];
}

/** FR-009: advance (and every logged) payment needs amount, mode and UTR. */
export function validatePaymentEntry(input: {
  amount?: number | null;
  mode?: string | null;
  utr?: string | null;
}): string[] {
  const errors: string[] = [];
  if (typeof input.amount !== "number" || !(input.amount > 0)) errors.push("Amount must be greater than zero.");
  if (!input.mode || !(PAYMENT_MODES as readonly string[]).includes(input.mode)) errors.push("Payment mode is required.");
  if (!input.utr?.trim()) errors.push("UTR number is required.");
  return errors;
}

/** FR-039: discount shall not exceed the configured ceiling (4% per FRD). */
export function validateDiscount(discountPct: number, ceilingPct = 4): string[] {
  if (!Number.isFinite(discountPct) || discountPct < 0) return ["Discount must be zero or more."];
  if (discountPct > ceilingPct) return [`Discount cannot exceed ${ceilingPct}%.`];
  return [];
}

/** FR-027 / FR-029: a remark is required when dispatch or site receipt is delayed. */
export function validateDelayRemark(input: {
  plannedAt: Date;
  actualAt: Date;
  remark?: string | null;
}): string[] {
  if (input.actualAt.getTime() > input.plannedAt.getTime() && !input.remark?.trim()) {
    return ["A delay remark is required because this is later than planned."];
  }
  return [];
}

/** FR-031: execution start/end dates and at least one photo are mandatory. */
export function validateInstallation(input: {
  startedAt?: Date | null;
  endedAt?: Date | null;
  photoCount: number;
}): string[] {
  const errors: string[] = [];
  if (!input.startedAt) errors.push("Execution start date is required.");
  if (!input.endedAt) errors.push("Execution end date is required.");
  if (input.startedAt && input.endedAt && input.endedAt < input.startedAt) {
    errors.push("Execution end date cannot be before the start date.");
  }
  if (input.photoCount < 1) errors.push("Upload at least one installation photo.");
  return errors;
}

/**
 * FR-026: expected end date is system-calculated from the start date.
 * The exact formula is an open point; duration is passed in from configuration.
 */
export function expectedEndDate(start: Date, durationDays: number): Date {
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + durationDays);
  return end;
}
