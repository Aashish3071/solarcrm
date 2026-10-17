import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { DEFAULT_ACCESS, ROLE_LABELS } from "@solarcrm/shared";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { z } from "zod";
import { AuditService } from "../common/audit.service";
import { CurrentUser, Public, type AuthUser } from "../common/auth-context";
import { parse } from "../common/validation";
import { PrismaService } from "../prisma.service";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, cookieSecure } from "./auth.constants";
import { LoginThrottle } from "./login-throttle";

const LoginBody = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });
// Compared when the email is unknown so response time doesn't reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync("solarcrm-timing-equaliser", 10);

@Controller("auth")
export class AuthController {
  private readonly throttle = new LoginThrottle();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const parsed = parse(LoginBody, body);
    const email = parsed.email.toLowerCase();
    const ip = req.ip ?? "unknown";
    const wait = this.throttle.blockedFor(email, ip);
    if (wait) {
      await this.audit.record({ action: "auth.login_throttled", entity: "User", meta: { email, ip } });
      res.setHeader("Retry-After", String(wait));
      throw new HttpException(`Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`, HttpStatus.TOO_MANY_REQUESTS);
    }
    const user = await this.prisma.user.findUnique({ where: { email } });
    const match = await bcrypt.compare(parsed.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.active || !match) {
      this.throttle.fail(email, ip);
      await this.audit.record({ action: "auth.login_failed", entity: "User", meta: { email, ip } });
      throw new UnauthorizedException("Email or password is incorrect.");
    }
    this.throttle.succeed(email);
    const token = await this.jwt.signAsync({ sub: user.id, v: user.sessionVersion }, { expiresIn: SESSION_TTL_SECONDS });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure(),
      maxAge: SESSION_TTL_SECONDS * 1000,
      path: "/",
    });
    await this.audit.record({ actorId: user.id, action: "auth.login", entity: "User", entityId: user.id });
    return { ok: true };
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    // Bumping the version invalidates every token issued so far, on every device.
    await this.prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
    res.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, sameSite: "lax", secure: cookieSecure() });
    await this.audit.record({ actorId: user.id, action: "auth.logout", entity: "User", entityId: user.id });
    return { ok: true };
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return { ...user, roleLabel: ROLE_LABELS[user.role], modules: DEFAULT_ACCESS[user.role] };
  }
}
