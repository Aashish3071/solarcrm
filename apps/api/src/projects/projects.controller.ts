import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { STAGES, type Stage } from "@solarcrm/shared";
import { z } from "zod";
import { CurrentUser, RequireModule, type AuthUser } from "../common/auth-context";
import { parse, RuleViolation } from "../common/validation";
import { ProjectsService } from "./projects.service";

// FR-001 lead fields. Requirement fields (FR-002) are captured at stage 2.
// Which customer fields are mandatory is open point 1; default: name, phone, address.
const CreateLead = z.object({
  customerName: z.string().trim().min(1, "Customer name is required").max(120),
  phone: z.string().trim().regex(/^[0-9+\- ]{7,16}$/, "Enter a valid phone number"),
  email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  address: z.string().trim().min(1, "Installation address is required").max(500),
  leadSource: z.enum(["DIRECT", "SALES_PARTNER"]),
  partnerId: z.string().optional(),
});

const StageBody = z.object({ input: z.record(z.string(), z.unknown()).default({}) });
const RejectBody = z.object({ reason: z.string().trim().min(1, "A reason is required") });
const AssignBody = z.object({
  role: z.enum(["SITE_SUPERVISOR", "LOAN_OFFICER", "DISCOM_OFFICER", "PROJECT_ENGINEER"]),
  userId: z.string().min(1),
});

@Controller("projects")
@RequireModule("projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequireModule("projects", "leads")
  list(@CurrentUser() user: AuthUser) {
    return this.projects.list(user);
  }

  @Get(":id")
  @RequireModule("projects", "leads")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.projects.get(user, id);
  }

  @Post()
  @RequireModule("leads")
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.projects.createLead(user, parse(CreateLead, body));
  }

  @Post(":id/stages/:stage/complete")
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("stage") stage: string, @Body() body: unknown) {
    if (!(STAGES as readonly string[]).includes(stage)) throw new RuleViolation(["Unknown stage."]);
    return this.projects.completeStage(user, id, stage as Stage, parse(StageBody, body ?? {}).input);
  }

  @Post(":id/payment-rejection")
  @HttpCode(200)
  reject(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.rejectPayment(user, id, parse(RejectBody, body).reason);
  }

  @Post(":id/assignments")
  @HttpCode(200)
  assign(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const { role, userId } = parse(AssignBody, body);
    return this.projects.assign(user, id, role, userId);
  }
}
