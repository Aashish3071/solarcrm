# Solar CRM — Clarification Workshop & FRD Addendum

## A. Workshop questionnaire (19 open points)

Each item lists the proposed default we will build against until answered.

| # | Question | Proposed default | Owner |
|---|---|---|---|
| 1 | Which customer fields are mandatory vs optional (KYC, alternate phone, roof type…)? | Name, phone, address, KW mandatory | Sales head |
| 2 | Master list of project types, packages, additional services? | Placeholder seed, admin-editable | Sales head |
| 3 | Pricing/rate formula (per kW, slabs, service add-ons, GST)? | package × kW + Σ services | Finance |
| 4 | Government portal name; any API/integration method? | Manual status screen | Office lead |
| 5 | DISCOM status master and approval stages per DISCOM? | Submitted → Under review → Returned → Meter approved → Installed → Final approved | DISCOM officer |
| 6 | Bank/NBFC list, loan document checklist, loan statuses? | Editable master + basic statuses | Loan officer |
| 7 | Expected End Date formula? | start + configurable days per kW band | Project Engineer |
| 8 | Material master and dispatch process? | Free-text lines until supplied | Store manager |
| 9 | Definition of execution start/end; photo frequency? | ≥1 photo per milestone | Project Engineer |
| 10 | Incentive formula for every discount between 3% and 4%? | Linear 1%→0%, flagged unconfirmed (3.5%→0.5% matches example) | Sales / Finance |
| 11 | Partner commission rules and applicability (Lead-only vs Full)? | 5% Full; partner keeps unused discount | Management |
| 12 | Notification channels, templates, recipients, escalation? | Booklet §9 matrix as draft | Ops |
| 13 | Role-wise screen access / permissions? | Derived from FRD role table; review together | All leads |
| 14 | Payment gateway, cloud storage, accounting software? | Behind interfaces; S3-compatible | IT / Finance |
| 15 | Lead routing: round-robin, load, territory, partner-owner? Territories/pincodes? | Round-robin in pool, least-load tiebreak | Sales head |
| 16 | Work-assignment rules for supervisor, office exec, loan/DISCOM officer, engineer? Auto or suggest? | Suggest first, auto after UAT | Ops head |
| 17 | Follow-up cadences per stage and who owns them? | New lead 1h / D+1 / D+3; unconfirmed terms D+1; unverified payment 4h | Sales / Accounts |
| 18 | SLA targets per stage, pause conditions, escalation chain, working hours, holidays? | Admin-editable drafts, business-hours clock | Ops head |
| 19 | AI advisor: roles, data allowed to leave the system, vendor/residency, budget? | Read-only + confirm-to-act; KYC/bank redacted; Sales, Accounts, Engineers first | Management / IT |

## B. FRD addendum (proposed new requirements)

Format follows FRD v1.0. Items marked *(TBC)* depend on the workshop answers above.

### B.1 Automation

| ID | Requirement | Validation / rule |
|---|---|---|
| FR-A01 | **Lead auto-routing.** On lead creation the system assigns a Sales owner using the configured strategy (round-robin, least open load, territory, source/partner-based). | Skip inactive/on-leave users and users at capacity; fall back to a manager queue; every assignment logged and overridable with reason. |
| FR-A02 | **Work auto-assignment.** System suggests or auto-assigns Site Supervisor (FR-004), Office Executive (FR-011), Loan Officer / DISCOM Officer / Project Engineer (FR-014), Site Supervisor confirmation (FR-015). | Mode per rule: Suggest or Auto *(TBC)*. Respects capacity, availability, region. Assignment never bypasses workflow gates. |
| FR-A03 | **Follow-up cadences.** Stage-based templates create follow-up tasks and reminders for the owner. | Stop automatically when the stage advances; overdue tasks escalate; snooze and reassign allowed. |
| FR-A04 | **SLA policies.** Configurable target per stage/track; timers start at stage entry, pause on defined waiting states, warn at a threshold and breach at 100%; escalation levels notify managers. | Uses business-hours and holiday calendars; breaches feed reporting. |
| FR-A05 | **Rule administration.** Admin/Manager can create, version, dry-run, activate/deactivate rules; every execution is logged with inputs and outcome. | Rule changes audited; rules never override hard validations in Section 6 of the FRD. |

### B.2 AI Advisor

| ID | Requirement | Validation / rule |
|---|---|---|
| FR-AI01 | **Next-best-action.** Advisor panel shows suggested actions for the current lead/project. | Each suggestion shows its reasoning and source records. |
| FR-AI02 | **Summaries.** Summarise project history, site assessment vs requirement, loan/DISCOM progress. | Only data the user is authorised to see. |
| FR-AI03 | **Risk/delay flags.** Flag at-risk projects using planned-vs-actual, SLA state and material status. | Advisory only; no automatic state change. |
| FR-AI04 | **Discount/incentive explainer.** Show incentive at candidate discounts and explain rules. | Figures come from the incentive calculator, never from model arithmetic; 4% ceiling still enforced (FR-039). |
| FR-AI05 | **Message drafting.** Draft customer/partner messages and notes. | Human approval before sending through the notification service. |
| FR-AI06 | **Scoped Q&A.** Natural-language questions over the user's accessible data. | RBAC-scoped tools; KYC/bank fields redacted before model calls; prompts/responses logged; any action it proposes requires user confirmation and passes through normal API validations. |

### B.3 Non-functional additions
- AI features are switchable per role; graceful degradation if the model service is unavailable.
- Rate/cost limits and usage reporting for AI calls.
- Automation timers are idempotent and survive restarts (persistent job queue).
