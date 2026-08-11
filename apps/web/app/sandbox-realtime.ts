import { useCallback, useEffect, useRef, useState } from "react";

export type RealtimeConnectionMode =
  "realtime" | "reconnecting" | "polling" | "manual";

export interface RealtimeConnectionState {
  readonly mode: RealtimeConnectionMode;
  readonly observedAt: string;
  readonly pollFailures: number;
  readonly sseFailures: number;
}

export type RealtimeConnectionEvent =
  | { readonly type: "manual-refresh" }
  | { readonly observedAt: string; readonly type: "sse-connected" }
  | { readonly type: "sse-reconnecting" }
  | { readonly type: "sse-failed" }
  | { readonly observedAt: string; readonly type: "poll-succeeded" }
  | { readonly type: "poll-failed" };

const MAX_POLL_FAILURES_BEFORE_MANUAL = 2;
const MAX_SSE_FAILURES_BEFORE_POLLING = 2;

export function createRealtimeConnectionState(
  observedAt: string,
): RealtimeConnectionState {
  return {
    mode: "reconnecting",
    observedAt,
    pollFailures: 0,
    sseFailures: 0,
  };
}

export function transitionRealtimeConnection(
  state: RealtimeConnectionState,
  event: RealtimeConnectionEvent,
): RealtimeConnectionState {
  switch (event.type) {
    case "manual-refresh":
      return {
        ...state,
        mode: "reconnecting",
        pollFailures: 0,
        sseFailures: 0,
      };
    case "sse-connected":
      return {
        mode: "realtime",
        observedAt: event.observedAt,
        pollFailures: 0,
        sseFailures: 0,
      };
    case "sse-reconnecting":
      return { ...state, mode: "reconnecting" };
    case "sse-failed": {
      const sseFailures = state.sseFailures + 1;
      return {
        ...state,
        mode:
          sseFailures >= MAX_SSE_FAILURES_BEFORE_POLLING
            ? "polling"
            : "reconnecting",
        sseFailures,
      };
    }
    case "poll-succeeded":
      return {
        ...state,
        mode: "polling",
        observedAt: event.observedAt,
        pollFailures: 0,
      };
    case "poll-failed": {
      const pollFailures = state.pollFailures + 1;
      return {
        ...state,
        mode:
          pollFailures >= MAX_POLL_FAILURES_BEFORE_MANUAL
            ? "manual"
            : "polling",
        pollFailures,
      };
    }
  }
}

const POLL_INTERVAL_MILLISECONDS = 8_000;
const RECONNECT_DELAY_MILLISECONDS = 750;
const SSE_CONNECTED_TIMEOUT_MILLISECONDS = 4_000;

export type AuthoritativeRefreshResult =
  "failed" | "stale" | "unavailable" | "updated";

interface UseSandboxRealtimeOptions {
  readonly contextVersion: number;
  readonly onInvalidationStart?: () => void;
  readonly observedAt: string;
  readonly refreshAuthoritativeState: (
    source: "polling" | "realtime",
  ) => Promise<AuthoritativeRefreshResult>;
}

function nowIso() {
  return new Date().toISOString();
}

function isSandboxInvalidation(event: Event) {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
    return false;
  }
  try {
    const payload: unknown = JSON.parse(event.data);
    return (
      typeof payload === "object" &&
      payload !== null &&
      "resource" in payload &&
      payload.resource === "sandbox"
    );
  } catch {
    return false;
  }
}

