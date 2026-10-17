# UAT scripts

One script per role, in workflow order, so a team can run the whole lifecycle on one test project in a single session. Each step lists what to do and what must happen. Mark each **Pass / Fail** and note the project code.

**Setup:** a UAT environment with seeded users (or real users with the same roles), connectors unconfigured unless testing them, and the Guide open (`? Guide`) for reference. Use one test customer, for example "UAT Customer 1", with a loan required.

**Rule for every script:** if the system refuses a step, the message must say what is missing. A refusal is a Pass for the "refused" cases below.

---

## 1. Sales Team (stages 1–3, 6–8, 10, 22)

| # | Do | Expect | FRD |
|---|---|---|---|
| S1 | Leads → New lead without choosing a lead source | Refused: source is required | FR-001 |
| S2 | Create the lead with source Direct, name, phone, address | Lead appears with code SLR-YYYY-n; owner assigned or a routing suggestion appears for the manager | FR-001, A01 |
| S3 | Capture requirement with loan = Yes and no loan amount | Refused: enter the loan amount | FR-002 |
| S4 | Capture requirement: 5 kW, type, package, loan ₹2,00,000 | Stage 2 done; follow-up tasks for the lead disappear from My Work | FR-002, A03 |
| S5 | Assign a Site Supervisor | Stage 3 done; supervisor gets a notification | FR-004, FR-044 |
| S6 | (after visit) Finalize with discount 4.5% | Refused: discount above the ceiling | FR-039 |
| S7 | Finalize with discount 3.5%, cost, payment terms | Stage 6 done; incentive preview shows 0.5% (provisional) | FR-007, FR-040 |
| S8 | Try to log the advance before confirmation | Not possible: locked until confirmation | FR-009 |
| S9 | Record customer confirmation, then log advance without UTR | Refused: UTR required | FR-008, FR-009 |
| S10 | Log advance with amount, mode, UTR | Stage 8 done; Accounts sees it in the queue | FR-009 |
| S11 | Try to log the same UTR again on another project | Refused: duplicate UTR | control |
| S12 | (after Accounts approval) Initiate project, assign the team | Stage 10 done; Gov, Loan, DISCOM, Design open together | FR-011, FR-014 |
| S13 | (when bank approves a different amount) Re-confirm with the client on the Loan screen | Loan Officer can now complete stage 12; payment split recalculated | FR-018, FR-019 |
| S14 | Log a regular instalment | Appears in the Accounts queue and Payments history | FR-036 |

## 2. Sales Partner

| # | Do | Expect | FRD |
|---|---|---|---|
| P1 | Create a lead | Source is Sales Partner with your partner name | FR-001, FR-041 |
| P2 | Open Projects | Only your own partner's leads are listed | scope |
| P3 | Open Incentives (Full partner) | Commission shown for your projects only | FR-041, FR-042 |

## 3. Site Supervisor (stages 4, 5, 14, 18, 19)

| # | Do | Expect | FRD |
|---|---|---|---|
| V1 | Open Site Visits | Only assigned projects are listed | scope |
| V2 | Schedule the visit 30 hours after assignment with no reason | Refused: reason required beyond 24 hours | FR-005 |
| V3 | Schedule with a reason | Stage 4 done | FR-005 |
| V4 | Complete the visit: feasible, 4.5 kW, upload site photos | Stage 5 done; Sales sees the assessment | FR-006 |
| V5 | Revisit & design: upload design file | Stage 14 done; Project Engineer notified | FR-023, FR-024 |
| V6 | Mark material received a day after planned start, no remark | Refused: delay remark required | FR-029 |
| V7 | Record installation without a photo | Refused: photo required | FR-031 |
| V8 | Record installation with start, end and photos | Stage 19 done | FR-031 |

## 4. Accounts Team (stages 9, 22)

| # | Do | Expect | FRD |
|---|---|---|---|
| A1 | Payments → queue shows the advance with age and bank match column | Listed with its age; no bank match until a statement is imported | FR-010 |
| A2 | Import a bank statement CSV containing the UTR | Bank match shows the matching credit | Booklet §6.4 |
| A3 | Reject a payment with a reason | Sales is notified; the project does not initiate | FR-010 |
| A4 | Approve the advance | Stage 9 done; Sales can initiate | FR-010, FR-011 |
| A5 | Schedules tab: overdue amount after a due date passes | Overdue receivables KPI increases | FR-037 |
| A6 | Approve the last instalment | Stage 22 closes, then stage 23 incentive is calculated automatically | FR-038, FR-039 |
| A7 | Reports → Export CSV | File downloads without phone, email or address | Booklet §10, §11 |

