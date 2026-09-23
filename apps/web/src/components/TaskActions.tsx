"use client";

import { useState } from "react";
import { useAction } from "@/lib/client-api";
import { Errors } from "./FormBits";

type Person = { id: string; name: string; role: string };
export interface TaskRow {
  id: string;
  kind: "FOLLOW_UP" | "ASSIGNMENT" | "SLA_ESCALATION";
  title: string;
  dueAt: string;
  queue: string | null;
  suggestion: { kind: string; role: string; userId: string | null; reason: string } | null;
  projectId: string;
  projectCode: string;
  customerName: string;
}

/** Done / snooze for follow-ups; apply (or override) for assignment suggestions (FR-A03, FR-A05). */
export function TaskActions({ task, people }: { task: TaskRow; people: Person[] }) {
  const act = useAction();
  const [choice, setChoice] = useState(task.suggestion?.userId ?? "");
  if (task.kind === "ASSIGNMENT" && task.suggestion) {
    const options = people.filter((p) => p.role === task.suggestion!.role);
    return (
      <div>
        <small style={{ display: "block", color: "var(--mute)", marginBottom: 6 }}>{task.suggestion.reason}</small>
        <div className="btn-row">
          <label className="sr-only" htmlFor={`pick-${task.id}`}>Person to assign</label>
          <select id={`pick-${task.id}`} value={choice} onChange={(e) => setChoice(e.target.value)} style={{ width: "auto", minHeight: 34 }}>
            <option value="" disabled>Choose</option>
            {options.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === task.suggestion!.userId ? " (suggested)" : ""}</option>)}
          </select>
          <button className="btn primary sm" disabled={!choice || act.busy} onClick={() => act.run("POST", `/tasks/${task.id}/apply`, { userId: choice })}>Assign</button>
        </div>
        <Errors error={act.error} />
      </div>
    );
  }
  return (
    <div>
      <div className="btn-row">
        <button className="btn sm" disabled={act.busy} onClick={() => act.run("POST", `/tasks/${task.id}/done`)}>Done</button>
        {task.kind === "FOLLOW_UP" && <button className="btn sm" disabled={act.busy} onClick={() => act.run("POST", `/tasks/${task.id}/snooze`, { hours: 24 })}>Snooze 1 day</button>}
      </div>
      <Errors error={act.error} />
    </div>
  );
}
