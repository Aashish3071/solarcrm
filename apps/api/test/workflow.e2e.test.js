// End-to-end: boots the compiled API against the dev database (seeded) and
// walks the first ten stages, checking server-side gates and role scoping.
// Run: pnpm --filter @solarcrm/api test   (requires `pnpm infra:up`, migrate, seed)
require("reflect-metadata");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.DATABASE_URL ??= "postgresql://solarcrm:solarcrm@localhost:5432/solarcrm?schema=public";
process.env.JWT_SECRET ??= "test-secret";

let app;
let base;
const created = [];

before(async () => {
  const { NestFactory } = require("@nestjs/core");
  const cookieParser = require("cookie-parser");
  const { AppModule } = require(path.join(__dirname, "../dist/app.module"));
  app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser());
  app.setGlobalPrefix("api");
  await app.listen(0);
  base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
});

after(async () => {
  // Remove test projects so repeated runs don't pollute the dev database.
  if (created.length) {
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    await prisma.auditLog.deleteMany({ where: { entityId: { in: created } } });
    await prisma.project.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  }
  await app?.close();
});

async function login(email) {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: process.env.SEED_PASSWORD || "Solar@123" }),
  });
  assert.equal(res.status, 200, `login ${email}`);
  const cookie = res.headers.get("set-cookie").split(";")[0];
  return async (method, url, body) => {
    const r = await fetch(base + url, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}

test("rejects unauthenticated requests", async () => {
  const r = await fetch(`${base}/projects`);
  assert.equal(r.status, 401);
});

test("wrong password is refused", async () => {
  const r = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "sales@solarcrm.local", password: "nope" }),
  });
  assert.equal(r.status, 401);
});

