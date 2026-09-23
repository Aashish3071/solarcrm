import type { Role } from "./roles";

// Module-level access. The FRD leaves the permission matrix open (open point 13);
// this default is derived from the "Typical System Access" column of Booklet §3
// and is meant to be reviewed with the client.
export const MODULES = [
  "dashboard",
  "myWork",
  "leads",
  "siteVisits",
  "finalize",
  "projects",
  "initiation",
  "planning",
  "installation",
  "gov",
  "loan",
  "discom",
  "payments",
  "incentives",
  "automation",
  "settings",
] as const;

export type Module = (typeof MODULES)[number];

const ALL = [...MODULES];

export const DEFAULT_ACCESS: Record<Role, readonly Module[]> = {
  ADMIN: ALL,
  SALES: ["dashboard", "myWork", "leads", "siteVisits", "finalize", "projects", "initiation", "payments", "incentives"],
  SALES_PARTNER: ["dashboard", "leads", "incentives"],
  SITE_SUPERVISOR: ["dashboard", "myWork", "siteVisits", "projects", "planning", "installation"],
  ACCOUNTS: ["dashboard", "myWork", "projects", "payments"],
  OFFICE_EXECUTIVE: ["dashboard", "myWork", "projects", "initiation", "gov", "loan", "installation"],
  LOAN_OFFICER: ["dashboard", "myWork", "projects", "loan"],
  DISCOM_OFFICER: ["dashboard", "myWork", "projects", "discom"],
  PROJECT_ENGINEER: ["dashboard", "myWork", "projects", "initiation", "planning", "installation"],
  STORE_MANAGER: ["dashboard", "myWork", "projects", "planning"],
  CUSTOMER: [],
};

export function canAccess(role: Role, module: Module): boolean {
  return DEFAULT_ACCESS[role].includes(module);
}
