# SolarCRM

Solar CRM/ERP built from the client FRD (FR-001 – FR-044) and the Integration Booklet.
Design and plan: [`docs/`](docs/) (wireframes, traceability, workshop questions, FRD addendum). Architecture: [`architecture.md`](architecture.md).

## Status

- **Phase:** 1 in progress. Part A (stages 1–10) is done.
- **Progress:**
  - Phase 0: foundations (auth, roles, audit, 23-stage workflow engine, app shell).
  - Phase 1A:
    - Leads: kanban and list views, a New Lead form, and requirement capture.
    - Site Visits: supervisor assignment, visit scheduling with the 24-hour reason, and the site assessment.
    - Finalize & Advance: final terms with the 4% discount limit, customer confirmation, and the advance with its UTR.
    - Payments: an Accounts verification queue with approve and reject, receipt history, and outstanding and collection KPIs.
    - Project detail: a "Your next steps" panel for each role, and initiation (stage 10).
  - Tests: 33 unit and 4 end-to-end.
- **Next step:** Phase 1B covers stages 10–20:
  - Project Initiation screen and team assignment
  - Government Registration
  - Loan Processing
  - DISCOM
  - Site Revisit & Design
  - Planning & Material
  - Installation & Completion
  - document and photo uploads, which need an object-storage choice (open point 14)

## Layout

| Path | What |
|---|---|
| `packages/shared` | Domain rules shared by API and web: roles, module permissions, FRD §6 validations, the 23-stage workflow state machine. Pure TypeScript, unit-tested. |
| `apps/api` | NestJS + Prisma (PostgreSQL). Cookie JWT auth, role/module guard, row-level project scoping, audit log, stage-completion endpoints. |
| `apps/web` | Next.js app (dashboard, leads, site visits, finalize & advance, payments, projects). Proxies `/api/*` to the API. |
| `docker-compose.yml` | Local Postgres and Redis. |

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
