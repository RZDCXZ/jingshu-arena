import { randomUUID } from "node:crypto";

import pg from "pg";
import type { Hono } from "hono";
import { getCookie } from "hono/cookie";

import { readRoleSession } from "./role-session.js";
import {
  SESSION_COOKIE,
  errorBody,
  isRoleContextStale,
  isRoleContextUnavailable,
  type AppServices,
} from "./route-support.js";

const DEFAULT_CONNECTION_LIFETIME_MILLISECONDS = 25_000;
const NON_MUTATING_POST_PATHS = new Set([
  "/api/v1/demo/context/access",
  "/api/v1/demo/context/refresh",
  "/api/v1/hq/exports/preview",
  "/api/v1/manager/exports/preview",
]);
const REALTIME_NOTIFICATION_CHANNEL = "jingshu_sandbox_invalidation_v1";
const SANDBOX_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const { Client, Pool } = pg;

export type SandboxInvalidationSignal = "invalidated" | "reconnect";

type SandboxInvalidationListener = (signal: SandboxInvalidationSignal) => void;

export interface SandboxRealtimeHub {
  isAvailable(): boolean;
  publish(sandboxId: string): Promise<void> | void;
  subscribe(
    sandboxId: string,
    listener: SandboxInvalidationListener,
  ): () => void;
}

export class SandboxInvalidationHub implements SandboxRealtimeHub {
  readonly #listeners = new Map<string, Set<SandboxInvalidationListener>>();
  #available = true;

  isAvailable() {
    return this.#available;
  }

  publish(sandboxId: string) {
    this.emit(sandboxId, "invalidated");
  }

  protected emitAll(signal: SandboxInvalidationSignal) {
    for (const sandboxId of [...this.#listeners.keys()]) {
      this.emit(sandboxId, signal);
    }
  }

  protected emit(sandboxId: string, signal: SandboxInvalidationSignal) {
    const listeners = this.#listeners.get(sandboxId);
    if (!listeners) return;

    for (const listener of [...listeners]) {
      try {
        listener(signal);
      } catch {
        // A disconnected stream must not make a successful business command fail.
      }
    }
  }

  protected markAvailable() {
    this.#available = true;
  }

  protected markUnavailable() {
    if (!this.#available) return;
    this.#available = false;
    this.emitAll("reconnect");
  }

  subscribe(sandboxId: string, listener: SandboxInvalidationListener) {
    const listeners = this.#listeners.get(sandboxId) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(sandboxId, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(sandboxId);
    };
  }
}

/**
 * Bridges each API instance's local SSE streams through PostgreSQL LISTEN /
 * NOTIFY. The notification contains only a sandbox UUID and is never sent to
 * browsers; browser streams still receive the static invalidation frame.
 */
export class PostgresSandboxInvalidationHub extends SandboxInvalidationHub {
  readonly #databaseUrl: string;
  readonly #publisher: pg.Pool;
  #closed = false;
  #listener: pg.Client | null = null;
  #startPromise: Promise<void> | null = null;

  constructor(databaseUrl: string) {
    super();
    this.#databaseUrl = databaseUrl;
    this.#publisher = new Pool({ connectionString: databaseUrl });
    this.markUnavailable();
  }

  async start() {
    if (this.#closed) return;
    if (this.isAvailable()) return;
    if (!this.#startPromise) {
      this.#startPromise = this.connectListener().finally(() => {
        this.#startPromise = null;
      });
    }
    return this.#startPromise;
  }

