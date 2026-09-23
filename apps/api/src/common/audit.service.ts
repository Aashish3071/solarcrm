import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(entry: { actorId?: string | null; action: string; entity: string; entityId?: string | null; meta?: Prisma.InputJsonValue }) {
    return this.prisma.auditLog.create({ data: { ...entry, actorId: entry.actorId ?? null } });
  }
}
