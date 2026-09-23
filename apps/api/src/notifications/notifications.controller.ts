import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Put } from "@nestjs/common";
import { CHANNELS, NOTIFICATION_EVENTS, RECIPIENTS } from "@solarcrm/shared";
import { z } from "zod";
import { AuditService } from "../common/audit.service";
import { CurrentUser, RequireModule, type AuthUser } from "../common/auth-context";
import { parse } from "../common/validation";
import { PrismaService } from "../prisma.service";
import { NotificationService } from "./notification.service";

const RuleBody = z.object({
  recipients: z.array(z.enum(RECIPIENTS)).min(1).max(RECIPIENTS.length),
  channels: z.array(z.enum(CHANNELS)).min(1).max(CHANNELS.length),
  active: z.boolean(),
});

/** FR-044: in-app inbox for everyone; matrix and delivery log for Admin. */
@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  /** Runs the outbox now (the worker runs every 30 s); useful after fixing a provider. */
  @Post("deliver")
  @HttpCode(200)
  @RequireModule("settings")
  async deliver() {
    await this.notifications.deliver();
    return { ok: true };
  }

  @Get()
  async inbox(@CurrentUser() user: AuthUser) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId: user.id, channel: "IN_APP" },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, event: true, title: true, body: true, projectId: true, readAt: true, createdAt: true },
      }),
      this.prisma.notification.count({ where: { userId: user.id, channel: "IN_APP", readAt: null } }),
    ]);
    return { unread, items };
  }

  @Post(":id/read")
  @HttpCode(200)
  async read(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const r = await this.prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    if (r.count === 0 && !(await this.prisma.notification.findFirst({ where: { id, userId: user.id } }))) throw new NotFoundException();
    return { ok: true };
  }

  @Post("read-all")
  @HttpCode(200)
  async readAll(@CurrentUser() user: AuthUser) {
    await this.prisma.notification.updateMany({ where: { userId: user.id, channel: "IN_APP", readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Get("rules")
  @RequireModule("settings")
  async rules() {
    const rows = await this.prisma.notificationRule.findMany();
    return Object.entries(NOTIFICATION_EVENTS).map(([event, label]) => ({ label, ...(rows.find((r) => r.event === event) ?? { event, recipients: [], channels: [], active: false }) }));
  }

  @Put("rules/:event")
  @RequireModule("settings")
  async setRule(@CurrentUser() user: AuthUser, @Param("event") event: string, @Body() body: unknown) {
    if (!(event in NOTIFICATION_EVENTS)) throw new NotFoundException("Unknown event.");
    const b = parse(RuleBody, body);
    const before = await this.prisma.notificationRule.findUnique({ where: { event } });
    await this.prisma.notificationRule.upsert({ where: { event }, create: { event, ...b }, update: b });
    await this.audit.record({ actorId: user.id, action: "notification.rule_changed", entity: "NotificationRule", entityId: event, meta: { from: before ? { recipients: before.recipients, channels: before.channels, active: before.active } : null, to: b } });
    return this.rules();
  }

  /** External deliveries (email, SMS, WhatsApp) with status, for support and audit (Booklet §7). */
  @Get("log")
  @RequireModule("settings")
  log() {
    return this.prisma.notification.findMany({
      where: { channel: { not: "IN_APP" } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, event: true, channel: true, address: true, status: true, attempts: true, error: true, createdAt: true, sentAt: true, projectId: true },
    });
  }
}
