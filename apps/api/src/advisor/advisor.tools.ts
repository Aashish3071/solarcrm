import type Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import {
  STAGE_DEFS,
  availableStages,
  calculateIncentive,
  currentStage,
  pincodeOf,
  slaState,
  type Stage,
} from "@solarcrm/shared";
import { z } from "zod";
import type { AuthUser } from "../common/auth-context";
import type { ConfigParamsService } from "../common/config-params.service";
import type { PrismaService } from "../prisma.service";
import { projectCode, type ProjectsService } from "../projects/projects.service";

/**
 * Read-only tools over RBAC-scoped data (FR-AI01 – AI06). Every query goes
 * through ProjectsService.scope(user), so the advisor can never see more than
 * the person asking. Contact details, UTRs and street addresses are never
 * returned to the model; only the PIN code is.
 */
export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "search_projects",
    description:
      "Find leads/projects the user can see. Filter by free text (customer name or project code), by current stage number (1–23), by 'waiting on me', or by minimum days since the last activity. Returns up to 25 rows.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Customer name or project code fragment" },
        stage_number: { type: "integer", minimum: 1, maximum: 23 },
        waiting_on_me: { type: "boolean", description: "Only projects with a stage the user's role can complete now" },
        idle_days_min: { type: "integer", minimum: 1, description: "Only projects with no stage activity for at least this many days" },
        limit: { type: "integer", minimum: 1, maximum: 25 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_project",
    description:
      "Full summary of one project by its code (e.g. SLR-2026-00012): stages done and open, team, site assessment, terms, payments, loan, DISCOM, plan and material dates, SLA clocks and recent timeline. Finance fields appear only if the user's role may see them.",
    input_schema: {
      type: "object",
      properties: { project_code: { type: "string" } },
      required: ["project_code"],
      additionalProperties: false,
    },
  },
  {
    name: "list_at_risk",
    description:
      "Projects at risk of delay: SLA clocks breached or in warning, projects idle for 7+ days, rescheduled starts, and delayed material. Use for 'what's at risk' or 'what's stuck' questions.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "my_work",
    description: "The user's open tasks and follow-ups with due times, overdue first.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "incentive_preview",
    description:
      "Calculate the sales incentive and partner commission for an order value and discount using the configured rules. Always use this for incentive numbers; never compute them yourself. Sales and Admin only.",
    input_schema: {
      type: "object",
      properties: {
        order_value: { type: "number", exclusiveMinimum: 0 },
        discount_pct: { type: "number", minimum: 0 },
        partner_type: { type: "string", enum: ["NONE", "LEAD_ONLY", "FULL"] },
      },
      required: ["order_value", "discount_pct"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_follow_up",
    description:
      "Propose a follow-up task for the user on a project. Nothing is created until the user confirms it in the panel.",
    input_schema: {
      type: "object",
      properties: {
        project_code: { type: "string" },
        title: { type: "string", maxLength: 140 },
        due_in_hours: { type: "number", minimum: 1, maximum: 720 },
      },
      required: ["project_code", "title", "due_in_hours"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_customer_message",
    description:
      "Propose a message to the project's customer (WhatsApp, SMS or email). The user reviews and confirms before it is queued for sending. Sales and Admin only. Write in plain, polite language; never include internal notes, other customers' data or staff incentives.",
    input_schema: {
      type: "object",
      properties: {
        project_code: { type: "string" },
        channel: { type: "string", enum: ["WHATSAPP", "SMS", "EMAIL"] },
        text: { type: "string", maxLength: 1000 },
      },
      required: ["project_code", "channel", "text"],
      additionalProperties: false,
    },
  },
];

const Inputs = {
  search_projects: z.object({
    query: z.string().max(100).optional(),
    stage_number: z.number().int().min(1).max(23).optional(),
    waiting_on_me: z.boolean().optional(),
    idle_days_min: z.number().int().min(1).max(3650).optional(),
    limit: z.number().int().min(1).max(25).optional(),
  }),
  get_project: z.object({ project_code: z.string().max(40) }),
  list_at_risk: z.object({}),
  my_work: z.object({}),
  incentive_preview: z.object({
    order_value: z.number().positive(),
    discount_pct: z.number().min(0),
    partner_type: z.enum(["NONE", "LEAD_ONLY", "FULL"]).optional(),
  }),
  propose_follow_up: z.object({ project_code: z.string().max(40), title: z.string().min(1).max(140), due_in_hours: z.number().min(1).max(720) }),
  propose_customer_message: z.object({ project_code: z.string().max(40), channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]), text: z.string().min(1).max(1000) }),
};

const FINANCE_ROLES = new Set(["ADMIN", "SALES", "ACCOUNTS"]);
const DAY = 86_400_000;

export interface ToolContext {
  user: AuthUser;
  conversationId: string;
  prisma: PrismaService;
  projects: ProjectsService;
  config: ConfigParamsService;
  proposed: { id: string; kind: string; payload: unknown }[];
}

const seqOf = (code: string) => {
  const m = code.trim().toUpperCase().match(/^SLR-\d{4}-(\d{1,7})$/);
  return m ? Number(m[1]) : null;
};

async function findByCode(ctx: ToolContext, code: string) {
  const seq = seqOf(code);
  if (seq === null) return null;
  return ctx.prisma.project.findFirst({ where: { seq, ...ctx.projects.scope(ctx.user) } });
}

async function lastActivity(ctx: ToolContext, ids: string[]) {
  const rows = await ctx.prisma.stageEvent.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _max: { at: true } });
  return new Map(rows.map((r) => [r.projectId, r._max.at]));
}

