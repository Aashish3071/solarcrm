# SolarCRM

Solar CRM/ERP built from the client FRD (FR-001 – FR-044) and the Integration Booklet.
Design and plan: [`docs/`](docs/) (wireframes, traceability, workshop questions, FRD addendum). Architecture: [`architecture.md`](architecture.md).

## Status

- **Phase:** Phase 1 (A and B) is complete. Every stage from 1 to 21 now has a working screen.
- **Progress:**
  - Phase 0: foundations.
  - Phase 1A: lead to verified advance (stages 1–10).
  - Phase 1B: stages 10–21:
    - Initiation and team assignment
    - Government registration, in manual mode
    - Loan: application, approval, client re-confirmation and the customer/bank split
    - DISCOM application through to final approval
    - Site revisit and design uploads
    - Planning with the auto end date and rescheduling
    - Material ready, dispatched and received, with delay remarks
    - Installation with mandatory photos
    - Completion certificate, and client training with its certificate
    - Loan instalments and collections, logged by Sales and verified by Accounts
    - Document storage: local disk behind a storage interface
  - Tests: 33 unit and 5 end-to-end.
- **Next step:** Phase 2 adds payment schedules with overdue tracking, stage 22 (payment collection), the incentive and commission engine for stage 23, and the admin configuration UI.

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
