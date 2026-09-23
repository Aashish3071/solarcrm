import { Injectable } from "@nestjs/common";
import type { Stage } from "@solarcrm/shared";
import { EventEmitter } from "node:events";

export interface WorkflowEvents {
  "lead.created": { projectId: string };
  /** Emitted after any change to a project's stages, with what was open and completed before. */
  "stages.changed": { projectId: string; openBefore: Stage[]; completedBefore: Stage[] };
  "payment.decided": { projectId: string; paymentId: string; approved: boolean; reason?: string };
  "track.updated": { projectId: string; kind: "LOAN" | "DISCOM"; status: string };
  "sla.breached": { projectId: string; stage: Stage };
}

/** In-process events so workflow code doesn't depend on automation (and vice versa). */
@Injectable()
export class EventBus {
  private readonly emitter = new EventEmitter();

  emit<K extends keyof WorkflowEvents>(name: K, payload: WorkflowEvents[K]) {
    this.emitter.emit(name, payload);
  }

  on<K extends keyof WorkflowEvents>(name: K, handler: (payload: WorkflowEvents[K]) => Promise<void>) {
    this.emitter.on(name, (p) => {
      // Automation must never break the user's request; failures are logged by the handler.
      handler(p).catch((e) => console.error(`[automation] ${name} failed`, e));
    });
  }
}
