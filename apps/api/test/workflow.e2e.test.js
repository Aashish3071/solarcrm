// End-to-end: boots the compiled API against the dev database (seeded) and
// walks the first ten stages, checking server-side gates and role scoping.
// Run: pnpm --filter @solarcrm/api test   (requires `pnpm infra:up`, migrate, seed)
require("reflect-metadata");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.DATABASE_URL ??= "postgresql://solarcrm:solarcrm@localhost:5432/solarcrm?schema=public";
process.env.JWT_SECRET ??= "test-secret";
process.env.AUTOMATION_TICK = "off"; // tests drive the SLA check explicitly
process.env.NOTIFY_TICK = "off";
delete process.env.NOTIFY_WEBHOOK_URL;

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
    await prisma.automationRun.deleteMany({ where: { projectId: { in: created } } });
    await prisma.notification.deleteMany({ where: { projectId: { in: created } } });
    await prisma.bankStatementLine.deleteMany({ where: { reference: { startsWith: "RECON" } } });
    await prisma.project.deleteMany({ where: { id: { in: created } } });
    for (const pid of created) require("node:fs").rmSync(path.join(process.cwd(), "storage", pid), { recursive: true, force: true });
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
  const call = async (method, url, body) => {
    const r = await fetch(base + url, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  call.upload = async (url, type, bytes, name = "file.png") => {
    const fd = new FormData();
    fd.append("type", type);
    fd.append("file", new Blob([bytes]), name);
    const r = await fetch(base + url, { method: "POST", headers: { cookie }, body: fd });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return call;
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

  // ---- Phase 1B: stages 11–21 ----
  const office = await login("office@solarcrm.local");
  const discom = await login("discom@solarcrm.local");
  const engineer = await login("engineer@solarcrm.local");
  const store = await login("store@solarcrm.local");
  const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000002000154a24f5d0000000049454e44ae426082", "hex");

  // FR-014: Office Executive assigns DISCOM Officer and Project Engineer
  assert.equal((await office("POST", `/projects/${id}/assignments`, { role: "DISCOM_OFFICER", userId: idOf("DISCOM_OFFICER") })).status, 200);
  assert.equal((await office("POST", `/projects/${id}/assignments`, { role: "PROJECT_ENGINEER", userId: idOf("PROJECT_ENGINEER") })).status, 200);
  // Store Manager only sees projects once they are planned
  assert.equal((await store("GET", `/projects/${id}`)).status, 404);

  // FR-012: submitted then registered
  assert.equal((await office("PUT", `/projects/${id}/gov`, { status: "SUBMITTED" })).status, 200);
  assert.equal((await office("PUT", `/projects/${id}/gov`, { status: "REGISTERED" })).status, 422);
  r = await office("PUT", `/projects/${id}/gov`, { status: "REGISTERED", registrationNo: "GR-1", registrationDate: "2026-09-20" });
  assert.equal(r.status, 200);
  assert.ok(r.body.completedStages.includes("GOV_REGISTERED"));

  // FR-021: DISCOM application
  r = await discom("PUT", `/projects/${id}/discom`, { applicationNo: "DC-1", status: "SUBMITTED" });
  assert.equal(r.status, 200);
  assert.ok(r.body.completedStages.includes("DISCOM_APPLIED"));

  // FR-023/024: design needs both documents; file type is checked by content
  assert.equal((await done(supervisor, "DESIGN_UPLOADED", { revisitAt: "2026-09-21T10:00:00Z", designDocId: "forged" })).status, 422);
  assert.equal((await supervisor.upload(`/projects/${id}/documents`, "DESIGN", Buffer.from("not really a png"))).status, 422);
  assert.equal((await supervisor.upload(`/projects/${id}/documents`, "COMPLETION_CERTIFICATE", PNG)).status, 403);
  assert.equal((await supervisor.upload(`/projects/${id}/documents`, "DESIGN", PNG)).status, 201);
  assert.equal((await supervisor.upload(`/projects/${id}/documents`, "INSTALLATION_PLAN", PNG)).status, 201);
  assert.equal((await done(supervisor, "DESIGN_UPLOADED", { revisitAt: "2026-09-21T10:00:00Z" })).status, 200);

  // FR-015/026: start date → expected end auto-calculated
  const start = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
  r = await done(engineer, "PROJECT_PLANNED", { startDate: start });
  assert.equal(r.status, 200);
  assert.ok(r.body.plan.expectedEnd > r.body.plan.plannedStart);
  // FR-025: reschedule recalculates
  r = await engineer("PUT", `/projects/${id}/plan/reschedule`, { startDate: new Date(Date.now() - 86400_000).toISOString().slice(0, 10), reason: "Customer request" });
  assert.equal(r.status, 200);
  assert.equal(r.body.plan.rescheduleCount, 1);

  // FR-027/029: start date is now in the past, so material is late → remark required
  assert.equal((await store("GET", `/projects/${id}`)).status, 200);
  assert.equal((await done(store, "MATERIAL_READY", {})).status, 422);
  assert.equal((await done(store, "MATERIAL_READY", { remark: "Inverter arrived late" })).status, 200);
  assert.equal((await done(store, "DISPATCHED", {})).status, 200);
  assert.equal((await done(supervisor, "RECEIVED_AT_SITE", {})).status, 422);
  assert.equal((await done(supervisor, "RECEIVED_AT_SITE", { remark: "Late dispatch" })).status, 200);

  // FR-031: photo mandatory; a client-claimed photoCount is ignored
  const exec = { startedAt: "2026-09-22", endedAt: "2026-09-23" };
  assert.equal((await done(supervisor, "INSTALLATION_DONE", { ...exec, photoCount: 5 })).status, 422);
  assert.equal((await supervisor.upload(`/projects/${id}/documents`, "INSTALLATION_PHOTO", PNG)).status, 201);
  assert.equal((await done(supervisor, "INSTALLATION_DONE", exec)).status, 200);

  // FR-033: completion needs the signed certificate
  assert.equal((await done(engineer, "COMPLETED", {})).status, 422);
  assert.equal((await engineer.upload(`/projects/${id}/documents`, "COMPLETION_CERTIFICATE", PNG, "cert.png")).status, 201);
  assert.equal((await done(engineer, "COMPLETED", {})).status, 200);

  // FR-032/035: training assigned, then completed with certificate
  assert.equal((await engineer("PUT", `/projects/${id}/training`, { assigneeId: idOf("SITE_SUPERVISOR") })).status, 200);
  assert.equal((await supervisor("POST", `/projects/${id}/training/complete`)).status, 422);
  assert.equal((await supervisor.upload(`/projects/${id}/documents`, "TRAINING_CERTIFICATE", PNG)).status, 201);
  assert.equal((await supervisor("POST", `/projects/${id}/training/complete`)).status, 200);

  // FR-034: final DISCOM approval needs a meter number
  assert.equal((await discom("PUT", `/projects/${id}/discom`, { applicationNo: "DC-1", status: "FINAL_APPROVED" })).status, 422);
  r = await discom("PUT", `/projects/${id}/discom`, { applicationNo: "DC-1", status: "FINAL_APPROVED", meterNumber: "MTR-1" });
  assert.equal(r.status, 200);
  assert.ok(r.body.completedStages.includes("FINAL_DISCOM_APPROVED"));

  // Documents are downloadable only within scope
  const docId = r.body.documents[0].id;
  const dl = await fetch(`${base}/documents/${docId}/file`, { headers: { cookie: "" } });
  assert.equal(dl.status, 401);
});

test("loan re-confirmation and instalments", async () => {
  const sales = await login("sales@solarcrm.local");
  const admin = await login("admin@solarcrm.local");
  const loanOfficer = await login("loan@solarcrm.local");
  const accounts = await login("accounts@solarcrm.local");
  const users = (await sales("GET", "/users")).body;
  const idOf = (role) => users.find((u) => u.role === role).id;
  let r = await sales("POST", "/projects", { customerName: "E2E Loan", phone: "9800000003", address: "Y", leadSource: "DIRECT" });
  const id = r.body.id;
  created.push(id);
  const adm = (stage, input) => admin("POST", `/projects/${id}/stages/${stage}/complete`, { input });
  await adm("REQUIREMENT_CAPTURED", { requiredKw: 5, loanRequired: true, loanAmount: 200000, projectType: "Residential", packageName: "Standard" });
  await adm("SUPERVISOR_ASSIGNED", { supervisorId: idOf("SITE_SUPERVISOR") });
  await adm("VISIT_SCHEDULED", { scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
  await adm("VISIT_COMPLETED", { feasible: true, actualKw: 5 });
  await adm("SALES_FINALIZED", { finalCost: 300000, discountPct: 1, paymentTerms: "Advance / Bank / Final" });
  await adm("CUSTOMER_CONFIRMED", {});
  await adm("ADVANCE_LOGGED", { amount: 30000, mode: "UPI", utr: `LA${Date.now()}` });
  await adm("PAYMENT_VERIFIED", { decision: "APPROVED" });
  await adm("PROJECT_INITIATED", { officeExecutiveId: idOf("OFFICE_EXECUTIVE") });
  const office = await login("office@solarcrm.local");
  assert.equal((await office("POST", `/projects/${id}/assignments`, { role: "LOAN_OFFICER", userId: idOf("LOAN_OFFICER") })).status, 200);

  // FR-017: approved amount differs → cannot complete until Sales re-confirms (FR-018)
  r = await loanOfficer("PUT", `/projects/${id}/loan`, { bank: "Bank A", status: "APPROVED", requestedAmount: 200000, approvedAmount: 180000 });
  assert.equal(r.status, 200);
  assert.equal(r.body.loan.split, null);
  const complete = () => loanOfficer("POST", `/projects/${id}/stages/LOAN_PROCESSED/complete`, { input: { approvedAmount: 200000 } });
  assert.equal((await complete()).status, 422);
  r = await sales("POST", `/projects/${id}/loan/reconfirm`);
  assert.equal(r.status, 200);
  // FR-019: split recalculated from the approved amount
  assert.deepEqual(r.body.loan.split, { bank: "180000", customer: "120000" });
  assert.equal((await complete()).status, 200);

  // FR-020/038: instalment 2 waits for verified instalment 1
  const pay = (kind, utr) => sales("POST", `/projects/${id}/payments`, { kind, amount: 90000, mode: "NEFT", utr });
  assert.equal((await pay("LOAN_INSTALMENT_2", `I2${Date.now()}`)).status, 422);
  r = await pay("LOAN_INSTALMENT_1", `I1${Date.now()}`);
  assert.equal(r.status, 201);
  const inst1 = r.body.payments.find((x) => x.kind === "LOAN_INSTALMENT_1");
  assert.equal((await sales("POST", `/projects/${id}/payments/${inst1.id}/verify`, { decision: "APPROVED" })).status, 403);
  assert.equal((await accounts("POST", `/projects/${id}/payments/${inst1.id}/verify`, { decision: "APPROVED" })).status, 200);
  assert.equal((await pay("LOAN_INSTALMENT_2", `I2${Date.now()}`)).status, 201);
});

test("schedule, collection and incentive (Phase 2)", async () => {
  const sales = await login("sales@solarcrm.local");
  const admin = await login("admin@solarcrm.local");
  const accounts = await login("accounts@solarcrm.local");
  const partner = await login("partner@solarcrm.local");
  const users = (await sales("GET", "/users")).body;
  const idOf = (role) => users.find((u) => u.role === role).id;
  const partners = (await sales("GET", "/partners")).body;
  const sun = partners.find((x) => x.type === "FULL");
  const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000002000154a24f5d0000000049454e44ae426082", "hex");

  let r = await sales("POST", "/projects", { customerName: "E2E Incentive", phone: "9800000004", address: "Z", leadSource: "SALES_PARTNER", partnerId: sun.id });
  const id = r.body.id;
  created.push(id);
  const adm = async (stage, input = {}) => {
    const res = await admin("POST", `/projects/${id}/stages/${stage}/complete`, { input });
    assert.equal(res.status, 200, `${stage}: ${JSON.stringify(res.body)}`);
    return res;
  };
  const up = (type) => admin.upload(`/projects/${id}/documents`, type, PNG);
  await adm("REQUIREMENT_CAPTURED", { requiredKw: 5, loanRequired: false, projectType: "Residential", packageName: "Standard" });
  await adm("SUPERVISOR_ASSIGNED", { supervisorId: idOf("SITE_SUPERVISOR") });
  await adm("VISIT_SCHEDULED", { scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
  await adm("VISIT_COMPLETED", { feasible: true, actualKw: 5 });
  await adm("SALES_FINALIZED", { finalCost: 150000, discountPct: 2, paymentTerms: "Advance 50 / Final 50" });
  await adm("CUSTOMER_CONFIRMED");

  // FR-036: schedule must add up to the final cost; bank rows need a loan
  const past = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
  const future = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  assert.equal((await sales("PUT", `/projects/${id}/schedule`, { items: [{ label: "Advance", payer: "CUSTOMER", amount: 75000, dueDate: past }] })).status, 422);
  assert.equal((await sales("PUT", `/projects/${id}/schedule`, { items: [{ label: "All", payer: "BANK", amount: 150000, dueDate: past }] })).status, 422);
  r = await sales("PUT", `/projects/${id}/schedule`, {
    items: [
      { label: "Advance", payer: "CUSTOMER", amount: 75000, dueDate: past },
      { label: "Final", payer: "CUSTOMER", amount: 75000, dueDate: future },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.schedule.length, 2);

  // Overdue: 75,000 due in the past, nothing verified yet
  let sched = (await accounts("GET", "/payments/schedules")).body.find((x) => x.projectId === id);
  assert.equal(sched.overdue, "75000.00");

  await adm("ADVANCE_LOGGED", { amount: 75000, mode: "NEFT", utr: `INC${Date.now()}` });
  await adm("PAYMENT_VERIFIED", { decision: "APPROVED" });
  sched = (await accounts("GET", "/payments/schedules")).body.find((x) => x.projectId === id);
  assert.equal(sched.overdue, "0.00");

  await adm("PROJECT_INITIATED", { officeExecutiveId: idOf("OFFICE_EXECUTIVE") });
  await adm("GOV_REGISTERED", { registrationNo: "GR-9", registrationDate: "2026-09-20" });
  await adm("DISCOM_APPLIED", { applicationNo: "DC-9" });
  await up("DESIGN");
  await up("INSTALLATION_PLAN");
  await adm("DESIGN_UPLOADED", { revisitAt: "2026-09-21" });
  await adm("PROJECT_PLANNED", { startDate: future });
  await adm("MATERIAL_READY");
  await adm("DISPATCHED");
  await adm("RECEIVED_AT_SITE");
  await up("INSTALLATION_PHOTO");
  await adm("INSTALLATION_DONE", { startedAt: "2026-09-22", endedAt: "2026-09-23" });
  await up("COMPLETION_CERTIFICATE");
  await adm("COMPLETED");

  // FR-036/037: collection cannot close while money is outstanding or unverified
  const collect = () => sales("POST", `/projects/${id}/stages/PAYMENTS_COLLECTED/complete`, { input: { allPaymentsVerified: true } });
  assert.equal((await collect()).status, 422);
  r = await sales("POST", `/projects/${id}/payments`, { kind: "COLLECTION", amount: 75000, mode: "UPI", utr: `FIN${Date.now()}` });
  assert.equal(r.status, 201);
  assert.equal((await collect()).status, 422);
  const pay = r.body.payments.find((x) => x.kind === "COLLECTION");
  assert.equal((await accounts("POST", `/projects/${id}/payments/${pay.id}/verify`, { decision: "APPROVED" })).status, 200);

  // FR-043: per-user override is used for this salesperson
  const salesId = idOf("SALES");
  assert.equal((await admin("PUT", "/config/incentive.fixedPct", { value: 150, userId: salesId })).status, 422);
  assert.equal((await admin("PUT", "/config/incentive.fixedPct", { value: 1, userId: salesId })).status, 200);

  // Stage 22 completes and stage 23 runs automatically (FR-040/042)
  r = await collect();
  assert.equal(r.status, 200);
  assert.ok(r.body.completedStages.includes("INCENTIVE_CALCULATED"));
  assert.equal(r.body.currentStage, "FINAL_DISCOM_APPROVED"); // stage 21 runs independently of collection
  assert.equal(r.body.incentive.incentivePct, "1.3");
  assert.equal(r.body.incentive.incentiveAmount, "1950");
  assert.equal(r.body.incentive.partnerCommissionAmount, "10500");
  assert.equal(r.body.incentive.provisional, true);

  // Partner sees own commission but not the in-house incentive
  const mine = (await partner("GET", "/incentives")).body.find((x) => x.projectId === id);
  assert.equal(mine.partnerCommissionAmount, "10500");
  assert.equal(mine.incentiveAmount, null);
  await admin("DELETE", `/config/incentive.fixedPct/users/${salesId}`);
});

test("automation: routing, suggestions, follow-ups and SLA (Phase 2b)", async () => {
  const sales = await login("sales@solarcrm.local");
  const admin = await login("admin@solarcrm.local");
  const accounts = await login("accounts@solarcrm.local");
  const settle = () => new Promise((r) => setTimeout(r, 400)); // automation reacts to events asynchronously
  const users = (await sales("GET", "/users")).body;
  const idOf = (role) => users.find((u) => u.role === role).id;

  let r = await sales("POST", "/projects", { customerName: "E2E Auto", phone: "9800000005", address: "Baner, Pune 411045", leadSource: "DIRECT" });
  const id = r.body.id;
  created.push(id);
  await settle();

  // FR-A01: routing suggestion lands in the manager (Admin) queue, not with Sales
  let work = (await admin("GET", "/work")).body;
  const route = work.tasks.find((t) => t.projectId === id && t.kind === "ASSIGNMENT");
  assert.ok(route, "routing suggestion for admin");
  assert.equal(route.suggestion.kind, "OWNER");
  assert.equal((await sales("POST", `/tasks/${route.id}/apply`)).status, 404); // not Sales' task
  assert.equal((await admin("POST", `/tasks/${route.id}/apply`)).status, 200);

  // FR-A03: new-lead follow-ups for the owner; FR-A04: first-touch SLA started
  work = (await sales("GET", "/work")).body;
  const fus = work.tasks.filter((t) => t.projectId === id && t.kind === "FOLLOW_UP");
  assert.equal(fus.length, 3);
  assert.ok(work.clocks.some((c) => c.projectId === id && c.stage === "REQUIREMENT_CAPTURED" && c.state === "OK"));
  assert.equal((await sales("POST", `/tasks/${fus[0].id}/snooze`, { hours: 2 })).status, 200);

  // Capturing the requirement cancels those follow-ups and opens a supervisor suggestion for Sales
  await sales("POST", `/projects/${id}/stages/REQUIREMENT_CAPTURED/complete`, { input: { requiredKw: 3, loanRequired: false, projectType: "Residential", packageName: "Standard" } });
  await settle();
  work = (await sales("GET", "/work")).body;
  assert.equal(work.tasks.filter((t) => t.projectId === id && t.kind === "FOLLOW_UP").length, 0);
  const sup = work.tasks.find((t) => t.projectId === id && t.kind === "ASSIGNMENT");
  assert.equal(sup.suggestion.role, "SITE_SUPERVISOR");
  assert.equal(sup.suggestion.userId, idOf("SITE_SUPERVISOR"));
  r = await sales("POST", `/tasks/${sup.id}/apply`);
  assert.equal(r.status, 200);
  const detail = (await sales("GET", `/projects/${id}`)).body;
  assert.ok(detail.completedStages.includes("SUPERVISOR_ASSIGNED"));

  // SLA breach escalates to the Admin queue (clock moved back in time directly in the DB)
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  await prisma.slaTimer.updateMany({ where: { projectId: id, stage: "VISIT_SCHEDULED" }, data: { startedAt: new Date(Date.now() - 30 * 3600_000) } });
  await prisma.$disconnect();
  assert.equal((await admin("POST", "/automation/tick")).status, 200);
  work = (await admin("GET", "/work")).body;
  assert.ok(work.tasks.some((t) => t.projectId === id && t.kind === "SLA_ESCALATION"));
  const runs = (await admin("GET", "/automation/runs")).body;
  assert.ok(runs.some((x) => x.projectId === id && x.outcome === "SLA_BREACHED"));

  // FR-A05: rules are validated and only Admin can reach the console
  const rules = (await admin("GET", "/automation/rules")).body;
  const sla = rules.find((x) => x.kind === "SLA");
  assert.equal((await admin("PUT", `/automation/rules/${sla.id}`, { config: { targetHours: -1 } })).status, 422);
  assert.equal((await accounts("GET", "/automation/rules")).status, 403);
  const routing = rules.find((x) => x.kind === "ROUTING");
  const dry = (await admin("POST", `/automation/rules/${routing.id}/dry-run`)).body;
  assert.equal(dry[0].role, "SALES");
  assert.ok(dry[0].pick.userId);
});

test("notifications and bank reconciliation (Phase 3)", async () => {
  const sales = await login("sales@solarcrm.local");
  const admin = await login("admin@solarcrm.local");
  const accounts = await login("accounts@solarcrm.local");
  const settle = () => new Promise((r) => setTimeout(r, 400));
  const users = (await sales("GET", "/users")).body;
  const idOf = (role) => users.find((u) => u.role === role).id;

  let r = await sales("POST", "/projects", { customerName: "E2E Notify", phone: "9800000006", email: "cust@example.com", address: "Delhi 110001", leadSource: "DIRECT" });
  const id = r.body.id;
  created.push(id);
  await settle();

  // FR-044: the stage owner is told when a stage is waiting on them
  let inbox = (await sales("GET", "/notifications")).body;
  assert.ok(inbox.items.some((n) => n.projectId === id && n.event === "STAGE_OPENED"));
  const unread = inbox.unread;
  assert.equal((await sales("POST", "/notifications/read-all")).status, 200);
  assert.equal((await sales("GET", "/notifications")).body.unread, 0);
  assert.ok(unread > 0);

  const adm = (stage, input = {}) => admin("POST", `/projects/${id}/stages/${stage}/complete`, { input });
  await adm("REQUIREMENT_CAPTURED", { requiredKw: 3, loanRequired: false, projectType: "Residential", packageName: "Standard" });
  await adm("SUPERVISOR_ASSIGNED", { supervisorId: idOf("SITE_SUPERVISOR") });
  await adm("VISIT_SCHEDULED", { scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
  await adm("VISIT_COMPLETED", { feasible: true, actualKw: 3 });
  await adm("SALES_FINALIZED", { finalCost: 120000, discountPct: 1, paymentTerms: "50/50" });
  await adm("CUSTOMER_CONFIRMED");
  const utr = `RECON${Date.now()}`;
  await adm("ADVANCE_LOGGED", { amount: 60000, mode: "NEFT", utr });

  // Booklet §6.4: queue shows NOT_FOUND until the statement is imported, then MATCHED
  let q = (await accounts("GET", "/payments/queue")).body.find((x) => x.utr === utr);
  assert.equal(q.bankMatch.result, "NOT_FOUND");
  const csv = `Txn Date,Narration,Chq/Ref No,Debit,Credit\n2026-09-20,NEFT CR ${utr},${utr},,"60,000.00"\n2026-09-20,ATM,,500,`;
  const fd = new FormData();
  fd.append("file", new Blob([csv]), "statement.csv");
  const salesUpload = await fetch(`${base}/payments/statements`, { method: "POST", body: fd });
  assert.equal(salesUpload.status, 401);
  r = await accounts.upload("/payments/statements", "unused", Buffer.from(csv), "statement.csv");
  assert.equal(r.status, 201);
  assert.equal(r.body.lines, 1);
  q = (await accounts("GET", "/payments/queue")).body.find((x) => x.utr === utr);
  assert.equal(q.bankMatch.result, "MATCHED");
  // Re-importing the same file adds nothing
  r = await accounts.upload("/payments/statements", "unused", Buffer.from(csv), "statement.csv");
  assert.equal(r.body.added, 0);

  // Approval notifies Sales in-app and queues customer WhatsApp + email; no provider → SKIPPED, never "sent"
  await accounts("POST", `/projects/${id}/stages/PAYMENT_VERIFIED/complete`, { input: { decision: "APPROVED" } });
  await settle();
  inbox = (await sales("GET", "/notifications")).body;
  assert.ok(inbox.items.some((n) => n.projectId === id && n.event === "PAYMENT_VERIFIED"));
  assert.equal((await admin("POST", "/notifications/deliver")).status, 200);
  const log = (await admin("GET", "/notifications/log")).body.filter((n) => n.projectId === id && n.event === "PAYMENT_VERIFIED");
  const toCustomer = log.filter((n) => n.address === "cust@example.com" || n.address === "9800000006");
  assert.deepEqual(toCustomer.map((n) => n.channel).sort(), ["EMAIL", "WHATSAPP"]);
  assert.ok(log.some((n) => n.address === "sales@solarcrm.local" && n.channel === "EMAIL")); // staff get email, never SMS
  assert.ok(log.every((n) => n.status === "SKIPPED"));

  // Matrix is editable by Admin only and validated
  assert.equal((await admin("PUT", "/notifications/rules/PAYMENT_VERIFIED", { recipients: ["NOBODY"], channels: ["IN_APP"], active: true })).status, 400);
  assert.equal((await sales("GET", "/notifications/rules")).status, 403);
});
