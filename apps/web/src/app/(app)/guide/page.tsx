import Link from "next/link";
import { ROLE_LABELS, STAGES, STAGE_DEFS, type Role, type Stage } from "@solarcrm/shared";
import { api } from "@/lib/server-api";

/** Where each stage is worked, and what the server checks before it closes (FRD §6 rules). */
const HELP: Record<Stage, { screen: string; need: string }> = {
  LEAD_CREATED: { screen: "/leads", need: "Customer name, phone, address and lead source (Direct or Sales Partner)." },
  REQUIREMENT_CAPTURED: { screen: "/leads", need: "Required kW, project type, package, and whether a loan is needed (with amount)." },
  SUPERVISOR_ASSIGNED: { screen: "/site-visits", need: "Pick a Site Supervisor. The 24-hour visit clock starts now." },
  VISIT_SCHEDULED: { screen: "/site-visits", need: "Visit date and time. If it is more than 24 hours after assignment, give a reason." },
  VISIT_COMPLETED: { screen: "/site-visits", need: "Feasible or not, and the capacity (kW) found on site." },
  SALES_FINALIZED: { screen: "/finalize", need: "Final cost, payment terms and discount. Discount cannot exceed the ceiling (4%)." },
  CUSTOMER_CONFIRMED: { screen: "/finalize", need: "Record the customer's confirmation of the final terms." },
  ADVANCE_LOGGED: { screen: "/finalize", need: "Amount, payment mode and UTR. Only possible after confirmation." },
  PAYMENT_VERIFIED: { screen: "/payments", need: "Check the UTR against the bank and approve, or reject with a reason." },
  PROJECT_INITIATED: { screen: "/initiation", need: "Assign the Office Executive (and the rest of the team). Only after Accounts approves." },
  GOV_REGISTERED: { screen: "/gov", need: "Registration number and date from the government portal." },
  LOAN_PROCESSED: { screen: "/loan", need: "Approved amount. If it differs from the requested amount, Sales re-confirms with the customer first." },
  DISCOM_APPLIED: { screen: "/discom", need: "DISCOM application number; keep the status up to date." },
  DESIGN_UPLOADED: { screen: "/planning", need: "Revisit notes and the design / layout document." },
  PROJECT_PLANNED: { screen: "/planning", need: "Start date. The expected end date is calculated for you." },
  MATERIAL_READY: { screen: "/planning", need: "Mark material ready. A remark is required if it is later than planned." },
  DISPATCHED: { screen: "/planning", need: "Recorded automatically when material is dispatched." },
  RECEIVED_AT_SITE: { screen: "/planning", need: "Confirm receipt at site. A remark is required if it arrived late." },
  INSTALLATION_DONE: { screen: "/installation", need: "Start and end of work and at least one installation photo." },
  COMPLETED: { screen: "/installation", need: "Upload the signed completion certificate; record customer training." },
  FINAL_DISCOM_APPROVED: { screen: "/discom", need: "Meter number and final approval date. Needs Completion first." },
  PAYMENTS_COLLECTED: { screen: "/payments", need: "Closes when verified receipts reach the final cost and nothing awaits Accounts." },
  INCENTIVE_CALCULATED: { screen: "/incentives", need: "Calculated automatically from the discount given (provisional rules)." },
};

const BASICS = [
  { title: "My Work", text: "Your tasks, follow-ups and SLA clocks in one list. Suggestions from automation appear here for you to apply or reassign." },
  { title: "Notifications", text: "The bell in the sidebar shows stage alerts meant for you. Opening an alert takes you to the project." },
  { title: "Search", text: "The search box at the top finds projects by customer name, phone number or project code (SLR-…)." },
  { title: "AI Advisor", text: "The ✦ button opens the advisor. It can summarise a project, find leads and draft messages. It only proposes; nothing changes until you confirm." },
  { title: "Rules are checked on the server", text: "If a step is refused, the message tells you what is missing. The same rules apply whichever screen you use." },
];

interface Me { role: Role; name: string }

export default async function GuidePage() {
  const me = await api<Me>("/auth/me");
  const mine = STAGES.filter((s) => me.role === "ADMIN" || (STAGE_DEFS[s].actors as readonly string[]).includes(me.role));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Guide</h1>
          <p>What {ROLE_LABELS[me.role]} does in SolarCRM, and what each step needs before it can close.</p>
        </div>
      </div>

      <section className="card flush" aria-labelledby="g-steps">
        <header className="card-head"><h2 id="g-steps" className="label">Your steps</h2></header>
        {mine.length === 0 ? (
          <p className="empty">Your role does not complete workflow stages. You can view the projects shared with you.</p>
        ) : (
          <ol className="guide-list">
            {mine.map((s) => (
              <li key={s}>
                <span className="guide-num" aria-hidden="true">{STAGE_DEFS[s].number}</span>
                <div>
                  <div className="guide-title">
                    <Link href={HELP[s].screen}>{STAGE_DEFS[s].label}</Link>
                    <span className="guide-ref"> · {STAGE_DEFS[s].frd}</span>
                  </div>
                  <p>{HELP[s].need}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="card flush" aria-labelledby="g-basics" style={{ marginTop: 16 }}>
        <header className="card-head"><h2 id="g-basics" className="label">Everyday tools</h2></header>
        <dl className="guide-basics">
          {BASICS.map((b) => (
            <div key={b.title}>
              <dt>{b.title}</dt>
              <dd>{b.text}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