export function useSandboxRealtime({
  contextVersion,
  onInvalidationStart,
  observedAt,
  refreshAuthoritativeState,
}: UseSandboxRealtimeOptions) {
  const [state, setState] = useState(() =>
    createRealtimeConnectionState(observedAt),
  );
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const invalidationStartRef = useRef(onInvalidationStart);
  const refreshRef = useRef(refreshAuthoritativeState);

  useEffect(() => {
    refreshRef.current = refreshAuthoritativeState;
  }, [refreshAuthoritativeState]);

  useEffect(() => {
    invalidationStartRef.current = onInvalidationStart;
  }, [onInvalidationStart]);

  useEffect(() => {
    let disposed = false;
    let eventSource: EventSource | null = null;
    let pollingTimer: number | undefined;
    let reconnectTimer: number | undefined;
    let readinessTimer: number | undefined;
    let sseFailures = 0;
    let pollFailures = 0;

    const clearTimers = () => {
      if (pollingTimer) window.clearTimeout(pollingTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (readinessTimer) window.clearTimeout(readinessTimer);
    };
    const closeEventSource = () => {
      eventSource?.close();
      eventSource = null;
      if (readinessTimer) window.clearTimeout(readinessTimer);
      readinessTimer = undefined;
    };
    const dispatch = (event: RealtimeConnectionEvent) => {
      if (disposed) return;
      setState((current) => transitionRealtimeConnection(current, event));
    };
    const scheduleReconnect = () => {
      if (disposed) return;
      reconnectTimer = window.setTimeout(
        () => startSse(),
        RECONNECT_DELAY_MILLISECONDS,
      );
    };
    const schedulePoll = () => {
      if (disposed) return;
      pollingTimer = window.setTimeout(
        () => void poll(),
        POLL_INTERVAL_MILLISECONDS,
      );
    };
    const handleSseFailure = () => {
      if (disposed) return;
      closeEventSource();
      sseFailures += 1;
      dispatch({ type: "sse-failed" });
      if (sseFailures >= MAX_SSE_FAILURES_BEFORE_POLLING) {
        void poll();
      } else {
        scheduleReconnect();
      }
    };
    const poll = async () => {
      if (disposed) return;
      const result = await refreshRef.current("polling");
      if (disposed || result === "stale" || result === "unavailable") return;
      if (result === "updated") {
        pollFailures = 0;
        dispatch({ observedAt: nowIso(), type: "poll-succeeded" });
        schedulePoll();
        return;
      }
      pollFailures += 1;
      dispatch({ type: "poll-failed" });
      if (pollFailures < MAX_POLL_FAILURES_BEFORE_MANUAL) schedulePoll();
    };
    const startSse = () => {
      if (disposed || typeof EventSource === "undefined") {
        handleSseFailure();
        return;
      }
      closeEventSource();
      dispatch({ type: "sse-reconnecting" });
      let connected = false;
      let normalReconnect = false;
      const next = new EventSource(
        `/api/v1/demo/realtime?contextVersion=${encodeURIComponent(String(contextVersion))}`,
        { withCredentials: true },
      );
      eventSource = next;
      const markConnected = () => {
        if (disposed || eventSource !== next || connected) return;
        connected = true;
        sseFailures = 0;
        if (readinessTimer) window.clearTimeout(readinessTimer);
        readinessTimer = undefined;
        dispatch({ observedAt: nowIso(), type: "sse-connected" });
      };

      next.addEventListener("connected", markConnected);
      next.addEventListener("invalidated", (event) => {
        if (!isSandboxInvalidation(event)) return;
        invalidationStartRef.current?.();
        void refreshRef.current("realtime").then((result) => {
          if (disposed || result === "stale" || result === "unavailable") {
            return;
          }
          if (result === "updated") {
            dispatch({ observedAt: nowIso(), type: "sse-connected" });
            return;
          }
          handleSseFailure();
        });
      });
      next.addEventListener("reconnect", () => {
        if (disposed || eventSource !== next) return;
        normalReconnect = true;
        closeEventSource();
        dispatch({ type: "sse-reconnecting" });
        scheduleReconnect();
      });
      next.onerror = () => {
        if (disposed || eventSource !== next || normalReconnect) return;
        handleSseFailure();
      };
      readinessTimer = window.setTimeout(() => {
        if (!connected && eventSource === next) handleSseFailure();
      }, SSE_CONNECTED_TIMEOUT_MILLISECONDS);
    };

    startSse();
    return () => {
      disposed = true;
      clearTimers();
      closeEventSource();
    };
  }, [connectionAttempt, contextVersion]);

  const reconnect = useCallback(() => {
    setState((current) =>
      transitionRealtimeConnection(current, { type: "manual-refresh" }),
    );
    setConnectionAttempt((attempt) => attempt + 1);
  }, []);

  return { reconnect, state };
}
