import { DurableObject } from "cloudflare:workers";

import { ingressQueueMessageSchema } from "@relay/contracts";

import { handleE2EResultRequest, processIngressMessage, runMaintenanceAlarm } from "./dedup";
import type { Env } from "./env";
import {
  acceptGmailCursor,
  acceptGmailMaintenance,
  coordinateGmailDisconnect,
  parseGmailCursorCoordinatorRequest,
  parseGmailDisconnectCoordinatorRequest,
  parseGmailMaintenanceCoordinatorRequest,
  runGmailAlarmReliably,
} from "./gmail";
import { SerialExecutor } from "./serialization";

// Thin Workers/Durable Object adapter. Real dedup, persistence, and restart-recovery decisions live
// in `./dedup`, which stays free of the `cloudflare:workers` runtime import so it can be unit tested
// under plain Vitest. Add new behavior there, not here.
export class TenantCoordinator extends DurableObject<Env> {
  private readonly processing = new SerialExecutor();

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (this.env.RELAY_E2E_MODE === "true" && url.pathname === "/e2e/result") {
      return handleE2EResultRequest(this.ctx.storage, request);
    }

    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    if (url.pathname === "/gmail/cursor") {
      const candidate = parseGmailCursorCoordinatorRequest(
        await request.json<unknown>().catch(() => undefined),
      );
      if (candidate === undefined) {
        return Response.json({ accepted: false, reason: "invalid" }, { status: 400 });
      }
      return this.processing.run(() =>
        acceptGmailCursor(this.ctx.storage, candidate, candidate.historyId),
      );
    }

    if (url.pathname === "/gmail/maintenance") {
      const candidate = parseGmailMaintenanceCoordinatorRequest(
        await request.json<unknown>().catch(() => undefined),
      );
      if (candidate === undefined) {
        return Response.json({ accepted: false, reason: "invalid" }, { status: 400 });
      }
      return this.processing.run(() => acceptGmailMaintenance(this.ctx.storage, candidate));
    }

    if (url.pathname === "/gmail/disconnect") {
      const candidate = parseGmailDisconnectCoordinatorRequest(
        await request.json<unknown>().catch(() => undefined),
      );
      if (candidate === undefined) {
        return Response.json({ disconnected: false, reason: "invalid" }, { status: 400 });
      }
      return this.processing.run(() =>
        coordinateGmailDisconnect(this.ctx.storage, this.env, candidate),
      );
    }

    const candidate = ingressQueueMessageSchema.safeParse(
      await request.json<unknown>().catch(() => undefined),
    );
    if (!candidate.success) {
      return Response.json({ accepted: false, reason: "invalid" }, { status: 400 });
    }
    return this.processing.run(() =>
      processIngressMessage(this.ctx.storage, this.env, candidate.data),
    );
  }

  override async alarm(): Promise<void> {
    return this.processing.run(async () => {
      if (await runGmailAlarmReliably(this.ctx.storage, this.env)) return;
      await runMaintenanceAlarm(this.ctx.storage);
    });
  }
}
