import { Controller, ForbiddenException, Get, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Prisma } from "@prisma/client";
import { matchPayment, overdueAmount, parseStatement, type StatementLine } from "@solarcrm/shared";
import { AuditService } from "../common/audit.service";
import { RuleViolation } from "../common/validation";
import { CurrentUser, RequireModule, type AuthUser } from "../common/auth-context";
import { PrismaService } from "../prisma.service";
import { ProjectsService, projectCode } from "../projects/projects.service";

const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1);

@Controller("payments")
@RequireModule("payments")
export class PaymentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
  ) {}

  /** FR-010 / FR-037: payments logged by Sales, awaiting Accounts, oldest first. */
  @Get("queue")
  async queue(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.payment.findMany({
      where: { status: "LOGGED", project: this.projects.scope(user) },
      orderBy: { loggedAt: "asc" },
      include: { project: { select: { id: true, seq: true, createdAt: true, customerName: true } } },
      take: 200,
    });
    return Promise.all(
      rows.map(async (p) => ({
        id: p.id,
        projectId: p.project.id,
        projectCode: projectCode(p.project),
        customerName: p.project.customerName,
        kind: p.kind,
        amount: p.amount.toString(),
        mode: p.mode,
        utr: p.utr,
        loggedAt: p.loggedAt,
        bankMatch: await this.bankMatch(p.utr, Number(p.amount)),
      })),
    );
  }

  /** Booklet §6.4: suggestion only; Accounts still decides. */
  private async bankMatch(utr: string, amount: number) {
    const lines = await this.prisma.bankStatementLine.findMany({
      where: { OR: [{ reference: { equals: utr, mode: "insensitive" } }, { narration: { contains: utr, mode: "insensitive" } }] },
      take: 5,
    });
    const asLines: StatementLine[] = lines.map((l) => ({ txnDate: l.txnDate.toISOString().slice(0, 10), amount: Number(l.amount), reference: l.reference, narration: l.narration }));
    const m = matchPayment({ utr, amount }, asLines);
    return { result: m.result, statementAmount: m.line?.amount ?? null, txnDate: m.line?.txnDate ?? null };
  }

  /** Booklet §6.4: import a bank statement CSV; duplicates across imports are ignored. */
  @Post("statements")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async importStatement(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined) {
    if (user.role !== "ACCOUNTS" && user.role !== "ADMIN") throw new ForbiddenException("Only Accounts can import bank statements.");
    if (!file?.buffer?.length) throw new RuleViolation(["Choose a CSV file."]);
    const text = file.buffer.toString("utf8");
    if (text.includes("\u0000")) throw new RuleViolation(["The file is not a CSV text file."]);
    const { lines, errors } = parseStatement(text);
    if (!lines.length) throw new RuleViolation(errors.length ? errors : ["No credit entries found in the file."]);
    const imp = await this.prisma.bankStatementImport.create({
      data: { fileName: file.originalname.slice(-120), uploadedById: user.id, lineCount: lines.length },
    });
    const created = await this.prisma.bankStatementLine.createMany({
      data: lines.map((l) => ({ importId: imp.id, txnDate: new Date(l.txnDate), amount: l.amount, reference: l.reference, narration: l.narration })),
      skipDuplicates: true,
    });
    const pending = await this.prisma.payment.findMany({ where: { status: "LOGGED", project: this.projects.scope(user) } });
    const matched = (await Promise.all(pending.map((p) => this.bankMatch(p.utr, Number(p.amount))))).filter((m) => m.result === "MATCHED").length;
    await this.audit.record({ actorId: user.id, action: "bank_statement.imported", entity: "BankStatementImport", entityId: imp.id, meta: { lines: lines.length, added: created.count } });
    return { lines: lines.length, added: created.count, duplicates: lines.length - created.count, skippedRows: errors, pendingMatched: matched, pendingTotal: pending.length };
  }

  @Get("history")
  async history(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.payment.findMany({
      where: { status: { not: "LOGGED" }, project: this.projects.scope(user) },
      orderBy: { verifiedAt: "desc" },
      include: { project: { select: { id: true, seq: true, createdAt: true, customerName: true } } },
      take: 200,
    });
    return rows.map((p) => ({
      id: p.id,
      projectId: p.project.id,
      projectCode: projectCode(p.project),
      customerName: p.project.customerName,
      kind: p.kind,
      amount: p.amount.toString(),
      utr: p.utr,
      status: p.status,
      rejectionReason: p.rejectionReason,
      verifiedAt: p.verifiedAt,
    }));
  }

  /**
   * Outstanding = confirmed contract value minus verified receipts (FR-007, FR-036).
   * Overdue needs due dates from payment schedules, which arrive in Phase 2.
   */
  @Get("summary")
  async summary(@CurrentUser() user: AuthUser) {
    const scope = { project: this.projects.scope(user) };
    const [contracted, received, month, pending] = await Promise.all([
      this.prisma.salesTerms.aggregate({ _sum: { finalCost: true }, where: { confirmedAt: { not: null }, ...scope } }),
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { status: "APPROVED", ...scope } }),
      this.prisma.payment.aggregate({ _sum: { amount: true }, where: { status: "APPROVED", verifiedAt: { gte: monthStart() }, ...scope } }),
      this.prisma.payment.count({ where: { status: "LOGGED", ...scope } }),
    ]);
    const zero = new Prisma.Decimal(0);
    const outstanding = (contracted._sum.finalCost ?? zero).minus(received._sum.amount ?? zero);
    const overdue = await this.overdueByProject(user);
    return {
      totalOutstanding: outstanding.toString(),
      collectionsThisMonth: (month._sum.amount ?? zero).toString(),
      overdueReceivables: overdue.reduce((s, o) => s + o.overdue, 0).toFixed(2),
      overdueProjects: overdue.length,
      pendingVerification: pending,
    };
  }

  /** Per-project schedule with verified receipts and overdue (FR-036). */
  @Get("schedules")
  async schedules(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.project.findMany({
      where: { ...this.projects.scope(user), schedule: { some: {} } },
      include: {
        schedule: { orderBy: { position: "asc" } },
        payments: { where: { status: "APPROVED" }, select: { amount: true } },
        terms: { select: { finalCost: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((p) => {
      const verified = p.payments.reduce((s, x) => s + Number(x.amount), 0);
      const items = p.schedule.map((i) => ({ amount: Number(i.amount), dueDate: i.dueDate }));
      return {
        projectId: p.id,
        projectCode: projectCode(p),
        customerName: p.customerName,
        contractValue: p.terms?.finalCost.toString() ?? null,
        verified: verified.toFixed(2),
        overdue: overdueAmount(items, verified).toFixed(2),
        items: p.schedule.map((i) => ({ id: i.id, label: i.label, payer: i.payer, amount: i.amount.toString(), dueDate: i.dueDate })),
      };
    });
  }

  private async overdueByProject(user: AuthUser) {
    const rows = await this.prisma.project.findMany({
      where: { ...this.projects.scope(user), schedule: { some: { dueDate: { lte: new Date() } } } },
      include: { schedule: true, payments: { where: { status: "APPROVED" }, select: { amount: true } } },
    });
    return rows
      .map((p) => ({
        projectId: p.id,
        overdue: overdueAmount(
          p.schedule.map((i) => ({ amount: Number(i.amount), dueDate: i.dueDate })),
          p.payments.reduce((s, x) => s + Number(x.amount), 0),
        ),
      }))
      .filter((o) => o.overdue > 0);
  }
}