## 5. Office Executive (stages 11, 20)

| # | Do | Expect | FRD |
|---|---|---|---|
| O1 | Government Registration without a registration number | Refused | FR-012 |
| O2 | Save registration number, date, status and upload acknowledgement | Stage 11 done | FR-012 |
| O3 | Completion without the signed certificate | Refused | FR-032 |
| O4 | Upload completion certificate; record customer training | Stage 20 done; training recorded | FR-032, FR-033, FR-035 |

## 6. Loan Officer (stage 12)

| # | Do | Expect | FRD |
|---|---|---|---|
| L1 | Enter approved amount ₹1,80,000 (requested ₹2,00,000) | Refused until Sales re-confirms with the client | FR-017, FR-018 |
| L2 | After re-confirmation, complete loan processing | Stage 12 done; payment split shows bank ₹1,80,000 and customer the rest | FR-019 |
| L3 | Log loan instalment 1 | Goes to the Accounts queue | FR-038 |

## 7. DISCOM Officer (stages 13, 21)

| # | Do | Expect | FRD |
|---|---|---|---|
| D1 | Save DISCOM application number and status Submitted | Stage 13 done | FR-021 |
| D2 | Change status to Returned, then Under review | History kept; Sales notified on status change | FR-022, FR-044 |
| D3 | Try final approval before Completion (20) | Not available yet | FR-034 |
| D4 | Final approval with meter number and date | Stage 21 done | FR-034 |

## 8. Project Engineer (stages 15, 19, 20)

| # | Do | Expect | FRD |
|---|---|---|---|
| E1 | Plan the project with a start date | Expected end date calculated automatically | FR-025, FR-026 |
| E2 | Reschedule with a reason | New end date; reschedule counted in Reports | FR-026, Booklet §11 |
| E3 | My Work shows SLA clocks for your stages | Clock state OK / Warning / Breached | A04 |

## 9. Store Manager (stages 16, 17)

| # | Do | Expect | FRD |
|---|---|---|---|
| M1 | Mark material ready after the planned start, no remark | Refused: delay remark required | FR-027 |
| M2 | Mark ready with a remark | Stage 16 done; dispatch recorded (17) | FR-027, FR-028 |
| M3 | Reports → Material shows the delayed project with its remark (Admin/Accounts) | Listed | Booklet §11 |

## 10. Administrator

| # | Do | Expect | FRD |
|---|---|---|---|
| X1 | Settings → change discount ceiling to 3% | Sales cannot finalize at 3.5%; change is audited | FR-039, FR-043 |
| X2 | Set a per-user incentive override | Next incentive for that user uses it; earlier results keep their snapshot | FR-043 |
| X3 | Settings → Notifications: turn off one email rule | That email is no longer queued | FR-044 |
| X4 | Automation: switch supervisor assignment to Auto; create a lead | Supervisor assigned without a manual step; run log shows the rule | A01, A02, A05 |
| X5 | Move an SLA past its target (or wait) and run the SLA check | Escalation task in the role queue | A04 |
| X6 | Settings → Integrations | Connectors show Not configured; log empty or showing refused calls | Booklet §7 |
| X7 | Deactivate a user while they are signed in | Their next action is refused | security |

## 11. AI Advisor (roles where it is enabled)

| # | Do | Expect | Addendum |
|---|---|---|---|
| I1 | "Summarise SLR-…" for a project you can see | Summary of stages, dates and blockers | AI02 |
| I2 | Ask about a project outside your scope | Says it can't find it | AI06 |
| I3 | "Draft a follow-up for this lead" | A proposal card; nothing happens until Confirm | AI05 |
| I4 | "What incentive at 2.5% on ₹3,00,000?" | Figure equals the Incentives calculator | AI04 |

## 12. Security checks (IT)

| # | Do | Expect |
|---|---|---|
| T1 | Six wrong passwords for one email | Sixth attempt returns "Too many attempts" |
| T2 | Sign out, then reuse the old session cookie | Refused (401) |
| T3 | Upload a renamed .exe as a photo | Refused: file type |
| T4 | Call an inbound webhook with a wrong signature | 401 and an entry in the Integration log |

Sign-off: one named owner per role signs the table for their role. Defects are logged with the step number and project code.
