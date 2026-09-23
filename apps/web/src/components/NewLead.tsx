"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAction } from "@/lib/client-api";
import { Errors, Field, val } from "./FormBits";

/** FR-001: create a lead from Direct Source or a Sales Partner. */
export function NewLead({ partners, isPartner }: { partners: { id: string; name: string; type: string }[]; isPartner: boolean }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"DIRECT" | "SALES_PARTNER">(isPartner ? "SALES_PARTNER" : "DIRECT");
  const { run, busy, error, clear } = useAction();
  const router = useRouter();
  const opener = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
    clear();
    opener.current?.focus();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      customerName: val(f, "customerName"),
      phone: val(f, "phone"),
      email: val(f, "email") ?? "",
      address: val(f, "address"),
      leadSource: source,
      partnerId: source === "SALES_PARTNER" ? val(f, "partnerId") : undefined,
    };
    const created = await run("POST", "/projects", body);
    if (created?.id) {
      // Open the new lead so Sales can capture the requirement next.
      setOpen(false);
      router.push(`/projects/${created.id}`);
    }
  }

  return (
    <>
      <button ref={opener} className="btn primary" onClick={() => setOpen(true)}>New lead</button>
      {open && (
        <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="nl-title">
            <header>
              <h2 id="nl-title">New lead</h2>
              <button className="icon-btn" onClick={close} aria-label="Close"><X aria-hidden="true" /></button>
            </header>
            <form onSubmit={onSubmit}>
              {!isPartner && (
                <fieldset className="field">
                  <legend>Lead source</legend>
                  <div className="radio-row">
                    <label><input type="radio" name="src" checked={source === "DIRECT"} onChange={() => setSource("DIRECT")} /> Direct Source</label>
                    <label><input type="radio" name="src" checked={source === "SALES_PARTNER"} onChange={() => setSource("SALES_PARTNER")} /> Sales Partner</label>
                  </div>
                </fieldset>
              )}
              {!isPartner && source === "SALES_PARTNER" && (
                <Field label="Sales Partner" htmlFor="nl-partner">
                  <select id="nl-partner" name="partnerId" required defaultValue="">
                    <option value="" disabled>Select</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.type === "FULL" ? "Full Sales Partner" : "Lead-only"})</option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="form-grid">
                <Field label="Customer name" htmlFor="nl-name">
                  <input ref={first} id="nl-name" name="customerName" required autoComplete="off" />
                </Field>
                <Field label="Phone" htmlFor="nl-phone">
                  <input id="nl-phone" name="phone" inputMode="tel" required autoComplete="off" />
                </Field>
              </div>
              <Field label="Email (optional)" htmlFor="nl-email">
                <input id="nl-email" name="email" type="email" autoComplete="off" />
              </Field>
              <Field label="Installation address" htmlFor="nl-addr">
                <textarea id="nl-addr" name="address" rows={2} required />
              </Field>
              <Errors error={error} />
              <div className="btn-row">
                <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Create lead"}</button>
                <button className="btn" type="button" onClick={close}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
