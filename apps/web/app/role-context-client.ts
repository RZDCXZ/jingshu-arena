import type { ApiErrorResponse } from "@jingshu/contracts";

export const SANDBOX_RECOVERY_ROLE_KEY = "jingshu:sandbox-recovery-role";

export async function requestExistingRoleContext(signal?: AbortSignal) {
  let response = await fetch("/api/v1/demo/context", {
    cache: "no-store",
    credentials: "same-origin",
    ...(signal ? { signal } : {}),
  });
  let payload: unknown = await response.json().catch(() => null);
  const apiError = payload as ApiErrorResponse | null;

  if (!response.ok && apiError?.error?.code === "ROLE_CONTEXT_STALE") {
    response = await fetch("/api/v1/demo/context/refresh", {
      body: JSON.stringify({ mode: "canonical" }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    payload = await response.json().catch(() => null);
  }

  return { payload, response };
}
