import { Controller, Get } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { CurrentUser, RequireModule, type AuthUser } from "../common/auth-context";
import { PrismaService } from "../prisma.service";
import { projectCode } from "../projects/projects.service";

/**
 * FR-039 – FR-043 results. Sales staff see their own incentive, partners see
 * only their own commission, Admin sees everything.
 */
@Controller("incentives")
@RequireModule("incentives")
export class IncentivesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const where: Prisma.IncentiveResultWhereInput =
      user.role === "ADMIN" ? {} : user.role === "SALES_PARTNER" ? { partnerId: user.partnerId ?? "__none__" } : { salesUserId: user.id };
    const rows = await this.prisma.incentiveResult.findMany({
      where,
      orderBy: { calculatedAt: "desc" },
      include: { project: { select: { id: true, seq: true, createdAt: true, customerName: true, owner: { select: { name: true } }, partner: { select: { name: true } } } } },
    });
    const partnerView = user.role === "SALES_PARTNER";
    return rows.map((r) => ({
      projectId: r.projectId,
      projectCode: projectCode(r.project),
      customerName: r.project.customerName,
      salesName: partnerView ? null : r.project.owner.name,
      partnerName: r.project.partner?.name ?? null,
      orderValue: r.orderValue.toString(),
      discountPct: r.discountPct.toString(),
      incentivePct: partnerView ? null : r.incentivePct.toString(),
      incentiveAmount: partnerView ? null : r.incentiveAmount.toString(),
      partnerCommissionPct: r.partnerCommissionPct.toString(),
      partnerCommissionAmount: r.partnerCommissionAmount.toString(),
      provisional: r.provisional,
      calculatedAt: r.calculatedAt,
    }));
  }
}
