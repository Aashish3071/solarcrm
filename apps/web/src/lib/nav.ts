import type { Module } from "@solarcrm/shared";
import {
  Banknote,
  FileSignature,
  FolderKanban,
  Gauge,
  HardHat,
  IndianRupee,
  Landmark,
  LayoutGrid,
  ListChecks,
  MapPin,
  Package,
  Percent,
  Play,
  Settings,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  module: Module;
  /** Where the requirement comes from and which phase builds it (shown on placeholder pages). */
  source: string;
  phase: string;
}

export const WORK_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid, module: "dashboard", source: "Booklet §11", phase: "Phase 0" },
  { href: "/work", label: "My Work", icon: ListChecks, module: "myWork", source: "Addendum FR-A03, A04", phase: "Phase 2b" },
  { href: "/leads", label: "Leads", icon: Users, module: "leads", source: "FR-001 – FR-003 · stages 1–2", phase: "Phase 1A" },
  { href: "/site-visits", label: "Site Visits", icon: MapPin, module: "siteVisits", source: "FR-004 – FR-006 · stages 3–5", phase: "Phase 1" },
  { href: "/finalize", label: "Finalize & Advance", icon: FileSignature, module: "finalize", source: "FR-007 – FR-009, FR-039 · stages 6–8", phase: "Phase 1" },
  { href: "/projects", label: "Projects", icon: FolderKanban, module: "projects", source: "FRD §5 · FR-030", phase: "Phase 0" },
  { href: "/initiation", label: "Project Initiation", icon: Play, module: "initiation", source: "FR-011, FR-014, FR-015 · stage 10", phase: "Phase 1" },
  { href: "/planning", label: "Planning & Material", icon: Package, module: "planning", source: "FR-025 – FR-030 · stages 15–18", phase: "Phase 1" },
  { href: "/installation", label: "Installation & Completion", icon: HardHat, module: "installation", source: "FR-031 – FR-035 · stages 19–20", phase: "Phase 1" },
  { href: "/gov", label: "Government Registration", icon: Landmark, module: "gov", source: "FR-012 · stage 11", phase: "Phase 1" },
  { href: "/loan", label: "Loan Processing", icon: Banknote, module: "loan", source: "FR-013, FR-016 – FR-020 · stage 12", phase: "Phase 1" },
  { href: "/discom", label: "DISCOM", icon: Gauge, module: "discom", source: "FR-021, FR-022, FR-034 · stages 13, 21", phase: "Phase 1" },
  { href: "/payments", label: "Payments", icon: IndianRupee, module: "payments", source: "FR-009, FR-010, FR-036 – FR-038", phase: "Phase 1–2" },
  { href: "/incentives", label: "Incentives", icon: Percent, module: "incentives", source: "FR-039 – FR-043 · stage 23", phase: "Phase 2" },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/automation", label: "Automation", icon: Zap, module: "automation", source: "Addendum FR-A01 – A05", phase: "Phase 2b" },
  { href: "/settings", label: "Settings & Data", icon: Settings, module: "settings", source: "FR-043 · open points 2, 12, 13", phase: "Phase 2" },
];

export const ALL_NAV = [...WORK_NAV, ...ADMIN_NAV];
