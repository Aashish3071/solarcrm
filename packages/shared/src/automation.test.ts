import { describe, expect, it } from "vitest";
import { pickAssignee, pincodeOf, slaState, type Candidate } from "./automation";

const now = new Date("2026-09-24T10:00:00Z");
const c = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id, name: id, openLoad: 0, lastAssignedAt: null, awayUntil: null, maxOpen: null, territories: [], ...over,
});

describe("FR-A01/A02 assignment strategies", () => {
  it("round-robin picks whoever was assigned longest ago", () => {
    const r = pickAssignee([c("a", { lastAssignedAt: new Date("2026-09-24T09:00:00Z") }), c("b", { lastAssignedAt: new Date("2026-09-23T09:00:00Z") })], "ROUND_ROBIN", { now });
    expect(r.userId).toBe("b");
  });
  it("never-assigned people go first, ties break by name", () => {
    expect(pickAssignee([c("zoe"), c("amy")], "ROUND_ROBIN", { now }).userId).toBe("amy");
  });
  it("least-load picks the lightest queue", () => {
    expect(pickAssignee([c("a", { openLoad: 5 }), c("b", { openLoad: 2 })], "LEAST_LOAD", { now }).userId).toBe("b");
  });
  it("skips people who are away or at capacity", () => {
    const r = pickAssignee(
      [c("a", { awayUntil: new Date("2026-09-30T00:00:00Z") }), c("b", { openLoad: 3, maxOpen: 3 }), c("c", { openLoad: 9 })],
      "LEAST_LOAD",
      { now },
    );
    expect(r.userId).toBe("c");
  });
  it("falls back to the manager queue when no one is eligible", () => {
    const r = pickAssignee([c("a", { awayUntil: new Date("2026-09-30T00:00:00Z") })], "ROUND_ROBIN", { now });
    expect(r.userId).toBeNull();
    expect(r.reason).toMatch(/manager queue/);
  });
  it("territory matches the PIN code prefix", () => {
    const people = [c("north", { territories: ["110"] }), c("west", { territories: ["400", "411"] })];
    expect(pickAssignee(people, "TERRITORY", { now, address: "Flat 2, Baner, Pune 411045" }).userId).toBe("west");
    expect(pickAssignee(people, "TERRITORY", { now, address: "Chennai 600001" }).userId).toBeNull();
    expect(pickAssignee(people, "TERRITORY", { now, address: "No pin" }).userId).toBeNull();
  });
  it("finds a PIN code", () => {
    expect(pincodeOf("Sector 9, Dwarka, New Delhi 110075")).toBe("110075");
    expect(pincodeOf("Phone 9812345678")).toBeNull();
  });
});

describe("FR-A04 SLA clock", () => {
  const start = new Date("2026-09-24T00:00:00Z");
  const at = (h: number) => new Date(start.getTime() + h * 3600_000);
  it("moves from OK to WARN at the threshold and BREACHED at target", () => {
    const t = { startedAt: start, targetHours: 10, warnPct: 80 };
    expect(slaState(t, at(7)).state).toBe("OK");
    expect(slaState(t, at(8)).state).toBe("WARN");
    expect(slaState(t, at(10)).state).toBe("BREACHED");
  });
  it("excludes paused time", () => {
    const t = { startedAt: start, targetHours: 10, warnPct: 80, pausedMs: 5 * 3600_000 };
    expect(slaState(t, at(12)).state).toBe("OK");
    expect(slaState(t, at(12)).dueAt.toISOString()).toBe(at(15).toISOString());
  });
  it("reports PAUSED while paused", () => {
    expect(slaState({ startedAt: start, targetHours: 1, warnPct: 80, pausedAt: at(0.5) }, at(5)).state).toBe("PAUSED");
  });
});
