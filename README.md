# SolarCRM

Solar CRM/ERP built from the client FRD (FR-001 – FR-044) and the Integration Booklet.
Design and plan: [`docs/`](docs/) (wireframes, traceability, workshop questions, FRD addendum). Architecture: [`architecture.md`](architecture.md).

## Status

- **Phase:** Phase 3b (AI Advisor) is complete.
- **Progress:**
  - Phases 0–3: the full 23-stage workflow, documents, schedules, incentives, automation, notifications and bank reconciliation.
  - Phase 3b, added at the client's request (addendum FR-AI01–AI06):
    - A chat panel behind the ✦ button. It summarises projects, finds leads (by text, stage, idle time or "waiting on me"), lists at-risk projects, shows your tasks, and previews incentives through the calculator.
    - It drafts follow-ups and customer messages as proposals. Nothing happens until you confirm, and customer messages can be edited first.
    - Model `claude-opus-5` (override with `ADVISOR_MODEL`) with server-side refusal fallbacks and prompt caching.
    - Tools are read-only and scoped to the user's role and projects. Phone, email, UTR and street address never reach the model.
    - Per-role enablement, an hourly limit and a usage log.
  - Tests: 60 unit and 9 end-to-end. The advisor test runs the real SDK and tool loop against a local fake Messages API, so it costs nothing.
- **Next step:** Phase 4 adds KPI reports and exports (Booklet §11), an accounting one-way sync interface, a payment-gateway webhook connector, and storage hardening.

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

## Optional integrations (environment)

| Variable | Effect |
|---|---|
| `NOTIFY_WEBHOOK_URL` | External notifications (email, SMS, WhatsApp) are POSTed here in the Booklet §8.3 shape, e.g. to an n8n flow. Unset means they are marked Skipped. |
| `NOTIFY_WEBHOOK_SECRET` | Sent as `x-solarcrm-secret` so the receiver can verify the caller. |
| `ANTHROPIC_API_KEY` | Turns on the AI Advisor. Unset, the panel says it isn't configured. |
| `ADVISOR_MODEL` | Advisor model (default `claude-opus-5`). |
| `STORAGE_DIR` | Where uploaded documents are stored (local disk). |
| `AUTOMATION_TICK_MS`, `NOTIFY_TICK_MS` | Worker intervals (defaults 60 s and 30 s). |

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
