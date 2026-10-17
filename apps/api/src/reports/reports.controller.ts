import { Controller, Get, Header, Query } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { STAGE_DEFS, currentStage, type Stage } from "@solarcrm/shared";
import { AuditService } from "../common/audit.service";
import { CurrentUser, RequireModule, type AuthUser } from "../common/auth-context";
import { PrismaService } from "../prisma.service";
import { ProjectsService, projectCode } from "../projects/projects.service";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formula injection and quote as needed.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * Booklet §11 KPIs over projects created in the period. Every figure is
 * derived from recorded events and dates; nothing is estimated.
 */
@Controller("reports")
@RequireModule("reports")
export class ReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
  ) {}

  private where(user: AuthUser, from?: string, to?: string): Prisma.ProjectWhereInput {
    const range: Prisma.DateTimeFilter = {};
    if (from && !Number.isNaN(Date.parse(from))) range.gte = new Date(from);
    if (to && !Number.isNaN(Date.parse(to))) range.lt = new Date(new Date(to).getTime() + DAY);
    return { ...this.projects.scope(user), ...(Object.keys(range).length ? { createdAt: range } : {}) };
  }

  @Get("kpis")
  async kpis(@CurrentUser() user: AuthUser, @Query("from") from?: string, @Query("to") to?: string) {
    const rows = await this.prisma.project.findMany({
      where: this.where(user, from, to),
      include: {
        siteVisit: true, terms: true, payments: true, loan: true, discom: true, plan: true, incentive: true,
        events: { where: { action: "COMPLETED" }, select: { stage: true, at: true } },
        assignments: { where: { role: "SITE_SUPERVISOR" }, select: { assignedAt: true } },
      },
    });
    const at = (p: (typeof rows)[number], s: Stage) => p.events.find((e) => e.stage === s)?.at.getTime();
    const bySource = (src: string) => {
      const list = rows.filter((p) => p.leadSource === src);
      const won = list.filter((p) => p.completedStages.includes("PAYMENT_VERIFIED")).length;
      return { leads: list.length, converted: won, conversionPct: list.length ? Math.round((won / list.length) * 1000) / 10 : null };
    };

    const payments = rows.flatMap((p) => p.payments);
    const discomStatus: Record<string, number> = {};
    rows.forEach((p) => p.discom && (discomStatus[p.discom.status] = (discomStatus[p.discom.status] ?? 0) + 1));
    const now = Date.now();

    return {
      period: { from: from ?? null, to: to ?? null, projects: rows.length },
      leads: {
        direct: bySource("DIRECT"),
        partner: bySource("SALES_PARTNER"),
        byStage: Object.entries(
          rows.reduce<Record<string, number>>((m, p) => {
            const c = currentStage({ completed: p.completedStages as Stage[], skipped: p.skippedStages as Stage[], loanRequired: p.loanRequired });
            const label = c ? `${STAGE_DEFS[c].number}. ${STAGE_DEFS[c].label}` : "Closed";
            m[label] = (m[label] ?? 0) + 1;
            return m;
          }, {}),
        ).map(([stage, count]) => ({ stage, count })),
      },
      siteVisit: {
        // Assignment → visit completed, and scheduled vs actual completion.
        avgAssignmentToVisitHours: avg(rows.filter((p) => p.siteVisit?.completedAt && p.supervisorAssignedAt).map((p) => (p.siteVisit!.completedAt!.getTime() - p.supervisorAssignedAt!.getTime()) / HOUR)),
        avgScheduledVsActualHours: avg(rows.filter((p) => p.siteVisit?.completedAt && p.siteVisit.scheduledAt).map((p) => (p.siteVisit!.completedAt!.getTime() - p.siteVisit!.scheduledAt!.getTime()) / HOUR)),
        lateSchedulingWithReason: rows.filter((p) => p.siteVisit?.lateReason).length,
      },
      schedule: {
        avgStartDelayDays: avg(rows.filter((p) => p.plan?.actualStart && p.plan.plannedStart).map((p) => (p.plan!.actualStart!.getTime() - p.plan!.plannedStart!.getTime()) / DAY)),
        avgEndDelayDays: avg(rows.filter((p) => p.plan?.actualEnd && p.plan.expectedEnd).map((p) => (p.plan!.actualEnd!.getTime() - p.plan!.expectedEnd!.getTime()) / DAY)),
        rescheduledProjects: rows.filter((p) => (p.plan?.rescheduleCount ?? 0) > 0).length,
      },
      payments: {
        pendingVerification: payments.filter((x) => x.status === "LOGGED").length,
        oldestPendingHours: payments.some((x) => x.status === "LOGGED")
          ? Math.round(Math.max(...payments.filter((x) => x.status === "LOGGED").map((x) => (now - x.loggedAt.getTime()) / HOUR)) * 10) / 10
          : null,
        avgLoggedToVerifiedHours: avg(payments.filter((x) => x.verifiedAt).map((x) => (x.verifiedAt!.getTime() - x.loggedAt.getTime()) / HOUR)),
        rejected: payments.filter((x) => x.status === "REJECTED").length,
        verifiedTotal: payments.filter((x) => x.status === "APPROVED").reduce((s, x) => s + Number(x.amount), 0),
      },
      loan: {
        projectsWithLoan: rows.filter((p) => p.loanRequired).length,
        bankContribution: rows.reduce((s, p) => s + (p.loan?.status === "APPROVED" && p.loan.approvedAmount ? Number(p.loan.approvedAmount) : 0), 0),
        customerContribution: rows.reduce((s, p) => s + (p.terms && p.loan?.status === "APPROVED" && p.loan.approvedAmount ? Number(p.terms.finalCost) - Number(p.loan.approvedAmount) : 0), 0),
        avgApprovalDays: avg(rows.map((p) => [at(p, "PROJECT_INITIATED"), at(p, "LOAN_PROCESSED")]).filter(([a, b]) => a && b).map(([a, b]) => (b! - a!) / DAY)),
      },
      discom: {
        byStatus: Object.entries(discomStatus).map(([status, count]) => ({ status, count })),
        avgApprovalDays: avg(rows.map((p) => [at(p, "DISCOM_APPLIED"), at(p, "FINAL_DISCOM_APPROVED")]).filter(([a, b]) => a && b).map(([a, b]) => (b! - a!) / DAY)),
      },
      material: {
        avgDispatchToSiteHours: avg(rows.filter((p) => p.plan?.dispatchedAt && p.plan.receivedAt).map((p) => (p.plan!.receivedAt!.getTime() - p.plan!.dispatchedAt!.getTime()) / HOUR)),
        delayed: rows
          .filter((p) => p.plan?.readyRemark || p.plan?.receivedRemark)
          .map((p) => ({ code: projectCode(p), customer: p.customerName, reasons: [p.plan!.readyRemark, p.plan!.receivedRemark].filter(Boolean) })),
      },
      incentive: {
        totalIncentive: rows.reduce((s, p) => s + Number(p.incentive?.incentiveAmount ?? 0), 0),
        totalPartnerCommission: rows.reduce((s, p) => s + Number(p.incentive?.partnerCommissionAmount ?? 0), 0),
        avgDiscountPct: avg(rows.filter((p) => p.terms).map((p) => Number(p.terms!.discountPct))),
      },
    };
  }

  /** Project register as CSV. Contact details are left out of exports by default (Booklet §10 data minimisation). */
  @Get("projects.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="solarcrm-projects.csv"')
  async csv(@CurrentUser() user: AuthUser, @Query("from") from?: string, @Query("to") to?: string) {
    const rows = await this.prisma.project.findMany({
      where: this.where(user, from, to),
      orderBy: { seq: "asc" },
      include: { owner: { select: { name: true } }, partner: { select: { name: true } }, terms: true, plan: true, discom: true, loan: true, incentive: true },
    });
    const head = ["Project", "Customer", "Created", "Source", "Partner", "Owner", "kW", "Current stage", "Final cost", "Discount %", "Loan status", "DISCOM status", "Planned start", "Expected end", "Actual end", "Incentive", "Partner commission"];
    const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : "");
    const lines = rows.map((p) => {
      const c = currentStage({ completed: p.completedStages as Stage[], skipped: p.skippedStages as Stage[], loanRequired: p.loanRequired });
      return [
        projectCode(p), p.customerName, d(p.createdAt), p.leadSource === "DIRECT" ? "Direct" : "Sales Partner", p.partner?.name ?? "", p.owner.name,
        p.requiredKw?.toString() ?? "", c ? `${STAGE_DEFS[c].number}. ${STAGE_DEFS[c].label}` : "Closed",
        p.terms?.finalCost.toString() ?? "", p.terms?.discountPct.toString() ?? "", p.loan?.status ?? "", p.discom?.status ?? "",
        d(p.plan?.plannedStart), d(p.plan?.expectedEnd), d(p.plan?.actualEnd),
        p.incentive?.incentiveAmount.toString() ?? "", p.incentive?.partnerCommissionAmount.toString() ?? "",
      ].map(csvCell).join(",");
    });
    await this.audit.record({ actorId: user.id, action: "report.exported", entity: "Report", entityId: "projects.csv", meta: { rows: rows.length, from: from ?? null, to: to ?? null } });
    return "﻿" + [head.join(","), ...lines].join("\r\n");
  }
}
