import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./configure-app";

async function bootstrap() {
  // rawBody lets integration webhooks verify HMAC signatures over the exact bytes received.
  const app = configureApp(await NestFactory.create(AppModule, { rawBody: true }));
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}/api`);
}

bootstrap();
