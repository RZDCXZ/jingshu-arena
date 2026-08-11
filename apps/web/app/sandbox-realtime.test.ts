import { describe, expect, it } from "vitest";

import {
  createRealtimeConnectionState,
  transitionRealtimeConnection,
} from "./sandbox-realtime.js";

describe("sandbox realtime connection state", () => {
  it("honestly degrades from reconnecting to polling and then manual refresh", () => {
    const initial = createRealtimeConnectionState("2026-08-11T11:30:00.000Z");

    const firstFailure = transitionRealtimeConnection(initial, {
      type: "sse-failed",
    });
    const polling = transitionRealtimeConnection(firstFailure, {
      type: "sse-failed",
    });
    const firstPollFailure = transitionRealtimeConnection(polling, {
      type: "poll-failed",
    });
    const manual = transitionRealtimeConnection(firstPollFailure, {
      type: "poll-failed",
    });
    const retrying = transitionRealtimeConnection(manual, {
      type: "manual-refresh",
    });

    expect(initial).toMatchObject({ mode: "reconnecting" });
    expect(firstFailure).toMatchObject({ mode: "reconnecting" });
    expect(polling).toMatchObject({ mode: "polling" });
    expect(manual).toMatchObject({ mode: "manual" });
    expect(retrying).toMatchObject({
      mode: "reconnecting",
      pollFailures: 0,
      sseFailures: 0,
    });
  });
});
