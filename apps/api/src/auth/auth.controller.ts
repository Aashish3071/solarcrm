import { Body, Controller, Get, HttpCode, Post, Res, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { DEFAULT_ACCESS, ROLE_LABELS } from "@solarcrm/shared";
import bcrypt from "bcryptjs";
import type { Response } from "express";
import { z } from "zod";
import { AuditService } from "../common/audit.service";
import { CurrentUser, Public, type AuthUser } from "../common/auth-context";
import { parse } from "../common/validation";
import { PrismaService } from "../prisma.service";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "./auth.constants";

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

@Controller("auth")
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { email, password } = parse(LoginBody, body);
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const ok = user?.active && (await bcrypt.compare(password, user.passwordHash));
    if (!user || !ok) {
      await this.audit.record({ action: "auth.login_failed", entity: "User", meta: { email } });
      throw new UnauthorizedException("Email or password is incorrect.");
    }
    const token = await this.jwt.signAsync({ sub: user.id }, { expiresIn: SESSION_TTL_SECONDS });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: SESSION_TTL_SECONDS * 1000,
      path: "/",
    });
    await this.audit.record({ actorId: user.id, action: "auth.login", entity: "User", entityId: user.id });
    return { ok: true };
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    await this.audit.record({ actorId: user.id, action: "auth.logout", entity: "User", entityId: user.id });
    return { ok: true };
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return { ...user, roleLabel: ROLE_LABELS[user.role], modules: DEFAULT_ACCESS[user.role] };
  }
}
