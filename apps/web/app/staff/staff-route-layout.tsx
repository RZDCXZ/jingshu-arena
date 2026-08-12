"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type {
  ApiErrorResponse,
  RoleContextReadyResponse,
  SandboxEndReason,
} from "@jingshu/contracts";

import { ReadonlySeedSnapshot, SandboxEndedView } from "../page";
import {
  requestExistingRoleContext,
  SANDBOX_RECOVERY_ROLE_KEY,
} from "../role-context-client";
import { RoleContextShell } from "../role-context-shell";

type RouteState =
  | { readonly kind: "checking" }
  | { readonly context: RoleContextReadyResponse; readonly kind: "ready" }
  | {
      readonly failure: {
        readonly message: string;
        readonly requestId?: string;
      };
      readonly kind: "readonly";
    }
  | { readonly kind: "ended"; readonly reason: SandboxEndReason };

function sandboxEndReason(payload: unknown) {
  const reason = (payload as ApiErrorResponse | null)?.error?.sandboxEndReason;
  return reason === "expired" || reason === "reset" ? reason : null;
}

export function StaffRouteLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<RouteState>({ kind: "checking" });

  const loadContext = useCallback(
    async (signal?: AbortSignal) => {
      setState({ kind: "checking" });
      try {
        const { payload, response } = await requestExistingRoleContext(signal);
        if (!response.ok) {
          const reason = sandboxEndReason(payload);
          if (reason) {
            setState({ kind: "ended", reason });
            return;
          }
          const error = payload as ApiErrorResponse | null;
          if (response.status >= 500) {
            setState({
              failure: {
                message:
                  error?.error?.message ??
                  "角色上下文暂时无法确认，请稍后安全重试。",
                ...(error?.error?.requestId
                  ? { requestId: error.error.requestId }
                  : {}),
              },
              kind: "readonly",
            });
            return;
          }
          router.replace("/");
          return;
        }

        const context = payload as RoleContextReadyResponse;
        if (context.status !== "ready" || context.role.id !== "staff") {
          router.replace("/");
          return;
        }
        setState({ context, kind: "ready" });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setState({
          failure: {
            message: "角色上下文暂时无法确认，请稍后安全重试。",
          },
          kind: "readonly",
        });
      }
    },
    [router],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadContext(controller.signal);
    return () => controller.abort();
  }, [loadContext]);

  if (state.kind === "checking") {
    return (
      <main className="state-page" aria-busy="true">
        <section className="state-card">
          <span className="eyebrow">店员共享角色布局</span>
          <h1>正在确认店员角色上下文</h1>
          <p>确认完成前不会读取或显示店员业务数据。</p>
        </section>
      </main>
    );
  }

  if (state.kind === "readonly") {
    return (
      <ReadonlySeedSnapshot
        failure={state.failure}
        onRetry={() => void loadContext()}
      />
    );
  }

  if (state.kind === "ended") {
    return (
      <SandboxEndedView
        onCreate={() => {
          window.sessionStorage.setItem(SANDBOX_RECOVERY_ROLE_KEY, "staff");
          router.replace("/");
        }}
        onReturn={() => router.replace("/")}
        reason={state.reason}
      />
    );
  }

  return (
    <>
      <RoleContextShell
        context={state.context}
        {...(state.context.role.id === "staff"
          ? { initialPage: "workbench" as const }
          : {})}
        onContextChange={(context) => {
          setState({ context, kind: "ready" });
          const nextPath =
            context.role.id === "staff" ? "/staff/workbench" : "/";
          window.history.replaceState(window.history.state, "", nextPath);
        }}
        onContextRequired={() => router.replace("/")}
        onContextUnavailable={(reason) => setState({ kind: "ended", reason })}
        onServiceUnavailable={(failure) =>
          setState({ failure, kind: "readonly" })
        }
      />
      <div hidden>{children}</div>
    </>
  );
}
