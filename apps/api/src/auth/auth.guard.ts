import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { canAccess, isRole, type Module } from "@solarcrm/shared";
import type { Request } from "express";
import { PrismaService } from "../prisma.service";
import { IS_PUBLIC, REQUIRED_MODULE, type AuthUser } from "../common/auth-context";
import { SESSION_COOKIE } from "./auth.constants";

/** Global guard: authenticates every route unless @Public, then checks @RequireModule. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = req.cookies?.[SESSION_COOKIE] ?? req.headers.authorization?.replace(/^Bearer /, "");
    if (!token) throw new UnauthorizedException();

    let userId: string;
    try {
      userId = (await this.jwt.verifyAsync<{ sub: string }>(token)).sub;
    } catch {
      throw new UnauthorizedException();
    }

    // Re-read the user each request so deactivation and role changes apply immediately.
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active || !isRole(user.role)) throw new UnauthorizedException();
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role, partnerId: user.partnerId };

    const modules = this.reflector.getAllAndOverride<Module[] | undefined>(REQUIRED_MODULE, targets);
    if (modules?.length && !modules.some((m) => canAccess(user.role, m))) {
      throw new ForbiddenException("Your role cannot access this module.");
    }
    return true;
  }
}
