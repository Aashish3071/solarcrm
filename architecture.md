# SolarCRM Architecture

**Current phase:** Phase 1A complete (stages 1–10). **Next:** Phase 1B covers stages 10–20, with documents and photos.

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
   ├─ Dashboard: role-scoped counts and "waiting on you"
   ├─ Users / Partners: assignee pickers
   ├─ AuditService: append-only audit log
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

### How a stage is completed

1. `checkCompletion` (shared): prerequisites, role, FRD rule.
2. `preCheck` (API): rules that need the database, such as no duplicate live UTR, a logged advance existing before verification, and terms existing before confirmation.
3. One transaction: an atomic stage push, assignment upsert, `applyEffects` (writes the business record), and a `StageEvent`.
4. An `AuditLog` entry.

## Progress by phase

| Phase | Scope | Status |
|---|---|---|
| 0 | Monorepo, infra, auth/RBAC, audit, workflow engine, app shell | **Done** |
| 1A | Leads, site visits, finalize & advance, payment verification (stages 1–10) | **Done** |
| 1B | Initiation team, Gov, Loan, DISCOM, design, planning, material, installation, documents (stages 10–20) | Next |
| 2 | Payment split, collections, incentive engine, admin config UI | Planned |
| 2b | Automation: routing, follow-ups, assignment, SLAs | Planned |
| 3 | Notifications, bank-statement reconciliation | Planned |
| 3b | AI Advisor | Planned |
| 4 | Connectors, storage hardening, reporting | Planned |
| 5 | Hardening and go-live | Planned |

## Decisions and open items

- The FR-005 24-hour rule is measured from supervisor assignment to the scheduled visit time (to confirm).
- ADMIN can complete any stage (to revisit with the permission matrix).
- Object storage is not provisioned yet: MinIO stopped publishing images, and the provider is open point 14.
- Prisma is pinned to 6.x; 7.x is a major upgrade to plan separately.
- FR-003 indicative pricing is not shown yet: it needs the pricing formula and rate masters (open point 3).
- Project types and packages are placeholder masters in `ConfigParam` (open point 2).
- The same UTR cannot be logged twice unless the earlier entry was rejected. This supports FR-010 but is our own control, not an FRD rule.
- "Overdue receivables" needs payment schedules with due dates, which come in Phase 2.
