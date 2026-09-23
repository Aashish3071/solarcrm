import { Injectable } from "@nestjs/common";
import { DEFAULT_INCENTIVE_RULES, type IncentiveRules } from "@solarcrm/shared";
import { PrismaService } from "../prisma.service";

/** Per-user overrides are stored as `<key>@<userId>` (FR-043). */
export const userKey = (key: string, userId: string) => `${key}@${userId}`;

/** Reads business rules stored as data (FR-043). */
@Injectable()
export class ConfigParamsService {
  constructor(private readonly prisma: PrismaService) {}

  async number(key: string, fallback: number, userId?: string): Promise<number> {
    const keys = userId ? [userKey(key, userId), key] : [key];
    const rows = await this.prisma.configParam.findMany({ where: { key: { in: keys } } });
    for (const k of keys) {
      const v = rows.find((r) => r.key === k)?.value;
      if (typeof v === "number") return v;
    }
    return fallback;
  }

  /** Incentive rules for a salesperson, honouring their overrides. */
  async incentiveRules(userId: string): Promise<IncentiveRules> {
    const d = DEFAULT_INCENTIVE_RULES;
    return {
      ceilingPct: await this.number("sales.discountCeilingPct", d.ceilingPct),
      fullIncentiveUpToPct: await this.number("incentive.fullIncentiveUpToPct", d.fullIncentiveUpToPct),
      fixedPct: await this.number("incentive.fixedPct", d.fixedPct, userId),
      marginSharePct: await this.number("incentive.marginSharePct", d.marginSharePct, userId),
      partnerCommissionPct: await this.number("partner.fullCommissionPct", d.partnerCommissionPct),
    };
  }
}
