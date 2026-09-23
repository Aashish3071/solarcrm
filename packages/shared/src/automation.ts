import type { Role } from "./roles";
import { STAGE_DEFS, type Stage } from "./workflow";

/**
 * Automation (addendum FR-A01 – A05). Pure decision logic; the API supplies
 * candidates and persists outcomes. Defaults follow the proposed answers to
 * open points 15 – 18 and are editable in the Automation console.
 */
export const STRATEGIES = ["ROUND_ROBIN", "LEAST_LOAD", "TERRITORY"] as const;
export type Strategy = (typeof STRATEGIES)[number];
export type RuleMode = "SUGGEST" | "AUTO";

export interface Candidate {
  id: string;
  name: string;
  openLoad: number;
  lastAssignedAt: Date | null;
  awayUntil: Date | null;
  maxOpen: number | null;
  territories: string[];
}

export interface PickResult {
  userId: string | null;
  reason: string;
}

/** Six-digit Indian PIN code found in an address, if any. */
export function pincodeOf(address: string): string | null {
  return address.match(/\b\d{6}\b/)?.[0] ?? null;
}

/**
 * FR-A01/A02: choose an assignee. Skips people who are away or at capacity;
 * ties break on least recently assigned, then name, so results are stable.
 */
export function pickAssignee(candidates: Candidate[], strategy: Strategy, ctx: { now: Date; address?: string }): PickResult {
  const eligible = candidates.filter(
    (c) => !(c.awayUntil && c.awayUntil > ctx.now) && !(c.maxOpen !== null && c.openLoad >= c.maxOpen),
  );
  if (eligible.length === 0) return { userId: null, reason: "No one is available (away or at capacity); sent to the manager queue." };

  let pool = eligible;
  if (strategy === "TERRITORY") {
    const pin = ctx.address ? pincodeOf(ctx.address) : null;
    const inArea = pin ? eligible.filter((c) => c.territories.some((t) => pin.startsWith(t))) : [];
    if (inArea.length === 0) return { userId: null, reason: pin ? `No one covers PIN ${pin}; sent to the manager queue.` : "No PIN code in the address; sent to the manager queue." };
    pool = inArea;
  }

  const byRecency = (a: Candidate, b: Candidate) =>
    (a.lastAssignedAt?.getTime() ?? 0) - (b.lastAssignedAt?.getTime() ?? 0) || a.name.localeCompare(b.name);
  const sorted =
    strategy === "LEAST_LOAD" ? [...pool].sort((a, b) => a.openLoad - b.openLoad || byRecency(a, b)) : [...pool].sort(byRecency);
  const pick = sorted[0];
  const why =
    strategy === "LEAST_LOAD" ? `least open work (${pick.openLoad})` : strategy === "TERRITORY" ? "covers this area, longest since last assignment" : "next in rotation";
  return { userId: pick.id, reason: `${pick.name}: ${why}.` };
}

export type SlaState = "OK" | "WARN" | "BREACHED" | "PAUSED";

/** FR-A04: SLA clock state from start, target and warn threshold. Paused time is excluded. */
export function slaState(t: { startedAt: Date; targetHours: number; warnPct: number; pausedMs?: number; pausedAt?: Date | null }, now: Date): {
  state: SlaState;
  dueAt: Date;
  remainingMs: number;
} {
  const paused = (t.pausedMs ?? 0) + (t.pausedAt ? now.getTime() - t.pausedAt.getTime() : 0);
  const dueAt = new Date(t.startedAt.getTime() + t.targetHours * 3600_000 + paused);
  const elapsed = now.getTime() - t.startedAt.getTime() - paused;
  const remainingMs = dueAt.getTime() - now.getTime();
  if (t.pausedAt) return { state: "PAUSED", dueAt, remainingMs };
  if (elapsed >= t.targetHours * 3600_000) return { state: "BREACHED", dueAt, remainingMs };
  if (elapsed >= (t.targetHours * 3600_000 * t.warnPct) / 100) return { state: "WARN", dueAt, remainingMs };
  return { state: "OK", dueAt, remainingMs };
}

/** Who is responsible for a stage: the project owner for Sales stages, otherwise the assigned person for the role. */
export function responsibleRole(stage: Stage): Role | null {
  const actors = STAGE_DEFS[stage].actors;
  return actors[0] ?? null;
}

/** Stages whose completion is an assignment, and the role being assigned. */
export const ASSIGNMENT_STAGES: Partial<Record<Stage, Role>> = {
  SUPERVISOR_ASSIGNED: "SITE_SUPERVISOR",
  PROJECT_INITIATED: "OFFICE_EXECUTIVE",
};

/** Roles assigned after initiation by the Office Executive (FR-014). */
export const POST_INITIATION_ROLES: Role[] = ["LOAN_OFFICER", "DISCOM_OFFICER", "PROJECT_ENGINEER"];