  override async publish(sandboxId: string) {
    if (!this.isAvailable() || !SANDBOX_ID_PATTERN.test(sandboxId)) return;

    try {
      await this.#publisher.query("select pg_notify($1, $2)", [
        REALTIME_NOTIFICATION_CHANNEL,
        sandboxId,
      ]);
    } catch {
      this.markUnavailable();
    }
  }

  async close() {
    this.#closed = true;
    this.markUnavailable();
    const listener = this.#listener;
    this.#listener = null;
    await Promise.all([
      listener?.end().catch(() => undefined),
      this.#publisher.end().catch(() => undefined),
    ]);
  }

  private async connectListener() {
    const listener = new Client({ connectionString: this.#databaseUrl });
    const disconnected = () => {
      if (this.#listener === listener) this.#listener = null;
      if (!this.#closed) this.markUnavailable();
    };

    listener.on("error", disconnected);
    listener.on("end", disconnected);
    listener.on("notification", (notification) => {
      if (notification.channel !== REALTIME_NOTIFICATION_CHANNEL) return;
      const sandboxId = notification.payload;
      if (!sandboxId || !SANDBOX_ID_PATTERN.test(sandboxId)) return;
      super.publish(sandboxId);
    });

    try {
      await listener.connect();
      await listener.query(`listen ${REALTIME_NOTIFICATION_CHANNEL}`);
      if (this.#closed) {
        await listener.end().catch(() => undefined);
        return;
      }
      this.#listener = listener;
      this.markAvailable();
    } catch {
      await listener.end().catch(() => undefined);
      disconnected();
      throw new Error("Sandbox realtime notification probe failed.");
    }
  }
}

export function normalizeRealtimeConnectionLifetime(milliseconds?: number) {
  if (!milliseconds || !Number.isFinite(milliseconds)) {
    return DEFAULT_CONNECTION_LIFETIME_MILLISECONDS;
  }
  return Math.max(1, Math.floor(milliseconds));
}

function writesSandboxState(method: string, path: string) {
  return (
    method !== "GET" &&
    method !== "HEAD" &&
    method !== "OPTIONS" &&
    !NON_MUTATING_POST_PATHS.has(path)
  );
}

export function registerSandboxRealtimeInvalidationPublishing(
  app: Hono,
  services: AppServices,
) {
  app.use("/api/v1/*", async (context, next) => {
    const path = new URL(context.req.url).pathname;
    const session =
      services.sessionSecret && writesSandboxState(context.req.method, path)
        ? readRoleSession(
            getCookie(context, SESSION_COOKIE),
            services.sessionSecret,
            services.wallClock.now().getTime(),
          )
        : null;

    await next();

    if (session && context.res.status >= 200 && context.res.status < 300) {
      try {
        await services.realtimeHub.publish(session.sandboxId);
      } catch {
        // The mutation already committed. The client will downgrade on the next probe.
      }
    }
  });
}

function sseFrame(event: "connected" | "invalidated" | "reconnect") {
  if (event === "invalidated") {
    return 'event: invalidated\ndata: {"resource":"sandbox"}\n\n';
  }
  return `event: ${event}\n\n`;
}

export function registerSandboxRealtimeRoutes(
  app: Hono,
  services: AppServices,
) {
  app.get("/api/v1/demo/realtime", async (context) => {
    const requestId = randomUUID();

    if (
      !services.sandboxDatabase ||
      !services.sessionSecret ||
      !services.realtimeHub.isAvailable()
    ) {
      return context.json(
        errorBody(
          "ROLE_CONTEXT_SERVICE_UNAVAILABLE",
          "实时连接暂时不可用，请使用轮询或手动刷新。",
          requestId,
        ),
        503,
      );
    }

    const session = readRoleSession(
      getCookie(context, SESSION_COOKIE),
      services.sessionSecret,
      services.wallClock.now().getTime(),
    );
    if (!session) {
      return context.json(
        errorBody(
          "ROLE_CONTEXT_REQUIRED",
          "演示角色上下文已失效，请返回公开入口重新选择。",
          requestId,
        ),
        401,
      );
    }

    try {
      await services.sandboxDatabase.readRoleContext({
        contextVersion: session.contextVersion,
        personaId: session.personaId,
        role: session.role,
        sandboxId: session.sandboxId,
      });
    } catch (error) {
      if (isRoleContextStale(error)) {
        return context.json(
          errorBody(
            "ROLE_CONTEXT_STALE",
            "当前标签的旧角色上下文已失效，请刷新到当前角色。",
            requestId,
          ),
          409,
        );
      }
      if (isRoleContextUnavailable(error)) {
        return context.json(
          errorBody(
            "ROLE_CONTEXT_UNAVAILABLE",
            "当前演示角色或沙箱已失效，请返回公开入口重新选择。",
            requestId,
          ),
          401,
        );
      }
      return context.json(
        errorBody(
          "ROLE_CONTEXT_SERVICE_UNAVAILABLE",
          "实时连接暂时不可用，请使用轮询或手动刷新。",
          requestId,
        ),
        503,
      );
    }

    const encoder = new TextEncoder();
    const requestSignal = context.req.raw.signal;
    const connectionLifetimeMilliseconds =
      services.realtimeConnectionLifetimeMilliseconds;

    let cancelStream: () => void = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;

        const cleanup = () => {
          if (closed) return;
          closed = true;
          clearTimeout(reconnectTimer);
          unsubscribe();
          requestSignal.removeEventListener("abort", close);
        };
        const close = () => {
          if (closed) return;
          cleanup();
          controller.close();
        };
        const send = (event: "connected" | "invalidated" | "reconnect") => {
          if (closed) return;
          controller.enqueue(encoder.encode(sseFrame(event)));
        };

        send("connected");
        const unsubscribe = services.realtimeHub.subscribe(
          session.sandboxId,
          (signal) => {
            send(signal);
            if (signal === "reconnect") close();
          },
        );
        const reconnectTimer = setTimeout(() => {
          send("reconnect");
          close();
        }, connectionLifetimeMilliseconds);
        requestSignal.addEventListener("abort", close, { once: true });
        cancelStream = cleanup;
      },
      cancel() {
        cancelStream();
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
        "X-Request-Id": requestId,
      },
    });
  });
}
