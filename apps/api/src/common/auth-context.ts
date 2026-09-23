import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Module, Role } from "@solarcrm/shared";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  partnerId: string | null;
}

export const IS_PUBLIC = "isPublic";
export const REQUIRED_MODULE = "requiredModule";

/** Skip authentication for this route (login, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Require the caller's role to have access to a module (permissions.ts). */
export const RequireModule = (module: Module) => SetMetadata(REQUIRED_MODULE, module);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