type Result = { ok: true; data: unknown } | { ok: false; error: string };

/** Runs one tool call. Invalid input or out-of-scope access returns an error result, never throws. */
export async function runTool(name: string, raw: unknown, ctx: ToolContext): Promise<Result> {
  const schema = Inputs[name as keyof typeof Inputs];
  if (!schema) return { ok: false, error: `Unknown tool ${name}.` };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: `Invalid input: ${parsed.error.issues.map((i) => i.message).join("; ")}` };
  const input = parsed.data as never;
  const role = ctx.user.role;

  switch (name) {
    case "search_projects": {
      const i = input as z.infer<typeof Inputs.search_projects>;
      const where: Prisma.ProjectWhereInput = { ...ctx.projects.scope(ctx.user) };
      if (i.query) {
        const seq = seqOf(i.query);
        where.OR = [{ customerName: { contains: i.query, mode: "insensitive" } }, ...(seq !== null ? [{ seq }] : [])];
      }
      const rows = await ctx.prisma.project.findMany({ where, orderBy: { updatedAt: "desc" }, take: 300, include: { owner: { select: { name: true } } } });
      const last = await lastActivity(ctx, rows.map((r) => r.id));
      const now = Date.now();
      const out = rows
        .map((p) => {
          const state = { completed: p.completedStages as Stage[], skipped: p.skippedStages as Stage[], loanRequired: p.loanRequired };
          const cur = currentStage(state);
          const open = availableStages(state);
          const idleDays = Math.floor((now - (last.get(p.id)?.getTime() ?? p.createdAt.getTime())) / DAY);
          return {
            code: projectCode(p),
            customer: p.customerName,
            kw: p.requiredKw?.toString() ?? null,
            source: p.leadSource === "DIRECT" ? "Direct" : "Sales Partner",
            owner: p.owner.name,
            current_stage: cur ? `${STAGE_DEFS[cur].number}. ${STAGE_DEFS[cur].label}` : "Closed",
            stage_number: cur ? STAGE_DEFS[cur].number : 24,
            open_stages: open.map((s) => STAGE_DEFS[s].label),
            waiting_on_me: open.some((s) => role === "ADMIN" || STAGE_DEFS[s].actors.includes(role)),
            idle_days: idleDays,
            pin_code: pincodeOf(p.address),
          };
        })
        .filter((r) => !i.stage_number || r.stage_number === i.stage_number)
        .filter((r) => !i.waiting_on_me || r.waiting_on_me)
        .filter((r) => !i.idle_days_min || r.idle_days >= i.idle_days_min)
        .slice(0, i.limit ?? 25);
      return { ok: true, data: { count: out.length, projects: out } };
    }

    case "get_project": {
      const i = input as z.infer<typeof Inputs.get_project>;
      const found = await findByCode(ctx, i.project_code);
      if (!found) return { ok: false, error: "No project with that code is visible to this user." };
      const p = await ctx.prisma.project.findUniqueOrThrow({
        where: { id: found.id },
        include: {
          owner: { select: { name: true } },
          partner: { select: { name: true, type: true } },
          assignments: { include: { user: { select: { name: true } } } },
          siteVisit: true,
          terms: true,
          payments: true,
          loan: true,
          discom: true,
          gov: true,
          plan: true,
          install: true,
          slaTimers: { where: { resolvedAt: null } },
          events: { orderBy: { at: "desc" }, take: 10 },
          documents: { select: { type: true } },
        },
      });
      const state = { completed: p.completedStages as Stage[], skipped: p.skippedStages as Stage[], loanRequired: p.loanRequired };
      const finance = FINANCE_ROLES.has(role);
      const seesLoan = finance || role === "LOAN_OFFICER" || role === "OFFICE_EXECUTIVE";
      const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : null);
      return {
        ok: true,
        data: {
          code: projectCode(p),
          customer: p.customerName,
          pin_code: pincodeOf(p.address),
          source: p.leadSource === "DIRECT" ? "Direct" : `Sales Partner (${p.partner?.name})`,
          requirement: { kw: p.requiredKw?.toString() ?? null, type: p.projectType, package: p.packageName, loan_required: p.loanRequired },
          stages_completed: state.completed.map((s) => `${STAGE_DEFS[s].number}. ${STAGE_DEFS[s].label}`),
          stages_open: availableStages(state).map((s) => `${STAGE_DEFS[s].number}. ${STAGE_DEFS[s].label} (by ${STAGE_DEFS[s].actors.join("/") || "system"})`),
          team: { sales_owner: p.owner.name, ...Object.fromEntries(p.assignments.map((a) => [a.role.toLowerCase(), a.user.name])) },
          site_visit: p.siteVisit && {
            scheduled: d(p.siteVisit.scheduledAt), completed: d(p.siteVisit.completedAt), feasible: p.siteVisit.feasible,
            feasible_kw: p.siteVisit.actualKw?.toString() ?? null, deviations: p.siteVisit.deviations, late_reason: p.siteVisit.lateReason,
          },
          terms: finance && p.terms ? { final_cost: p.terms.finalCost.toString(), discount_pct: p.terms.discountPct.toString(), payment_terms: p.terms.paymentTerms, customer_confirmed: !!p.terms.confirmedAt } : undefined,
          payments: finance
            ? {
                verified_total: p.payments.filter((x) => x.status === "APPROVED").reduce((s, x) => s + Number(x.amount), 0),
                awaiting_accounts: p.payments.filter((x) => x.status === "LOGGED").length,
                rejected: p.payments.filter((x) => x.status === "REJECTED").length,
              }
            : undefined,
          loan: seesLoan && p.loan ? { bank: p.loan.bank, status: p.loan.status, requested: p.loan.requestedAmount.toString(), approved: p.loan.approvedAmount?.toString() ?? null, client_reconfirmed: !!p.loan.clientReconfirmedAt } : undefined,
          gov_registration: p.gov?.status ?? null,
          discom: p.discom ? { status: p.discom.status, meter_assigned: !!p.discom.meterNumber } : null,
          plan: p.plan && {
            planned_start: d(p.plan.plannedStart), expected_end: d(p.plan.expectedEnd), actual_start: d(p.plan.actualStart), actual_end: d(p.plan.actualEnd),
            reschedules: p.plan.rescheduleCount, reschedule_reason: p.plan.delayReason,
            material: p.plan.receivedAt ? "received" : p.plan.dispatchedAt ? "dispatched" : p.plan.materialReadyAt ? "ready" : "not ready",
            material_delay_remarks: [p.plan.readyRemark, p.plan.receivedRemark].filter(Boolean),
          },
          training_done: !!p.install?.trainingCompletedAt,
          documents: [...new Set(p.documents.map((x) => x.type))],
          sla: p.slaTimers.map((t) => {
            const s = slaState(t, new Date());
            return { stage: STAGE_DEFS[t.stage as Stage]?.label ?? t.stage, state: s.state, due: s.dueAt.toISOString() };
          }),
          recent_activity: p.events.map((e) => ({ at: e.at.toISOString().slice(0, 16), what: `${e.action === "REOPENED" ? "Reopened " : ""}${STAGE_DEFS[e.stage as Stage]?.label ?? e.stage}`, by: e.actorRole })),
        },
      };
    }

    case "list_at_risk": {
      const scope = ctx.projects.scope(ctx.user);
      const now = new Date();
      const timers = await ctx.prisma.slaTimer.findMany({ where: { resolvedAt: null, project: scope }, include: { project: true } });
      const sla = timers
        .map((t) => ({ t, s: slaState(t, now) }))
        .filter(({ s }) => s.state === "BREACHED" || s.state === "WARN")
        .map(({ t, s }) => ({ code: projectCode(t.project), customer: t.project.customerName, stage: STAGE_DEFS[t.stage as Stage]?.label ?? t.stage, sla: s.state, due: s.dueAt.toISOString() }));
      const open = await ctx.prisma.project.findMany({ where: { ...scope, NOT: { completedStages: { has: "INCENTIVE_CALCULATED" } } }, include: { plan: true } });
      const last = await lastActivity(ctx, open.map((p) => p.id));
      const idle = open
        .map((p) => ({ p, days: Math.floor((now.getTime() - (last.get(p.id)?.getTime() ?? p.createdAt.getTime())) / DAY) }))
        .filter((x) => x.days >= 7)
        .map(({ p, days }) => ({ code: projectCode(p), customer: p.customerName, idle_days: days }));
      const planIssues = open
        .filter((p) => p.plan && (p.plan.rescheduleCount > 0 || p.plan.readyRemark || p.plan.receivedRemark))
        .map((p) => ({ code: projectCode(p), customer: p.customerName, reschedules: p.plan!.rescheduleCount, material_remarks: [p.plan!.readyRemark, p.plan!.receivedRemark].filter(Boolean) }));
      return { ok: true, data: { sla, idle_7_days_plus: idle.slice(0, 25), schedule_or_material_issues: planIssues.slice(0, 25) } };
    }

    case "my_work": {
      const tasks = await ctx.prisma.task.findMany({
        where: { status: "OPEN", OR: [{ ownerId: ctx.user.id }, { ownerId: null, ownerRole: role }], project: ctx.projects.scope(ctx.user) },
        orderBy: { dueAt: "asc" },
        take: 30,
        include: { project: true },
      });
      const now = Date.now();
      return { ok: true, data: tasks.map((t) => ({ title: t.title, kind: t.kind, code: projectCode(t.project), customer: t.project.customerName, due: t.dueAt.toISOString(), overdue: t.dueAt.getTime() < now })) };
    }

    case "incentive_preview": {
      if (role !== "SALES" && role !== "ADMIN") return { ok: false, error: "Only Sales and Admin can preview incentives." };
      const i = input as z.infer<typeof Inputs.incentive_preview>;
      const rules = await ctx.config.incentiveRules(ctx.user.id);
      if (i.discount_pct > rules.ceilingPct) return { ok: false, error: `Discount cannot exceed ${rules.ceilingPct}% (FR-039).` };
      const r = calculateIncentive({ orderValue: i.order_value, discountPct: i.discount_pct, partnerType: i.partner_type && i.partner_type !== "NONE" ? i.partner_type : null, rules });
      return { ok: true, data: { ...r, note: "Provisional until the client confirms the 3–4% formula and partner rules (open points 10, 11)." } };
    }

    case "propose_follow_up":
    case "propose_customer_message": {
      if (name === "propose_customer_message" && role !== "SALES" && role !== "ADMIN") {
        return { ok: false, error: "Only Sales and Admin can message customers." };
      }
      const i = input as { project_code: string };
      const p = await findByCode(ctx, i.project_code);
      if (!p) return { ok: false, error: "No project with that code is visible to this user." };
      const kind = name === "propose_follow_up" ? "FOLLOW_UP" : "CUSTOMER_MESSAGE";
      const payload = { ...(input as object), project_code: projectCode(p), customer: p.customerName };
      const a = await ctx.prisma.aiProposedAction.create({
        data: { conversationId: ctx.conversationId, userId: ctx.user.id, projectId: p.id, kind, payload: payload as Prisma.InputJsonValue },
      });
      ctx.proposed.push({ id: a.id, kind, payload });
      return { ok: true, data: { proposed: true, note: "Shown to the user for confirmation. Nothing has been created or sent yet." } };
    }
  }
  return { ok: false, error: "Unhandled tool." };
}
