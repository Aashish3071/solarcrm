import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";

async function bootstrap() {
  // rawBody lets integration webhooks verify HMAC signatures over the exact bytes received.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(cookieParser());
  app.setGlobalPrefix("api");
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}/api`);
}

bootstrap();
