# SolarCRM Architecture

**Current phase:** Phase 3 complete (notifications and reconciliation). **Next:** Phase 3b builds the AI Advisor.

## System overview

```
Browser (Next.js web, :3100)
   │  same-origin /api/* (rewrite proxy, httpOnly session cookie)
   ▼
NestJS API (:4000, modular monolith)
   ├─ AuthGuard (global): JWT cookie → user → module permission check
   ├─ Projects: lead creation, stage completion, payment rejection, assignments
   │    └─ stage-effects.ts: per-stage DB checks + writes (site visit, terms, payments)
   ├─ Payments: Accounts queue, receipt history, outstanding/collections summary
   ├─ Tracks: manual external steps (gov, loan, DISCOM), reschedule, training, instalments
   ├─ Documents: upload (role + type + content-sniffed MIME + 10 MB), scoped download
   │    └─ StorageService → LocalDiskStorage (swap for S3/GCS/Azure, open point 14)
   ├─ Dashboard: role-scoped counts and "waiting on you"
   ├─ Automation (FR-A01–A05): EventBus ← ProjectsService emits lead.created / stages.changed
   │    ├─ AutomationService: routing, assignment suggestions, follow-ups, SLA timers, 60 s DB-backed tick
   │    ├─ Work: My Work tasks + SLA clocks; apply/override suggestions via normal workflow endpoints
   │    └─ Automation console: rules (versioned), dry run, availability, run log
   ├─ Notifications (FR-044): NotificationService listens on EventBus
   │    ├─ matrix (NotificationRule) → recipients (stage owner, sales owner, customer, roles) × channels
   │    ├─ IN_APP rows = inbox; EMAIL/SMS/WHATSAPP rows = outbox (QUEUED → SENT/FAILED/SKIPPED, 3 attempts)
   │    └─ delivery = POST to NOTIFY_WEBHOOK_URL (integration layer, Booklet §7/§8.3)
   ├─ Reconciliation (Booklet §6.4): statement CSV → BankStatementLine; UTR match shown in the Accounts queue
   ├─ Users / Partners: assignee pickers
   ├─ AuditService: append-only audit log
   ├─ Config (admin): rules + masters editor, per-user overrides `<key>@<userId>`, audited
   ├─ Incentives: stage 23 results, scoped (own / partner / all)
   └─ ConfigParamsService: business rules as data (FR-043)
   │
   ▼
PostgreSQL 16 (Prisma)        Redis 7 (reserved for jobs/automation, Phase 2b)
```

`packages/shared` holds the domain rules used by both apps, so the UI and the server can never disagree about a rule.

## Workflow engine

- The 23 FRD stages (§5) are a **dependency graph**, not a linear status (`packages/shared/src/workflow.ts`).
- A project stores `completedStages` and `skippedStages`. A stage is *available* when all prerequisites are completed or skipped.
- After **Project Initiated (10)**, Government Registration (11), Loan (12), DISCOM (13) and Site Revisit & Design (14) run in parallel. Loan is skipped when not required (FR-013).
- `checkCompletion(stage, role, project, input)` enforces, in order: already done → prerequisites → actor role → FRD rule for the stage.
- Payment rejection (FR-010) reopens *Advance Payment Logged* so Sales re-logs it.
- Every completion writes a `StageEvent` and an `AuditLog` row; a conditional update prevents double completion under concurrency.

## Security model

| Control | Where |
|---|---|
| Session: signed JWT in httpOnly, SameSite=Lax cookie; `Secure` behind HTTPS | `auth.controller.ts` |
| User re-read on every request (deactivation/role change applies immediately) | `auth.guard.ts` |
| Module access per role (default matrix, open point 13) | `shared/permissions.ts` |
| Row scoping: Admin/Sales/Accounts see all; Partner sees own partner's leads; others see assigned projects only | `projects.service.ts#scope` |
| Server-side validation of every rule; UI checks are convenience only | `shared/rules.ts`, `workflow.ts` |
| Audit of logins, failed logins, stage changes, rejections, assignments | `AuditLog` table |

## Data model

