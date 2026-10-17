# SolarCRM

Solar CRM/ERP built from the client FRD (FR-001 – FR-044) and the Integration Booklet.
Design and plan: [`docs/`](docs/) (wireframes, traceability, workshop questions, FRD addendum). Architecture: [`architecture.md`](architecture.md).

## Status

- **Phase:** Phase 5 (hardening and go-live preparation) is complete. Every planned build phase (0–5) is done.
- **Progress:**
  - Phases 0–4: the full 23-stage workflow, documents, schedules, incentives, automation, notifications, bank reconciliation, AI Advisor, reports and integrations.
  - Phase 5:
    - **Security:** login throttling (5 per email or 20 per address in 15 minutes); constant-time handling of unknown emails; sign-out revokes every session (`sessionVersion`); secure cookies by default in production; production refuses a short `JWT_SECRET`; security headers on the API and web; dependency audit clean, enforced in CI.
    - **Reliability:** event handlers drain on shutdown; tests wait for handlers instead of sleeping. The project list returns every open project, so no stage queue can drop one at volume; there is also a new index for report date ranges.
    - **Performance:** checked with 3,000 projects. Project list 173 ms, KPI report 130 ms.
    - **In-app Guide** (`? Guide`): each role's steps, generated from the workflow definitions, with what the server checks before each step closes.
    - **Go-live documents:** [`docs/go-live.md`](docs/go-live.md) (security review, production environment, retention and backup, cutover and rollback) and [`docs/uat.md`](docs/uat.md) (scripts for every role).
  - Tests: 60 unit and 11 end-to-end.
- **Next step:** client UAT using `docs/uat.md`, decisions on the open points listed in `docs/go-live.md` §6, then cutover as in §5. Follow-ups after the pilot:
  - Nonce-based script CSP.
  - Cloud object storage once the vendor is chosen.
  - Login throttle in Redis when running more than one API instance.

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

Seeded dev users (password `Solar@123`, dev only — change or deactivate them in production, see `docs/go-live.md`): `admin@`, `sales@`, `supervisor@`, `accounts@`, `office@`, `loan@`, `discom@`, `engineer@`, `store@`, `partner@` — all `@solarcrm.local`.

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
| `TRUST_PROXY` | Proxy hops or subnet to trust, so login throttling and audit see the real client address (default: loopback). |
| `COOKIE_SECURE` | Overrides the secure-cookie default (on when `NODE_ENV=production`). |
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

- **Internal use only:** SolarCRM is used by the organisation's staff and sales partners. There is no customer portal; Sales records customer confirmation (stage 7) and training acknowledgement (stage 20) on the customer's behalf, and customers are reached through notifications (email, SMS, WhatsApp).

- **24-hour visit rule (FR-005):** measured from supervisor assignment to the scheduled visit time.
- **Permission matrix (open point 13):** default derived from Booklet §3; ADMIN may complete any stage.
- **Object storage:** not yet provisioned; provider is open point 14.