test("duplicate UTR is refused", async () => {
  const sales = await login("sales@solarcrm.local");
  const users = (await sales("GET", "/users")).body;
  const utr = `DUP${Date.now()}`;
  async function toConfirmed() {
    const r = await sales("POST", "/projects", { customerName: "E2E Dup", phone: "9800000002", address: "X", leadSource: "DIRECT" });
    created.push(r.body.id);
    const done = (stage, input) => sales("POST", `/projects/${r.body.id}/stages/${stage}/complete`, { input });
    await done("REQUIREMENT_CAPTURED", { requiredKw: 3, loanRequired: false, projectType: "Residential", packageName: "Standard" });
    await done("SUPERVISOR_ASSIGNED", { supervisorId: users.find((u) => u.role === "SITE_SUPERVISOR").id });
    return { id: r.body.id, done };
  }
  const admin = await login("admin@solarcrm.local");
  for (const which of [1, 2]) {
    const { id, done } = await toConfirmed();
    const adm = (stage, input) => admin("POST", `/projects/${id}/stages/${stage}/complete`, { input });
    await adm("VISIT_SCHEDULED", { scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    await adm("VISIT_COMPLETED", { feasible: true, actualKw: 3 });
    await done("SALES_FINALIZED", { finalCost: 150000, discountPct: 2, paymentTerms: "30/70" });
    await done("CUSTOMER_CONFIRMED", {});
    const r = await done("ADVANCE_LOGGED", { amount: 45000, mode: "UPI", utr });
    assert.equal(r.status, which === 1 ? 200 : 422);
  }
});

test("lead to initiation with gates enforced", async () => {
  const sales = await login("sales@solarcrm.local");
  const supervisor = await login("supervisor@solarcrm.local");
  const accounts = await login("accounts@solarcrm.local");
  const users = (await sales("GET", "/users")).body;
  const idOf = (role) => users.find((u) => u.role === role).id;

  // FR-001: partner source without a partner is refused
  let r = await sales("POST", "/projects", {
    customerName: "E2E Customer", phone: "9800000001", address: "Sector 9", leadSource: "SALES_PARTNER",
  });
  assert.equal(r.status, 422);

  r = await sales("POST", "/projects", {
    customerName: "E2E Customer", phone: "9800000001", address: "Sector 9", leadSource: "DIRECT",
  });
  assert.equal(r.status, 201);
  const id = r.body.id;
  created.push(id);
  assert.match(r.body.code, /^SLR-\d{4}-\d{5}$/);

  const done = (actor, stage, input) => actor("POST", `/projects/${id}/stages/${stage}/complete`, { input });

  // FR-002: requirement fields
  assert.equal((await done(sales, "REQUIREMENT_CAPTURED", {})).status, 422);
  r = await done(sales, "REQUIREMENT_CAPTURED", { requiredKw: 5, loanRequired: false, projectType: "Residential", packageName: "Standard" });
  assert.equal(r.status, 200);
  assert.equal(r.body.requiredKw, "5");
  assert.deepEqual(r.body.skippedStages, ["LOAN_PROCESSED"]);

  // Supervisor cannot see the project before being assigned (row scoping)
  assert.equal((await supervisor("GET", `/projects/${id}`)).status, 404);
  assert.equal((await done(sales, "SUPERVISOR_ASSIGNED", { supervisorId: idOf("SITE_SUPERVISOR") })).status, 200);
  assert.equal((await supervisor("GET", `/projects/${id}`)).status, 200);

  // FR-005: >24h needs a reason
  const later = new Date(Date.now() + 48 * 3600_000).toISOString();
  assert.equal((await done(supervisor, "VISIT_SCHEDULED", { scheduledAt: later })).status, 422);
  assert.equal((await done(supervisor, "VISIT_SCHEDULED", { scheduledAt: later, reason: "Customer travelling" })).status, 200);
  assert.equal((await done(supervisor, "VISIT_COMPLETED", { feasible: true })).status, 422);
  r = await done(supervisor, "VISIT_COMPLETED", { feasible: true, actualKw: 4.5, deviations: "Shadow on east roof" });
  assert.equal(r.status, 200);
  assert.equal(r.body.siteVisit.actualKw, "4.5");

  // FR-039: 4% ceiling
  const fin = { finalCost: 270000, paymentTerms: "Advance 30 / Bank 60 / Final 10" };
  assert.equal((await done(sales, "SALES_FINALIZED", { ...fin, discountPct: 4.5 })).status, 422);
  assert.equal((await done(sales, "SALES_FINALIZED", { ...fin, discountPct: 3.5 })).status, 200);

  // FR-008: no advance before confirmation
  const pay = { amount: 81000, mode: "NEFT", utr: `E2E${Date.now()}` };
  assert.equal((await done(sales, "ADVANCE_LOGGED", pay)).status, 422);
  assert.equal((await done(sales, "CUSTOMER_CONFIRMED", {})).status, 200);
  assert.equal((await done(sales, "ADVANCE_LOGGED", { ...pay, utr: "" })).status, 422);
  r = await done(sales, "ADVANCE_LOGGED", pay);
  assert.equal(r.status, 200);
  assert.equal(r.body.payments[0].status, "LOGGED");

  // Accounts sees it in the verification queue
  const queue = (await accounts("GET", "/payments/queue")).body;
  assert.ok(queue.some((q) => q.projectId === id && q.utr === pay.utr));

  // FR-010: Sales cannot verify; Accounts rejection sends it back
  assert.equal((await done(sales, "PAYMENT_VERIFIED", { decision: "APPROVED" })).status, 422);
  r = await accounts("POST", `/projects/${id}/payment-rejection`, { reason: "UTR not in statement" });
  assert.equal(r.status, 200);
  assert.ok(!r.body.completedStages.includes("ADVANCE_LOGGED"));
  assert.equal(r.body.payments[0].status, "REJECTED");
  // A rejected UTR may be logged again once corrected; a live duplicate may not.
  assert.equal((await done(sales, "ADVANCE_LOGGED", pay)).status, 200);
  r = await done(accounts, "PAYMENT_VERIFIED", { decision: "APPROVED" });
  assert.equal(r.status, 200);
  assert.equal(r.body.payments[0].status, "APPROVED");

  // FR-011: initiation needs an Office Executive
  assert.equal((await done(sales, "PROJECT_INITIATED", {})).status, 422);
  r = await done(sales, "PROJECT_INITIATED", { officeExecutiveId: idOf("OFFICE_EXECUTIVE") });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.availableStages, ["GOV_REGISTERED", "DISCOM_APPLIED", "DESIGN_UPLOADED"]);
});
