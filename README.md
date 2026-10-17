# SolarCRM

Solar CRM/ERP built from the client FRD (FR-001 – FR-044) and the Integration Booklet.
Design and plan: [`docs/`](docs/) (wireframes, traceability, workshop questions, FRD addendum). Architecture: [`architecture.md`](architecture.md).

## Status

- **Phase:** Phase 4 (reports, exports and integrations) is complete.
- **Progress:**
  - Phases 0–3b: the full 23-stage workflow, documents, schedules, incentives, automation, notifications, bank reconciliation and the AI Advisor.
  - Phase 4:
    - **Reports** (Booklet §11): KPIs for leads and conversion by source, site visits, project schedule, payments, loan, DISCOM, material and incentives, filtered by date. The project register exports as CSV, with no contact details, formula-safe cells, and an audit entry for each export.
    - **Signed inbound webhooks** (HMAC-SHA256) for the payment gateway and DISCOM:
      - A gateway success becomes bank evidence for the Accounts match. Accounts still approves.
      - A DISCOM status update changes the application, and "final approved" closes stage 21 when its gates pass.
    - **Accounting outbox:** verified payments and incentive payouts are sent one way to `ACCOUNTING_WEBHOOK_URL`, with retries and idempotency keys.
    - **Settings → Integrations** shows each connector's status and the call log.
    - **Document checksums:** every upload stores a SHA-256.
  - Tests: 60 unit and 10 end-to-end.
- **Next step:** Phase 5 covers hardening and go-live: a security review, data-retention notes, performance checks, the in-app user guide, UAT scripts per role, and cutover notes.

## Layout

| Path | What |
|---|---|
| `packages/shared` | Domain rules shared by API and web: roles, module permissions, FRD §6 validations, the 23-stage workflow state machine. Pure TypeScript, unit-tested. |
| `apps/api` | NestJS + Prisma (PostgreSQL). Cookie JWT auth, role/module guard, row-level project scoping, audit log, stage-completion endpoints. |
| `apps/web` | Next.js app: every workflow screen, My Work, automation, settings, reports and the AI Advisor panel. Proxies `/api/*` to the API. |
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
| `INTEGRATION_SECRET_PAYMENT_GATEWAY`, `INTEGRATION_SECRET_DISCOM` | Shared secrets for inbound webhooks. The sender puts `sha256=<hex HMAC of the raw body>` in `x-solarcrm-signature`. Unset means the endpoint refuses calls. |
| `ACCOUNTING_WEBHOOK_URL` | Verified payments and incentive payouts are POSTed here. Unset means the entries are marked Skipped. |
| `ACCOUNTING_WEBHOOK_URL_SECRET` | When set, outbound accounting calls are signed the same way. |
| `AUTOMATION_TICK_MS`, `NOTIFY_TICK_MS`, `INTEGRATION_TICK_MS` | Worker intervals (defaults 60 s, 30 s and 30 s). |

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