| Table | Phase | Holds |
|---|---|---|
| `User`, `Partner` | 0 | Staff by role; Lead-only / Full partners (FR-041) |
| `Project` | 0 / 1A | Lead + project; FR-001 contact fields, FR-002 requirement (set at stage 2), stage arrays |
| `ProjectAssignment` | 0 | One person per role per project |
| `StageEvent`, `AuditLog` | 0 | Timeline and audit trail |
| `ConfigParam` | 0 / 1A | Rules and placeholder masters (project types, packages) |
| `SiteVisit` | 1A | Schedule, late reason, assessment (FR-005, FR-006) |
| `SalesTerms` | 1A | Package, cost, discount, terms, confirmation (FR-007, FR-008, FR-039) |
| `Payment` | 1A | Advance / instalments / collections with LOGGED → APPROVED/REJECTED (FR-009, FR-010, FR-036–038) |
| `Document` | 1B | FRD §7 files keyed by project + stage; binary in storage |
| `GovRegistration` | 1B | Portal status, registration no. and date (FR-012) |
| `LoanApplication` | 1B | Bank, status, requested/approved, client re-confirmation (FR-016–019) |
| `DiscomApplication` | 1B | Application, status, meter, final approval (FR-021, 022, 034) |
| `ProjectPlan` | 1B | Revisit, planned/actual dates, reschedules, material timestamps and remarks (FR-023–030) |
| `Installation` | 1B | Execution dates, training assignee and completion (FR-031–035) |
| `PaymentScheduleItem` | 2 | Dated milestones (payer, amount) totalling the final cost; basis for overdue (FR-007, FR-036) |
| `AutomationRule`, `AutomationRun` | 2b | Rules as data (kind, trigger, config, mode, version) and every decision made |
| `Task` | 2b | Follow-ups, assignment suggestions, SLA escalations; owned by a person or a role queue; dedupe key |
| `SlaTimer` | 2b | One live clock per project and stage: start, pause, warn, breach, resolve |
| `User` (+) | 2b | awayUntil, maxOpen, territories, lastAssignedAt for routing |
| `NotificationRule` | 3 | Event → recipients and channels (Booklet §9 defaults) |
| `Notification` | 3 | In-app inbox and external outbox with status, attempts, dedupe key |
| `BankStatementImport`, `BankStatementLine` | 3 | Imported credits (unique per date, amount, reference and narration) |
| `IncentiveResult` | 2 | Incentive and partner commission with the rules snapshot used (FR-039–043) |

### How a stage is completed

1. `checkCompletion` (shared): prerequisites, role, FRD rule.
2. `serverFacts` (API): facts the server derives, such as documents present, photo count, loan amounts and planned date, replace anything the client sent.
3. `preCheck` (API): rules that need the database, such as no duplicate live UTR, a logged advance existing before verification, and terms existing before confirmation.
4. One transaction: an atomic stage push, assignment upsert, `applyEffects` (writes the business record), and a `StageEvent`.
5. An `AuditLog` entry.

## Progress by phase

| Phase | Scope | Status |
|---|---|---|
| 0 | Monorepo, infra, auth/RBAC, audit, workflow engine, app shell | **Done** |
| 1A | Leads, site visits, finalize & advance, payment verification (stages 1–10) | **Done** |
| 1B | Initiation team, Gov, Loan, DISCOM, design, planning, material, installation, documents (stages 10–21) | **Done** |
| 2 | Payment schedules/overdue, stage 22 collection, incentive engine, admin config UI | **Done** |
| 2b | Automation: routing, follow-ups, assignment, SLAs | **Done** |
| 3 | Notifications, bank-statement reconciliation | **Done** |
| 3b | AI Advisor | Next |
| 4 | Connectors, storage hardening, reporting | Planned |
| 5 | Hardening and go-live | Planned |

## Decisions and open items

- The FR-005 24-hour rule is measured from supervisor assignment to the scheduled visit time (to confirm).
- ADMIN can complete any stage (to revisit with the permission matrix).
- Object storage uses local disk (`LocalDiskStorage`) behind `StorageService` until a cloud provider is chosen (open point 14). File type is checked from the file content, not the name.
- Prisma is pinned to 6.x; 7.x is a major upgrade to plan separately.
- FR-003 indicative pricing is not shown yet: it needs the pricing formula and rate masters (open point 3).
- Project types and packages are placeholder masters in `ConfigParam` (open point 2).
- The same UTR cannot be logged twice unless the earlier entry was rejected. This supports FR-010 but is our own control, not an FRD rule.
- "Overdue receivables" needs payment schedules with due dates, which come in Phase 2.
- Material delay (FR-027/029) is measured against the planned project start date, because the FRD does not define a separate dispatch due date.
- The Store Manager sees every planned project (inventory works across projects); other field roles see only projects they are assigned to.
- Final DISCOM approval (21) needs Completion (20) and a meter number.
- Incentive interpretation (provisional, open points 10 and 11). At or below 3% discount: 1% + 30% × (3% − discount). Between 3% and 4%: linear down to 0%, which matches the 3.5% → 0.5% example. Full-partner commission = 5% + (ceiling − discount). Lead-only partners earn 0 until rules arrive. Every result stores the rules it used.
- Stage 22 closes only when verified receipts reach the final cost and no payment is still awaiting Accounts. Stage 23 then runs as SYSTEM.
- Overdue = amounts scheduled up to today minus verified receipts, per project.
- Automation triggers fire when a stage opens. Suggest mode creates a task for the normal assigner. Auto mode assigns immediately; for stage-bound roles it completes the stage as SYSTEM, and all gates still apply.
- SLA clocks run in wall-clock hours. Business-hours and holiday calendars, and pause-while-waiting, are not built yet: the fields exist (`pausedAt`, `pausedMs`) but nothing sets them.
- The SLA check uses a database-polling interval rather than BullMQ, so state lives in Postgres and survives restarts. Redis stays reserved for scale-out.
- Staff receive in-app and email. SMS and WhatsApp go only to customers, because staff phone numbers aren't collected. There is no customer in-app channel until the customer portal has logins.
- A payment gateway connector (Razorpay and similar) is in Phase 4. Statement CSV import is the offline reconciliation path from Booklet §6.4.
