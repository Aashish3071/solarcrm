import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth/auth.controller";
import { AuthGuard } from "./auth/auth.guard";
import { AuditService } from "./common/audit.service";
import { ConfigParamsService } from "./common/config-params.service";
import { DashboardController } from "./dashboard/dashboard.controller";
import { HealthController } from "./health.controller";
import { PrismaService } from "./prisma.service";
import { ProjectsController } from "./projects/projects.controller";
import { ProjectsService } from "./projects/projects.service";
import { UsersController } from "./users/users.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      global: true,
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret) throw new Error("JWT_SECRET is not set");
        return { secret };
      },
    }),
  ],
  controllers: [HealthController, AuthController, ProjectsController, DashboardController, UsersController],
  providers: [PrismaService, AuditService, ConfigParamsService, ProjectsService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
