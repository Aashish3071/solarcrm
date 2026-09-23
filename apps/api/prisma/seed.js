// Development seed: one user per FRD role, two partners (FR-041) and config
// rules (FR-043). All users share a dev-only password; never run in production.
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();
const DEV_PASSWORD = process.env.SEED_PASSWORD || "Solar@123";

const USERS = [
  ["Aarav Sharma", "admin@solarcrm.local", "ADMIN"],
  ["Priya Nair", "sales@solarcrm.local", "SALES"],
  ["Amit Kulkarni", "supervisor@solarcrm.local", "SITE_SUPERVISOR"],
  ["Kavita Rao", "accounts@solarcrm.local", "ACCOUNTS"],
  ["Rohit Mehta", "office@solarcrm.local", "OFFICE_EXECUTIVE"],
  ["Anita Desai", "loan@solarcrm.local", "LOAN_OFFICER"],
  ["Vikram Singh", "discom@solarcrm.local", "DISCOM_OFFICER"],
  ["Sana Khan", "engineer@solarcrm.local", "PROJECT_ENGINEER"],
  ["Manoj Patil", "store@solarcrm.local", "STORE_MANAGER"],
];

const CONFIG = [
  ["sales.discountCeilingPct", 4, "FR-039: maximum discount Sales may give (%)"],
  ["incentive.fixedPct", 1, "FR-040: fixed in-house incentive at discount up to 3% (%)"],
  ["incentive.marginSharePct", 30, "FR-040: share of remaining margin at discount up to 3% (%)"],
  ["partner.fullCommissionPct", 5, "FR-042: Full Sales Partner commission (%) — example value from FRD"],
  ["incentive.fullIncentiveUpToPct", 3, "FR-040: discount up to which the full incentive formula applies (%)"],
  ["planning.defaultDurationDays", 12, "FR-026: days from start to expected end (placeholder, open point 7)"],
  // Open point 2: placeholder masters until the client supplies the real lists.
  ["masters.projectTypes", ["Residential", "Commercial"], "FR-002: project types (placeholder)"],
  ["masters.packages", ["Standard", "Premium"], "FR-002: packages (placeholder)"],
];

async function main() {
  const hash = await bcrypt.hash(DEV_PASSWORD, 10);

  const partners = {};
  for (const [name, type] of [["Sun & Co", "FULL"], ["BrightLeads", "LEAD_ONLY"]]) {
    const existing = await prisma.partner.findFirst({ where: { name } });
    partners[name] = existing ?? (await prisma.partner.create({ data: { name, type } }));
  }

  for (const [name, email, role] of USERS) {
    await prisma.user.upsert({ where: { email }, update: {}, create: { name, email, role, passwordHash: hash } });
  }
  await prisma.user.upsert({
    where: { email: "partner@solarcrm.local" },
    update: {},
    create: { name: "Sun & Co Desk", email: "partner@solarcrm.local", role: "SALES_PARTNER", passwordHash: hash, partnerId: partners["Sun & Co"].id },
  });

  for (const [key, value, description] of CONFIG) {
    await prisma.configParam.upsert({ where: { key }, update: {}, create: { key, value, description } });
  }

  // Automation defaults (open points 15–18): suggest-mode first, editable in the console.
  const RULES = [
    { name: "New lead routing", kind: "ROUTING", trigger: "LEAD_CREATED", mode: "SUGGEST", config: { strategy: "ROUND_ROBIN", role: "SALES", onlyPartnerLeads: false } },
    { name: "Suggest Site Supervisor", kind: "ASSIGNMENT", trigger: "SUPERVISOR_ASSIGNED", mode: "SUGGEST", config: { strategy: "LEAST_LOAD", role: "SITE_SUPERVISOR" } },
    { name: "Suggest Office Executive", kind: "ASSIGNMENT", trigger: "PROJECT_INITIATED", mode: "SUGGEST", config: { strategy: "LEAST_LOAD", role: "OFFICE_EXECUTIVE" } },
    { name: "Suggest project team", kind: "ASSIGNMENT", trigger: "GOV_REGISTERED", mode: "SUGGEST", config: { strategy: "LEAST_LOAD", roles: ["LOAN_OFFICER", "DISCOM_OFFICER", "PROJECT_ENGINEER"] } },
    { name: "New lead follow-up", kind: "FOLLOW_UP", trigger: "REQUIREMENT_CAPTURED", mode: "AUTO", config: { title: "Call the customer to capture the requirement", offsetsHours: [1, 24, 72] } },
    { name: "Chase customer confirmation", kind: "FOLLOW_UP", trigger: "CUSTOMER_CONFIRMED", mode: "AUTO", config: { title: "Follow up for customer confirmation", offsetsHours: [24, 72] } },
    { name: "Re-confirm loan terms", kind: "FOLLOW_UP", trigger: "LOAN_PROCESSED", mode: "AUTO", config: { title: "Check loan progress with the bank", offsetsHours: [72] } },
    { name: "Lead first touch", kind: "SLA", trigger: "REQUIREMENT_CAPTURED", mode: "AUTO", config: { targetHours: 24, warnPct: 80, escalateTo: "ADMIN" } },
    { name: "Visit scheduling", kind: "SLA", trigger: "VISIT_SCHEDULED", mode: "AUTO", config: { targetHours: 24, warnPct: 80, escalateTo: "ADMIN" } },
    { name: "Payment verification", kind: "SLA", trigger: "PAYMENT_VERIFIED", mode: "AUTO", config: { targetHours: 4, warnPct: 80, escalateTo: "ADMIN" } },
    { name: "Government registration", kind: "SLA", trigger: "GOV_REGISTERED", mode: "AUTO", config: { targetHours: 72, warnPct: 80, escalateTo: "ADMIN" } },
    { name: "DISCOM application", kind: "SLA", trigger: "DISCOM_APPLIED", mode: "AUTO", config: { targetHours: 72, warnPct: 80, escalateTo: "ADMIN" } },
    { name: "Material readiness", kind: "SLA", trigger: "MATERIAL_READY", mode: "AUTO", config: { targetHours: 72, warnPct: 80, escalateTo: "PROJECT_ENGINEER" } },
    { name: "Dispatch to site", kind: "SLA", trigger: "RECEIVED_AT_SITE", mode: "AUTO", config: { targetHours: 48, warnPct: 80, escalateTo: "PROJECT_ENGINEER" } },
  ];
  for (const r of RULES) {
    const existing = await prisma.automationRule.findFirst({ where: { name: r.name } });
    if (!existing) await prisma.automationRule.create({ data: r });
  }

  console.log(`Seeded ${RULES.length} automation rules.`);

  const { DEFAULT_MATRIX } = require("@solarcrm/shared");
  for (const m of DEFAULT_MATRIX) {
    await prisma.notificationRule.upsert({ where: { event: m.event }, update: {}, create: m });
  }
  console.log(`Seeded ${DEFAULT_MATRIX.length} notification rules.`);
  console.log(`Seeded ${USERS.length + 1} users (password: ${DEV_PASSWORD}), 2 partners, ${CONFIG.length} config rules.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
