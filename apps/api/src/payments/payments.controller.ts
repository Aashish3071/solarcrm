import { Controller, Get } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CurrentUser, RequireModule, type AuthUser } from "../common/auth-context";
import { PrismaService } from "../prisma.service";
import { ProjectsService, projectCode } from "../projects/projects.service";

const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1);

@Controller("payments")
@RequireModule("payments")
export class PaymentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  /** FR-010 / FR-037: payments logged by Sales, awaiting Accounts, oldest first. */
  @Get("queue")
  async queue(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.payment.findMany({
      where: { status: "LOGGED", project: this.projects.scope(user) },
      orderBy: { loggedAt: "asc" },
      include: { project: { select: { id: true, seq: true, createdAt: true, customerName: true } } },
      take: 200,
    });
    return rows.map((p) => ({
      id: p.id,
      projectId: p.project.id,
      projectCode: projectCode(p.project),
      customerName: p.project.customerName,
      kind: p.kind,
      amount: p.amount.toString(),
      mode: p.mode,
      utr: p.utr,
      loggedAt: p.loggedAt,
    }));
  }

  @Get("history")
  async history(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.payment.findMany({
      where: { status: { not: "LOGGED" }, project: this.projects.scope(user) },
      orderBy: { verifiedAt: "desc" },
      include: { project: { select: { id: true, seq: true, createdAt: true, customerName: true } } },
      take: 200,
    });
    return rows.map((p) => ({
      id: p.id,
      projectId: p.project.id,
      projectCode: projectCode(p.project),
      customerName: p.project.customerName,
      kind: p.kind,
      amount: p.amount.toString(),
      utr: p.utr,
      status: p.status,
      rejectionReason: p.rejectionReason,
      verifiedAt: p.verifiedAt,
    }));
  }

  /**
   * Outstanding = confirmed contract value minus verified receipts (FR-007, FR-036).
   * Overdue needs due dates from payment schedules, which arrive in Phase 2.
   */
  @Get("summary")
  async summary(@CurrentUser() user: AuthUser) {
    const scope = { project: this.projects.scope(user) };
    const [contracted, received, month, pending] = await Promise.all([
      this.prisma.salesTerms.aggregate({ _sum: { finalCost: true }, where: { confirmedAt: { not: null }, ...scope } }),
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { status: "APPROVED", ...scope } }),
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { status: "APPROVED", verifiedAt: { gte: monthStart() }, ...scope } }),
      this.prisma.payment.count({ where: { status: "LOGGED", ...scope } }),
    ]);
    const zero = new Prisma.Decimal(0);
    const outstanding = (contracted._sum.finalCost ?? zero).minus(received._sum.amount ?? zero);
    return {
      totalOutstanding: outstanding.toString(),
      collectionsThisMonth: (month._sum.amount ?? zero).toString(),
      pendingVerification: pending,
    };
  }
}
