import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Project, Role as DbRole } from "@prisma/client";
import {
  STAGE_DEFS,
  availableStages,
  messageFor,
  responsibleRole,
  type Channel,
  type NotificationEvent,
  type Recipient,
  type Stage,
} from "@solarcrm/shared";
import { EventBus } from "../automation/event-bus";
import { PrismaService } from "../prisma.service";
import { projectCode } from "../projects/projects.service";

const MAX_ATTEMPTS = 3;
const TICK_MS = Number(process.env.NOTIFY_TICK_MS ?? 30_000);

/** Completed stage → notification event (Booklet §9). */
const ON_COMPLETE: Partial<Record<Stage, NotificationEvent>> = {
  VISIT_SCHEDULED: "VISIT_SCHEDULED",
  PAYMENT_VERIFIED: "PAYMENT_VERIFIED",
  DISPATCHED: "MATERIAL_DISPATCHED",
  RECEIVED_AT_SITE: "MATERIAL_RECEIVED",
  COMPLETED: "INSTALLATION_COMPLETED",
  FINAL_DISCOM_APPROVED: "FINAL_DISCOM_APPROVED",
};

const ROLE_TOKEN: Partial<Record<Recipient, DbRole>> = {
  SITE_SUPERVISOR: "SITE_SUPERVISOR",
  OFFICE_EXECUTIVE: "OFFICE_EXECUTIVE",
  PROJECT_ENGINEER: "PROJECT_ENGINEER",
  LOAN_OFFICER: "LOAN_OFFICER",
  DISCOM_OFFICER: "DISCOM_OFFICER",
};

interface Target {
  key: string;
  userId?: string;
  email?: string;
  phone?: string;
  customer: boolean;
}

/**
 * FR-044: alerts at every stage. One service for all channels (Booklet §6.5):
 * business code emits events, this decides who hears what on which channel.
 * External channels go through an outbox and are posted to the integration
 * layer webhook (Booklet §7); with no provider configured they are SKIPPED.
 */
