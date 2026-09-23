import { Controller, Get } from "@nestjs/common";
import { STAGE_DEFS, availableStages, type Stage } from "@solarcrm/shared";
import { CurrentUser, RequireModule, type AuthUser } from "../common/auth-context";
import { PrismaService } from "../prisma.service";
import { ProjectsService, projectCode } from "../projects/projects.service";

const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfWeek = () => {
  const d = startOfDay();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d;
};
const startOfMonth = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1);

/**
 * Counts for the dashboard. Only figures the Phase 0 data model can answer are
 * returned; follow-ups, SLAs and money figures arrive with their modules.
 */
@Controller("dashboard")
@RequireModule("dashboard")
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  @Get("summary")
  async summary(@CurrentUser() user: AuthUser) {
    const scope = this.projects.scope(user);
    const [today, week, month, rows, installedMonth] = await Promise.all([
      this.prisma.project.count({ where: { ...scope, createdAt: { gte: startOfDay() } } }),
      this.prisma.project.count({ where: { ...scope, createdAt: { gte: startOfWeek() } } }),
      this.prisma.project.count({ where: { ...scope, createdAt: { gte: startOfMonth() } } }),
      this.prisma.project.findMany({ where: scope, select: { id: true, seq: true, createdAt: true, customerName: true, completedStages: true, skippedStages: true, loanRequired: true } }),
      this.prisma.stageEvent.count({
        where: { stage: "INSTALLATION_DONE", action: "COMPLETED", at: { gte: startOfMonth() }, project: scope },
      }),
    ]);

    const myActions: { projectId: string; code: string; customerName: string; stage: Stage; label: string }[] = [];
    let active = 0;
    let pendingVerification = 0;
    for (const p of rows) {
      const open = availableStages({ completed: p.completedStages as Stage[], skipped: p.skippedStages as Stage[], loanRequired: p.loanRequired });
      if (p.completedStages.includes("PROJECT_INITIATED") && open.length) active++;
      if (open.includes("PAYMENT_VERIFIED")) pendingVerification++;
      for (const s of open) {
        if (user.role === "ADMIN" || STAGE_DEFS[s].actors.includes(user.role)) {
          myActions.push({ projectId: p.id, code: projectCode(p), customerName: p.customerName, stage: s, label: STAGE_DEFS[s].label });
        }
      }
    }

    return {
      leads: { today, week, month },
      projects: { total: rows.length, active, installedThisMonth: installedMonth },
      pendingVerification,
      myActions: myActions.slice(0, 20),
      myActionsCount: myActions.length,
    };
  }
}
