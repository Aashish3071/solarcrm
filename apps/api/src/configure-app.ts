import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import type { NextFunction, Request, Response } from "express";

/** API responses are data only: never framed, sniffed or cached. */
function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Cache-Control", "no-store");
  next();
}

/** Shared by main.ts and the e2e tests so both run the same middleware. */
export function configureApp(app: INestApplication) {
  const http = app.getHttpAdapter().getInstance();
  // Behind the web proxy / load balancer, so req.ip is the client (login throttling, audit).
  http.set("trust proxy", process.env.TRUST_PROXY ?? "loopback");
  http.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(cookieParser());
  app.setGlobalPrefix("api");
  return app;
}