@Injectable()
export class NotificationService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
  ) {}

  onModuleInit() {
    this.bus.on("stages.changed", async ({ projectId, openBefore, completedBefore }) => {
      const p = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (!p) return;
      const done = (p.completedStages as Stage[]).filter((s) => !completedBefore.includes(s));
      for (const s of done) {
        const ev = ON_COMPLETE[s];
        if (ev) await this.notify(ev, p, { stage: s, detail: await this.detail(p, s) });
      }
      const open = availableStages({ completed: p.completedStages as Stage[], skipped: p.skippedStages as Stage[], loanRequired: p.loanRequired });
      for (const s of open.filter((x) => !openBefore.includes(x))) {
        await this.notify("STAGE_OPENED", p, { stage: s, detail: `${STAGE_DEFS[s].number}. ${STAGE_DEFS[s].label} is waiting on you.` });
      }
    });
    this.bus.on("payment.decided", async ({ projectId, approved, reason, paymentId }) => {
      const p = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (p) await this.notify(approved ? "PAYMENT_VERIFIED" : "PAYMENT_REJECTED", p, { key: paymentId, detail: reason });
    });
    this.bus.on("track.updated", async ({ projectId, kind, status }) => {
      const p = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (!p) return;
      if (kind === "LOAN" && status === "APPROVED") await this.notify("LOAN_UPDATED", p, { key: `${kind}:${status}:${Date.now()}` });
      if (kind === "DISCOM") await this.notify("DISCOM_UPDATED", p, { key: `${kind}:${status}:${Date.now()}`, detail: `Status: ${status.replace(/_/g, " ").toLowerCase()}.` });
    });
    this.bus.on("sla.breached", async ({ projectId, stage }) => {
      const p = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (p) await this.notify("PROJECT_DELAYED", p, { stage, detail: `${STAGE_DEFS[stage]?.label ?? stage} is past its SLA.` });
    });
    if (process.env.NOTIFY_TICK !== "off") {
      this.timer = setInterval(() => this.deliver().catch((e) => console.error("[notify] delivery failed", e)), TICK_MS);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async detail(p: Project, stage: Stage) {
    if (stage === "VISIT_SCHEDULED") {
      const v = await this.prisma.siteVisit.findUnique({ where: { projectId: p.id } });
      return v?.scheduledAt ? `Visit on ${v.scheduledAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.` : undefined;
    }
    return undefined;
  }

  /** Resolves recipient tokens to concrete people or the customer. */
  private async targets(p: Project, tokens: string[], stage?: Stage): Promise<Target[]> {
    const out: Target[] = [];
    const addUser = (u: { id: string; email: string } | null | undefined) => u && out.push({ key: `u:${u.id}`, userId: u.id, email: u.email, customer: false });
    for (const t of tokens as Recipient[]) {
      if (t === "CUSTOMER") out.push({ key: "customer", phone: p.phone, email: p.email ?? undefined, customer: true });
      else if (t === "SALES_OWNER") addUser(await this.prisma.user.findUnique({ where: { id: p.ownerId } }));
      else if (t === "ACCOUNTS") (await this.prisma.user.findMany({ where: { role: "ACCOUNTS", active: true } })).forEach(addUser);
      else if (t === "RESPONSIBLE" && stage) {
        const role = responsibleRole(stage);
        if (!role) continue;
        if (role === "SALES") addUser(await this.prisma.user.findUnique({ where: { id: p.ownerId } }));
        else {
          const a = await this.prisma.projectAssignment.findUnique({ where: { projectId_role: { projectId: p.id, role: role as DbRole } }, include: { user: true } });
          if (a) addUser(a.user);
          else (await this.prisma.user.findMany({ where: { role: role as DbRole, active: true } })).forEach(addUser);
        }
      } else if (ROLE_TOKEN[t]) {
        const a = await this.prisma.projectAssignment.findUnique({ where: { projectId_role: { projectId: p.id, role: ROLE_TOKEN[t]! } }, include: { user: true } });
        addUser(a?.user);
      }
    }
    const seen = new Set<string>();
    return out.filter((x) => !seen.has(x.key) && seen.add(x.key));
  }

  async notify(event: NotificationEvent, p: Project, opts: { stage?: Stage; detail?: string; key?: string }) {
    const rule = await this.prisma.notificationRule.findUnique({ where: { event } });
    if (!rule?.active) return;
    const targets = await this.targets(p, rule.recipients, opts.stage);
    const ctx = { customer: p.customerName, code: projectCode(p), detail: opts.detail };
    const bucket = opts.key ?? `${opts.stage ?? ""}:${p.completedStages.length}`;

    for (const t of targets) {
      const msg = messageFor(event, ctx, t.customer);
      for (const channel of rule.channels as Channel[]) {
        // No customer app login yet; staff have no phone numbers on record.
        if (channel === "IN_APP" && !t.userId) continue;
        if ((channel === "SMS" || channel === "WHATSAPP") && !t.customer) continue;
        const address = channel === "EMAIL" ? t.email : channel === "IN_APP" ? undefined : t.phone;
        if (channel !== "IN_APP" && !address) continue;
        await this.prisma.notification.upsert({
          where: { dedupeKey: `${event}:${p.id}:${t.key}:${channel}:${bucket}` },
          update: {},
          create: {
            event, channel, projectId: p.id, userId: t.userId ?? null, address: address ?? null,
            title: msg.title, body: msg.body,
            status: channel === "IN_APP" ? "SENT" : "QUEUED",
            sentAt: channel === "IN_APP" ? new Date() : null,
            dedupeKey: `${event}:${p.id}:${t.key}:${channel}:${bucket}`,
          },
        });
      }
    }
  }

  /** Outbox worker for external channels, with retries (Booklet §7: no silent loss). */
  async deliver() {
    const url = process.env.NOTIFY_WEBHOOK_URL;
    const queued = await this.prisma.notification.findMany({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, take: 50 });
    for (const n of queued) {
      if (!url) {
        await this.prisma.notification.update({ where: { id: n.id }, data: { status: "SKIPPED", error: "No delivery provider configured (open point 14)." } });
        continue;
      }
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...(process.env.NOTIFY_WEBHOOK_SECRET ? { "x-solarcrm-secret": process.env.NOTIFY_WEBHOOK_SECRET } : {}) },
          // Booklet §8.3 shape: project, stage/event, channel, recipient, template.
          body: JSON.stringify({ project_id: n.projectId, event: n.event, channel: n.channel.toLowerCase(), recipient: n.address, template_id: `${n.event}_01`, title: n.title, body: n.body }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await this.prisma.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } } });
      } catch (e) {
        const attempts = n.attempts + 1;
        await this.prisma.notification.update({
          where: { id: n.id },
          data: { attempts, status: attempts >= MAX_ATTEMPTS ? "FAILED" : "QUEUED", error: String((e as Error).message).slice(0, 300) },
        });
      }
    }
  }
}
