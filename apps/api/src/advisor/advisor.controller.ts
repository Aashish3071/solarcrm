import { Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AuditService } from "../common/audit.service";
import { CurrentUser, type AuthUser } from "../common/auth-context";
import { parse, RuleViolation } from "../common/validation";
import { PrismaService } from "../prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { AdvisorService } from "./advisor.service";

const AskBody = z.object({
  question: z.string().trim().min(1, "Ask a question").max(2000),
  conversationId: z.string().optional(),
  projectCode: z.string().max(40).optional(),
});

/** Addendum FR-AI01 – AI06: ask, and confirm or reject what the advisor proposes. */
@Controller("advisor")
export class AdvisorController {
  constructor(
    private readonly advisor: AdvisorService,
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
  ) {}

  @Get("status")
  async status(@CurrentUser() user: AuthUser) {
    return { enabled: await this.advisor.enabledFor(user), configured: this.advisor.configured() };
  }

  @Post("ask")
  @HttpCode(200)
  ask(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const b = parse(AskBody, body);
    return this.advisor.ask(user, b.question, b.conversationId, b.projectCode);
  }

  private async pending(user: AuthUser, id: string) {
    const a = await this.prisma.aiProposedAction.findFirst({ where: { id, userId: user.id } });
    if (!a) throw new NotFoundException("Proposal not found.");
    if (a.status !== "PROPOSED") throw new RuleViolation(["This proposal was already handled."]);
    // Scope is re-checked at confirm time: access may have changed since the proposal.
    const p = await this.prisma.project.findFirst({ where: { id: a.projectId, ...this.projects.scope(user) } });
    if (!p) throw new NotFoundException("Project not found.");
    return { a, p };
  }

  /** Runs the proposal through the normal path. Only now does anything change. */
  @Post("actions/:id/confirm")
  @HttpCode(200)
  async confirm(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const { a, p } = await this.pending(user, id);
    const edited = z.object({ text: z.string().trim().min(1).max(1000).optional() }).parse(body ?? {});
    const payload = a.payload as { title?: string; due_in_hours?: number; channel?: string; text?: string };

    if (a.kind === "FOLLOW_UP") {
      await this.prisma.task.create({
        data: {
          projectId: p.id, kind: "FOLLOW_UP", title: String(payload.title).slice(0, 140), ownerId: user.id, ownerRole: user.role,
          dueAt: new Date(Date.now() + Number(payload.due_in_hours) * 3600_000), dedupeKey: `ai:${a.id}`,
        },
      });
    } else if (a.kind === "CUSTOMER_MESSAGE") {
      if (user.role !== "SALES" && user.role !== "ADMIN") throw new ForbiddenException("Only Sales and Admin can message customers.");
      const channel = payload.channel === "EMAIL" ? "EMAIL" : payload.channel === "SMS" ? "SMS" : "WHATSAPP";
      const address = channel === "EMAIL" ? p.email : p.phone;
      if (!address) throw new RuleViolation(["This customer has no email address on record."]);
      await this.prisma.notification.create({
        data: {
          event: "ADVISOR_MESSAGE", channel, projectId: p.id, address, title: `Message to ${p.customerName}`,
          body: (edited.text ?? String(payload.text)).slice(0, 1000), status: "QUEUED", dedupeKey: `ai:${a.id}`,
        },
      });
    }
    await this.prisma.aiProposedAction.update({ where: { id }, data: { status: "CONFIRMED", decidedAt: new Date() } });
    await this.audit.record({ actorId: user.id, action: "advisor.action_confirmed", entity: "Project", entityId: p.id, meta: { kind: a.kind, proposalId: id, edited: !!edited.text } as Prisma.InputJsonValue });
    return { ok: true };
  }

  @Post("actions/:id/reject")
  @HttpCode(200)
  async reject(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.pending(user, id);
    await this.prisma.aiProposedAction.update({ where: { id }, data: { status: "REJECTED", decidedAt: new Date() } });
    return { ok: true };
  }
}
