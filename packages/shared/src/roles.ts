// Roles from FRD §3, plus ADMIN implied by FR-043 (configurable percentages).
export const ROLES = [
  "SALES",
  "SALES_PARTNER",
  "SITE_SUPERVISOR",
  "ACCOUNTS",
  "OFFICE_EXECUTIVE",
  "LOAN_OFFICER",
  "DISCOM_OFFICER",
  "PROJECT_ENGINEER",
  "STORE_MANAGER",
  "CUSTOMER",
  "ADMIN",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SALES: "Sales Team",
  SALES_PARTNER: "Sales Partner",
  SITE_SUPERVISOR: "Site Supervisor",
  ACCOUNTS: "Accounts Team",
  OFFICE_EXECUTIVE: "Office Executive",
  LOAN_OFFICER: "Loan Officer",
  DISCOM_OFFICER: "DISCOM Officer",
  PROJECT_ENGINEER: "Project Engineer",
  STORE_MANAGER: "Store Manager",
  CUSTOMER: "Customer",
  ADMIN: "Administrator",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
