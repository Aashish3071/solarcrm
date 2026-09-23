import Anthropic from "@anthropic-ai/sdk";
import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ROLE_LABELS } from "@solarcrm/shared";
import type { AuthUser } from "../common/auth-context";
import { ConfigParamsService } from "../common/config-params.service";
import { PrismaService } from "../prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { TOOLS, runTool, type ToolContext } from "./advisor.tools";

const MODEL = process.env.ADVISOR_MODEL ?? "claude-opus-5";
const MAX_ROUNDS = 6;
const MAX_TRANSCRIPT_MESSAGES = 60;

// Stable across requests so it can be cached; per-user facts go in a second block after it.
const SYSTEM = `You are the AI Advisor inside SolarCRM, a CRM/ERP for a solar installation company in India. You help staff understand and move their work forward across a 23-stage project lifecycle (lead, requirement, site visit, sales finalization, customer confirmation, advance payment and verification, initiation, government registration, loan, DISCOM, design, planning, material, installation, completion, final DISCOM approval, payment collection, incentive).

How to work:
- Answer only from what your tools return. If the tools don't show something, say you can't see it; the user's role may not have access. Never guess customer details, amounts, dates or statuses.
- Use search_projects to find leads and projects, get_project for one project's details, list_at_risk for delays, my_work for the user's tasks.
- For any incentive or commission figure call incentive_preview. Never do that arithmetic yourself.
- You cannot change anything directly. To suggest a follow-up or a customer message, call propose_follow_up or propose_customer_message; the user confirms it in the panel. Say so plainly after proposing.
- Refer to projects by code and customer name. Use Indian rupee formatting (₹1,50,000).
- Keep answers short and scannable: a one-line answer first, then at most a few bullet points. No preamble.
- Customer messages must be polite, plain and free of internal notes, other customers' information or staff incentives.`;

export interface AdvisorReply {
  conversationId: string;
  reply: string;
  actions: { id: string; kind: string; payload: unknown }[];
  toolsUsed: string[];
}

/**
 * Addendum FR-AI01 – AI06. Manual tool loop so every tool call runs with the
 * caller's identity and scope. Read-only by design; writes are proposals.
 */
