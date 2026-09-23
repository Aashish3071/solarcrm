import { Controller, Get, Query } from "@nestjs/common";
import { isRole } from "@solarcrm/shared";
import { RequireModule } from "../common/auth-context";
import { PrismaService } from "../prisma.service";

/** Assignee pickers and partner selection. Returns names only, never contact details. */
@Controller()
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("users")
  @RequireModule("projects")
  users(@Query("role") role?: string) {
    return this.prisma.user.findMany({
      where: { active: true, ...(isRole(role) ? { role } : {}) },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    });
  }

  /** FR-002 masters (open point 2): project types and packages, editable as config. */
  @Get("masters")
  async masters() {
    const rows = await this.prisma.configParam.findMany({ where: { key: { startsWith: "masters." } } });
    return Object.fromEntries(rows.map((r) => [r.key.replace("masters.", ""), r.value]));
  }

  @Get("partners")
  @RequireModule("leads")
  partners() {
    return this.prisma.partner.findMany({ select: { id: true, name: true, type: true }, orderBy: { name: "asc" } });
  }
}
