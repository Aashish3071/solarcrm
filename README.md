# SolarCRM

Solar CRM/ERP built from the client FRD (FR-001 – FR-044) and the Integration Booklet.
Design and plan: [`docs/`](docs/) (wireframes, traceability, workshop questions, FRD addendum). Architecture: [`architecture.md`](architecture.md).

## Status

- **Phase:** Phase 3 (notifications and reconciliation) is complete.
- **Progress:**
  - Phases 0–2b: the full 23-stage workflow, documents, schedules, incentives and automation.
  - Phase 3, notifications (FR-044):
    - In-app alerts when a stage opens for you, plus the Booklet §9 events: visit scheduled, payment verified or rejected, loan, DISCOM, material, installation complete, final DISCOM, and SLA delay.
    - A bell with an inbox.
    - An editable notification matrix.
    - An outbox with retries. Messages are posted to an integration-layer webhook when `NOTIFY_WEBHOOK_URL` is set, and marked Skipped when no provider is configured.
    - A delivery log.
  - Phase 3, bank reconciliation (Booklet §6.4): bank-statement CSV import (duplicates ignored) and UTR auto-match shown in the Accounts queue as Matched, Amount differs or Not in statement. Accounts still approves every payment.
  - The top-bar project search now works.
  - Tests: 60 unit and 8 end-to-end.
- **Next step:** Phase 3b builds the AI Advisor (summaries, lead finder, delay risk, message drafts and Q&A, limited to what the user's role can see, with confirm-to-act).

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
