import { BadRequestException, UnprocessableEntityException } from "@nestjs/common";
import type { z } from "zod";

export function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException({
      message: "Please check the highlighted fields.",
      errors: result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
    });
  }
  return result.data;
}

/** Business-rule failures from @solarcrm/shared, returned as 422 with readable messages. */
export class RuleViolation extends UnprocessableEntityException {
  constructor(errors: string[]) {
    super({ message: errors[0] ?? "Request not allowed.", errors });
  }
}
