# SolarCRM

Solar CRM/ERP built from the client FRD (FR-001 – FR-044) and the Integration Booklet.
Design and plan: [`docs/`](docs/) (wireframes, traceability, workshop questions, FRD addendum). Architecture: [`architecture.md`](architecture.md).

## Status

- **Phase:** Phase 2b (automation) is complete.
- **Progress:**
  - Phase 0: foundations.
  - Phase 1: stages 1–21 with documents.
  - Phase 2: schedules, collection and incentives (stages 22–23).
  - Phase 2b, added at the client's request (addendum FR-A01–A05):
    - Lead routing: round-robin, least-load or PIN-code territory, skipping people who are away or at capacity, with a manager queue as fallback.
    - Work-assignment suggestions for Site Supervisor, Office Executive, Loan and DISCOM Officer, and Project Engineer.
    - Follow-up cadences that stop when their stage moves on.
    - SLA timers with warn, breach and escalation. The check runs every minute and survives restarts because it is database-backed.
    - My Work (tasks, snooze, apply or override a suggestion) and dashboard "Today at a glance" tiles.
    - Automation console: rules, dry run, availability and territories, and a run log. Managers can reassign a lead's owner.
    - Rules start in suggest mode, and every change is versioned and audited.
  - Tests: 54 unit and 7 end-to-end.
- **Next step:** Phase 3 adds notifications (in-app, WhatsApp, SMS and email through one service, driven by the Booklet §9 matrix) and bank-statement reconciliation (CSV import with UTR auto-match).

## Layout

| Path | What |
|---|---|
| `packages/shared` | Domain rules shared by API and web: roles, module permissions, FRD §6 validations, the 23-stage workflow state machine. Pure TypeScript, unit-tested. |
| `apps/api` | NestJS + Prisma (PostgreSQL). Cookie JWT auth, role/module guard, row-level project scoping, audit log, stage-completion endpoints. |
| `apps/web` | Next.js app (dashboard, leads, site visits, finalize & advance, payments, projects). Proxies `/api/*` to the API. |
| `docker-compose.yml` | Local Postgres and Redis. |
| `apps/api/storage/` | Uploaded documents in development (git-ignored). Set `STORAGE_DIR` to move it. |

## Run locally

```bash
pnpm install
pnpm infra:up
cp apps/api/.env.example apps/api/.env   # then set JWT_SECRET
pnpm build:shared
pnpm db:migrate
pnpm db:seed
pnpm dev                                  # API :4000, web :3100
```

Seeded dev users (password `Solar@123`, dev only): `admin@`, `sales@`, `supervisor@`, `accounts@`, `office@`, `loan@`, `discom@`, `engineer@`, `store@`, `partner@` — all `@solarcrm.local`.

## Tests

```bash
pnpm --filter @solarcrm/shared test   # rules + state machine
pnpm --filter @solarcrm/api test      # end-to-end against the dev database (needs infra + seed)
pnpm typecheck
```

## Workflow model

Stages are a dependency graph, not a single status: after Project Initiated, Government Registration, Loan, DISCOM and Design open in parallel. Loan is skipped when not required. Every stage completion is checked server-side for prerequisites, the acting role, and the FRD rule for that stage (`packages/shared/src/workflow.ts`).

## Known interpretations to confirm with the client

- **24-hour visit rule (FR-005):** measured from supervisor assignment to the scheduled visit time.
- **Permission matrix (open point 13):** default derived from Booklet §3; ADMIN may complete any stage.
- **Object storage:** not yet provisioned; provider is open point 14.
