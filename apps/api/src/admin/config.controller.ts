import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Put } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AuditService } from "../common/audit.service";
import { CurrentUser, RequireModule, type AuthUser } from "../common/auth-context";
import { userKey } from "../common/config-params.service";
import { parse, RuleViolation } from "../common/validation";
import { PrismaService } from "../prisma.service";

/** Keys that may be overridden per user (FR-043: incentive % per user). */
const PER_USER = new Set(["incentive.fixedPct", "incentive.marginSharePct"]);
/** Sanity bounds for percentage rules; masters are string lists. */
const BOUNDS: Record<string, [number, number]> = {
  "sales.discountCeilingPct": [0, 100],
  "incentive.fixedPct": [0, 100],
  "incentive.marginSharePct": [0, 100],
  "incentive.fullIncentiveUpToPct": [0, 100],
  "partner.fullCommissionPct": [0, 100],
  "planning.defaultDurationDays": [1, 365],
};

const Body_ = z.object({ value: z.union([z.number(), z.array(z.string().trim().min(1).max(60)).min(1).max(50)]), userId: z.string().optional() });

/** FR-043: business rules and masters edited as data; every change audited with old and new value. */
@Controller("config")
@RequireModule("settings")
export class ConfigController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const rows = await this.prisma.configParam.findMany({ orderBy: { key: "asc" } });
    const base = rows.filter((r) => !r.key.includes("@"));
    const overrides = rows
      .filter((r) => r.key.includes("@"))
      .map((r) => {
        const [key, userId] = r.key.split("@");
        return { key, userId, value: r.value, updatedAt: r.updatedAt };
      });
    return { params: base, overrides, perUserKeys: [...PER_USER] };
  }

  @Put(":key")
  @HttpCode(200)
  async set(@CurrentUser() user: AuthUser, @Param("key") key: string, @Body() body: unknown) {
    const b = parse(Body_, body);
    const existing = await this.prisma.configParam.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException("Unknown setting.");
    if (typeof b.value !== typeof existing.value && !(Array.isArray(b.value) && Array.isArray(existing.value))) {
      throw new RuleViolation(["The value type does not match this setting."]);
    }
    if (typeof b.value === "number") {
      const [min, max] = BOUNDS[key] ?? [0, 1_000_000];
      if (!(b.value >= min && b.value <= max)) throw new RuleViolation([`Value must be between ${min} and ${max}.`]);
    }
    let target = key;
    if (b.userId) {
      if (!PER_USER.has(key)) throw new RuleViolation(["This setting cannot be overridden per user."]);
      const u = await this.prisma.user.findUnique({ where: { id: b.userId } });
      if (!u) throw new RuleViolation(["User not found."]);
      target = userKey(key, b.userId);
    }
    const before = await this.prisma.configParam.findUnique({ where: { key: target } });
    await this.prisma.configParam.upsert({
      where: { key: target },
      create: { key: target, value: b.value as Prisma.InputJsonValue, description: existing.description, updatedById: user.id },
      update: { value: b.value as Prisma.InputJsonValue, updatedById: user.id },
    });
    await this.audit.record({
      actorId: user.id, action: "config.changed", entity: "ConfigParam", entityId: target,
      meta: { from: (before?.value ?? null) as Prisma.InputJsonValue, to: b.value as Prisma.InputJsonValue },
    });
    return this.list();
  }

  @Delete(":key/users/:userId")
  @HttpCode(200)
  async clearOverride(@CurrentUser() user: AuthUser, @Param("key") key: string, @Param("userId") userId: string) {
    const target = userKey(key, userId);
    await this.prisma.configParam.deleteMany({ where: { key: target } });
    await this.audit.record({ actorId: user.id, action: "config.override_removed", entity: "ConfigParam", entityId: target });
    return this.list();
  }
}
