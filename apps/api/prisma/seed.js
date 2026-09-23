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

  console.log(`Seeded ${USERS.length + 1} users (password: ${DEV_PASSWORD}), 2 partners, ${CONFIG.length} config rules.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
