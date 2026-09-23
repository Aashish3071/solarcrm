import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

/** Reads business rules stored as data (FR-043). */
@Injectable()
export class ConfigParamsService {
  constructor(private readonly prisma: PrismaService) {}

  async number(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.configParam.findUnique({ where: { key } });
    return typeof row?.value === "number" ? row.value : fallback;
  }
}
