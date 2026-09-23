"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface Action { id: string; kind: "FOLLOW_UP" | "CUSTOMER_MESSAGE"; payload: { project_code: string; customer: string; title?: string; due_in_hours?: number; channel?: string; text?: string } }
interface Turn { role: "user" | "assistant"; text: string; actions?: Action[]; error?: boolean }

const PROMPTS = [
  "Which of my leads need a call today?",
  "What is at risk of delay?",
  "What is waiting on me?",
  "Find leads with no activity for 7 days",
];

/** Addendum FR-AI01 – AI06. Answers come only from data this user's role can see; changes need confirmation. */
export function AdvisorPanel() {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<{ enabled: boolean; configured: boolean } | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [convo, setConvo] = useState<string | undefined>();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [projectCode, setProjectCode] = useState<string | undefined>();
  const [decided, setDecided] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/advisor/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setStatus(s))
      .catch(() => setStatus(null));
    input.current?.focus();
  }, []);

  // Give the advisor the project being viewed.
  useEffect(() => {
    const m = pathname.match(/^\/projects\/([^/]+)$/);
    if (!m) {
      setProjectCode(undefined);
      return;
    }
    fetch(`/api/projects/${m[1]}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => setProjectCode(p?.code))
      .catch(() => setProjectCode(undefined));
  }, [pathname]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setTurns((t) => [...t, { role: "user", text: question }]);
    setQ("");
    setBusy(true);
    const r = await fetch("/api/advisor/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, conversationId: convo, projectCode }),
    }).catch(() => null);
    const body = await r?.json().catch(() => null);
    setBusy(false);
    if (r?.ok) {
      setConvo(body.conversationId);
      setTurns((t) => [...t, { role: "assistant", text: body.reply, actions: body.actions }]);
    } else {
      setTurns((t) => [...t, { role: "assistant", text: body?.message ?? "The advisor could not answer right now.", error: true }]);
    }
  }

  async function decide(a: Action, ok: boolean) {
    const r = await fetch(`/api/advisor/actions/${a.id}/${ok ? "confirm" : "reject"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ok && edits[a.id] ? { text: edits[a.id] } : {}),
    });
    const body = await r.json().catch(() => null);
    setDecided((d) => ({ ...d, [a.id]: r.ok ? (ok ? "Confirmed" : "Dismissed") : body?.message ?? "Failed" }));
    if (r.ok && ok) router.refresh();
  }

  if (status && !status.enabled) return <p className="notice">The AI Advisor is not enabled for your role.</p>;
  if (status && !status.configured) return <p className="notice">The AI Advisor is not configured on this server yet (set ANTHROPIC_API_KEY).</p>;

  return (
    <div className="advisor">
      <div className="advisor-log" aria-live="polite">
        {turns.length === 0 && (
          <>
            <p>I can summarise projects, find leads, flag delays and draft messages, using only what your role can see. I never change anything without your confirmation.</p>
            {projectCode && <p className="hint">Looking at {projectCode}.</p>}
            <div className="chips">
              {projectCode && <button className="btn sm" onClick={() => ask(`Summarise ${projectCode} and tell me what is next`)}>Summarise this project</button>}
              {PROMPTS.map((p) => <button key={p} className="btn sm" onClick={() => ask(p)}>{p}</button>)}
            </div>
          </>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`bubble ${t.role}${t.error ? " error" : ""}`}>
            <div style={{ whiteSpace: "pre-wrap" }}>{t.text}</div>
            {t.actions?.map((a) => (
              <div key={a.id} className="proposal">
                <b>{a.kind === "FOLLOW_UP" ? "Proposed follow-up" : `Proposed ${a.payload.channel?.toLowerCase()} to ${a.payload.customer}`}</b>
                <small>{a.payload.project_code}</small>
                {a.kind === "FOLLOW_UP" ? (
                  <p>{a.payload.title} · due in {a.payload.due_in_hours}h</p>
                ) : (
                  <>
                    <label className="sr-only" htmlFor={`msg-${a.id}`}>Message text</label>
                    <textarea id={`msg-${a.id}`} rows={4} defaultValue={a.payload.text} disabled={!!decided[a.id]} onChange={(e) => setEdits((x) => ({ ...x, [a.id]: e.target.value }))} />
                  </>
                )}
                {decided[a.id] ? (
                  <span className="tag">{decided[a.id]}</span>
                ) : (
                  <div className="btn-row">
                    <button className="btn primary sm" onClick={() => decide(a, true)}>{a.kind === "FOLLOW_UP" ? "Create task" : "Queue message"}</button>
                    <button className="btn sm" onClick={() => decide(a, false)}>Dismiss</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
        {busy && <div className="bubble assistant"><span className="hint">Checking your data…</span></div>}
        <div ref={end} />
      </div>
      <form className="advisor-input" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <label className="sr-only" htmlFor="advisor-q">Ask the AI Advisor</label>
        <input id="advisor-q" ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your leads or projects" maxLength={2000} />
        <button className="btn primary" type="submit" disabled={busy || !q.trim()}>Ask</button>
      </form>
    </div>
  );
}
