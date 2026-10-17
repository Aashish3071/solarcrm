# Go-live runbook

Phase 5 output: what was reviewed, what must be set before production, how data is kept, and how to cut over. Items marked **Client** need a decision from the client; they are not blocking a pilot.

## 1. Security review (Phase 5)

| Area | State | Notes |
|---|---|---|
| Authentication | Done | bcrypt password hashes; httpOnly, SameSite=Lax session cookie; `Secure` by default when `NODE_ENV=production`. |
| Brute force | Done | 5 failed logins per email or 20 per client address in 15 minutes returns 429 with `Retry-After`. Failures and throttles are audited. In-memory per API instance; move to Redis when running more than one. |
| Account enumeration | Done | Unknown emails still run a password hash comparison, so response time doesn't reveal which accounts exist. Same error message either way. |
| Sign-out | Done | Sign-out increments `User.sessionVersion`; every earlier token for that user stops working on every device. Deactivating a user takes effect on their next request. |
| Authorisation | Done | Global guard; module permissions per role (Booklet §3, open point 13); row scoping per role; ADMIN may complete any stage. Every stage rule is re-checked on the server. |
| Secrets | Done | API refuses to start without `JWT_SECRET`, and in production requires it to be at least 32 characters. Webhook secrets are per connector. |
| Headers | Done | API: `nosniff`, `X-Frame-Options: DENY`, `no-referrer`, `Cache-Control: no-store`, no `X-Powered-By`. Web: `nosniff`, frame-ancestors none, object-src none, base-uri/form-action self, camera allowed for site photos. |
| CSP for scripts | Follow-up | Next.js injects inline bootstrap scripts; a nonce-based `script-src` needs middleware and is planned after the pilot. |
| Uploads | Done | Type checked from file content, 10 MB limit, allowed types per role and document type, SHA-256 stored, downloads scoped to the project. |
| Webhooks | Done | HMAC-SHA256 over the raw body, constant-time compare; unconfigured connectors refuse calls. Every call is logged. |
| Exports | Done | CSV leaves out phone, email and address; cells starting with `= + - @` are neutralised; each export is audited. |
| AI Advisor | Done | Read-only tools with the same scope as the API; phone, email, UTR and address never sent; writes are proposals the user confirms; per-role switch and hourly limit. |
| Audit | Done | Append-only `AuditLog` for logins, stage changes, payments, config, exports, assignments. |
| Dependency audit | Run before release | `pnpm audit --prod` in CI; fix highs before go-live. |
| Field encryption (KYC, bank) | **Client** | No KYC or bank account fields are collected yet (open point 1). Add column-level encryption if they are. Use encrypted disks and TLS for the database. |

## 2. Production environment checklist

API (`apps/api/.env`):

| Variable | Required | Value |
|---|---|---|
| `NODE_ENV` | yes | `production` |
| `DATABASE_URL` | yes | Managed PostgreSQL 16 with TLS (`?sslmode=require`) |
| `JWT_SECRET` | yes | 32+ random characters (`openssl rand -hex 32`) |
| `COOKIE_SECURE` | no | Leave unset (secure in production). Only set `false` for a plain-HTTP trial. |
| `TRUST_PROXY` | if behind a load balancer | Number of proxy hops or the proxy subnet, so login throttling sees the real client address. Default trusts loopback (the web proxy on the same host). |
| `STORAGE_DIR` | yes until cloud storage | A persistent, backed-up volume. |
| `ANTHROPIC_API_KEY`, `ADVISOR_MODEL` | optional | Turns on the AI Advisor. |
| `NOTIFY_WEBHOOK_URL`, `NOTIFY_WEBHOOK_SECRET` | optional | External notifications (n8n or provider gateway). |
| `INTEGRATION_SECRET_PAYMENT_GATEWAY`, `INTEGRATION_SECRET_DISCOM` | optional | Inbound webhooks. |
| `ACCOUNTING_WEBHOOK_URL`, `ACCOUNTING_WEBHOOK_URL_SECRET` | optional | Outbound accounting sync. |

Web: `API_URL` pointing at the API (internal address).

Seed: run `pnpm db:seed` once to load config, rules and the notification matrix, then **change or deactivate every seeded user**. The seed passwords are for development only.

## 3. Data retention and backup

Defaults below follow common Indian practice for commercial and tax records. **Client** to confirm with their accountant / legal adviser; nothing is deleted automatically yet.

| Data | Proposed retention | Reason |
|---|---|---|
| Projects, payments, terms, incentive results, completion documents | 8 years after project close | Accounting and tax record keeping |
| Audit log, stage events | 8 years | Evidence for the above |
| Site photos, design files | Life of the system warranty (typically 5–10 years) | Service and warranty claims |
| Leads that never converted | 2 years after last activity, then anonymise name, phone and address | Data minimisation |
| Notifications (inbox / outbox) | 1 year | Operational only |
| AI conversations and usage log | 90 days (usage totals kept) | Contains free text typed by staff |
| Integration log, bank statement lines | 2 years | Reconciliation disputes |

Backups: daily PostgreSQL snapshots kept 30 days plus monthly kept 12 months; the storage volume backed up on the same schedule. Restore drill before go-live: restore last night's backup into a staging database and open three projects end to end.

## 4. Performance

Measured on a laptop with 3,000 projects in the database: project list 173 ms (all open projects, about 2 MB server-to-server), KPI report 130 ms, My Work 6 ms. The project list returns every open project so no stage queue can miss one, plus the 100 most recently closed; very old closed projects are reachable from Reports / CSV. Revisit with server-side filtering per screen beyond roughly 10,000 open projects.

## 5. Cutover plan

1. **T−10 days:** UAT sign-off per role (`docs/uat.md`). Freeze configuration: discount ceiling, incentive rules, masters, notification matrix, automation rules, SLA targets.
2. **T−7:** Provision production database, storage volume, domains and TLS. Set environment from §2. Run migrations and seed. Create real users; deactivate seeded ones.
3. **T−5:** Train each role (30–45 minutes each using the in-app Guide and the UAT script for that role).
4. **T−3:** Load open projects. For each live project: create the lead, then complete stages up to its real position with the actual dates (Admin can complete any stage; every completion is audited). Upload key documents.
5. **T−1:** Restore drill (§3). Turn on connectors that are ready; leave the rest manual.
6. **Go-live day:** New leads only in SolarCRM. Old tracker read-only. Accounts verifies payments only in SolarCRM.
7. **First two weeks:** daily 15-minute check of My Work escalations, Payments queue age and the Integration log. Collect change requests separately from defects.

Rollback: the old tracker stays read-only, not deleted, for 30 days. If go-live is stopped, export the project register CSV and resume in the tracker.

## 6. Open points still with the client

Pricing formula (3), project types and packages (2), Gov portal and bank masters (4, 6), End Date formula (7), material master (8), incentive 3–4% band and partner rules (10, 11), permission matrix review (13), gateway / storage / accounting vendors (14), routing territories and SLA targets (15–18), AI data-residency policy (19). See `docs/workshop-and-frd-addendum.md`.