@Injectable()
export class AdvisorService {
  private client: Anthropic | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly config: ConfigParamsService,
  ) {}

  configured() {
    return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  }

  private anthropic() {
    if (!this.configured()) {
      throw new HttpException({ message: "The AI Advisor is not configured on this server." }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    this.client ??= new Anthropic({ baseURL: process.env.ADVISOR_BASE_URL || undefined, maxRetries: 2, timeout: 90_000 });
    return this.client;
  }

  async enabledFor(user: AuthUser) {
    const row = await this.prisma.configParam.findUnique({ where: { key: "ai.enabledRoles" } });
    const roles = Array.isArray(row?.value) ? (row.value as string[]) : ["ADMIN"];
    return roles.includes(user.role);
  }

  async ask(user: AuthUser, question: string, conversationId?: string, projectCode?: string): Promise<AdvisorReply> {
    if (!(await this.enabledFor(user))) throw new HttpException({ message: "The AI Advisor is not enabled for your role." }, HttpStatus.FORBIDDEN);
    const limit = await this.config.number("ai.requestsPerHour", 30);
    const recent = await this.prisma.aiUsageLog.count({ where: { userId: user.id, at: { gte: new Date(Date.now() - 3600_000) } } });
    if (recent >= limit) throw new HttpException({ message: `You have reached ${limit} advisor questions this hour. Try again later.` }, HttpStatus.TOO_MANY_REQUESTS);
    const client = this.anthropic();

    const convo = conversationId
      ? await this.prisma.aiConversation.findFirst({ where: { id: conversationId, userId: user.id } })
      : null;
    let messages = (convo?.messages as unknown as Anthropic.Beta.BetaMessageParam[] | undefined) ?? [];
    if (messages.length > MAX_TRANSCRIPT_MESSAGES) messages = []; // start fresh rather than grow unbounded
    const convoId = convo?.id ?? (await this.prisma.aiConversation.create({ data: { userId: user.id, messages: [] } })).id;

    const baseLength = messages.length;
    const focus = projectCode ? `\n(The user is looking at project ${projectCode}.)` : "";
    messages.push({ role: "user", content: question.slice(0, 2000) + focus });

    const ctx: ToolContext = { user, conversationId: convoId, prisma: this.prisma, projects: this.projects, config: this.config, proposed: [] };
    const toolsUsed: string[] = [];
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let reply = "";
    let outcome = "ANSWERED";

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const response = await client.beta.messages.create({
          model: MODEL,
          max_tokens: 16000,
          // Refused requests are re-run on Anthropic's recommended fallback model server-side.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          cache_control: { type: "ephemeral" },
          system: [
            { type: "text", text: SYSTEM },
            { type: "text", text: `User: ${user.name}, role ${ROLE_LABELS[user.role]}. Today is ${new Date().toISOString().slice(0, 10)}.` },
          ],
          tools: TOOLS,
          messages,
        });
        usage.input += response.usage.input_tokens;
        usage.output += response.usage.output_tokens;
        usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
        usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;

        if (response.stop_reason === "refusal") {
          outcome = "REFUSED";
          reply = "I can't help with that request.";
          messages = messages.slice(0, baseLength); // drop the whole refused exchange
          break;
        }
        messages.push({ role: "assistant", content: response.content });

        if (response.stop_reason === "pause_turn") continue;
        const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        if (response.stop_reason !== "tool_use" || calls.length === 0) {
          reply = response.content
            .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
            .map((b) => b.text)
            .join("\n")
            .trim();
          if (response.stop_reason === "max_tokens") outcome = "TRUNCATED";
          break;
        }

        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const call of calls) {
          toolsUsed.push(call.name);
          const r = await runTool(call.name, call.input, ctx);
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: JSON.stringify(r.ok ? r.data : { error: r.error }),
            is_error: !r.ok,
          });
        }
        messages.push({ role: "user", content: results });
        if (round === MAX_ROUNDS - 1) {
          outcome = "ROUND_LIMIT";
          reply = "I needed more steps than allowed for this question. Try asking something narrower.";
        }
      }
    } catch (e) {
      outcome = "ERROR";
      await this.log(user.id, usage, toolsUsed.length, outcome);
      if (e instanceof Anthropic.RateLimitError) throw new HttpException({ message: "The AI service is busy. Try again in a minute." }, HttpStatus.TOO_MANY_REQUESTS);
      if (e instanceof Anthropic.AuthenticationError) throw new HttpException({ message: "The AI Advisor is not configured correctly." }, HttpStatus.SERVICE_UNAVAILABLE);
      if (e instanceof Anthropic.APIConnectionError || (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500)) {
        throw new HttpException({ message: "The AI service is unavailable right now." }, HttpStatus.BAD_GATEWAY);
      }
      if (e instanceof Anthropic.APIError) throw new HttpException({ message: "The AI request was rejected." }, HttpStatus.BAD_GATEWAY);
      throw e;
    }

    await this.prisma.aiConversation.update({ where: { id: convoId }, data: { messages: messages as unknown as Prisma.InputJsonValue } });
    await this.log(user.id, usage, toolsUsed.length, outcome);
    return { conversationId: convoId, reply: reply || "I don't have an answer for that.", actions: ctx.proposed, toolsUsed };
  }

  private log(userId: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number }, toolCalls: number, outcome: string) {
    return this.prisma.aiUsageLog.create({
      data: { userId, model: MODEL, inputTokens: u.input, outputTokens: u.output, cacheReadTokens: u.cacheRead, cacheWriteTokens: u.cacheWrite, toolCalls, outcome },
    });
  }
}
