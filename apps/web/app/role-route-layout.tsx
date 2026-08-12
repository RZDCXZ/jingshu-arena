"use client";

import { ArrowRight, ShieldCheck, Warning } from "@phosphor-icons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type {
  ApiErrorResponse,
  PublicRole,
  RoleContextReadyResponse,
  SandboxEndReason,
} from "@jingshu/contracts";

import { createBrowserUuid } from "./browser-uuid";
import type { CustomerRouteState } from "./customer-route-model";
import {
  CreationProgress,
  FailureView,
  PublicEntry,
  ReadonlySeedSnapshot,
  SandboxEndedView,
  type FailureState,
} from "./page";
import { requestExistingRoleContext } from "./role-context-client";
import { roleMeta, type RolePageId } from "./role-context-model";
import { RoleContextShell } from "./role-context-shell";
import {
  parseWebRoute,
  roleHomePath,
  webRouteMetadata,
  type ParsedWebRoute,
} from "./web-route-contract";

const REQUEST_TIMEOUT_MS = 8_000;

type GuardState =
  | { readonly kind: "checking" }
  | { readonly kind: "entry" }
  | { readonly kind: "creating"; readonly role: PublicRole }
  | { readonly context: RoleContextReadyResponse; readonly kind: "ready" }
  | { readonly context: RoleContextReadyResponse; readonly kind: "mismatch" }
  | {
      readonly failure: FailureState;
      readonly kind: "failure";
      readonly requestKind: "error" | "timeout";
      readonly retry: { readonly key: string; readonly role: PublicRole };
    }
  | {
      readonly failure: FailureState;
      readonly kind: "readonly";
    }
  | { readonly kind: "ended"; readonly reason: SandboxEndReason };

function sandboxEndReason(payload: unknown) {
  const reason = (payload as ApiErrorResponse | null)?.error?.sandboxEndReason;
  return reason === "expired" || reason === "reset" ? reason : null;
}

function failureFrom(payload: unknown, fallback: string): FailureState {
  const error = (payload as ApiErrorResponse | null)?.error;
  return {
    message: error?.message ?? fallback,
    ...(error?.requestId ? { requestId: error.requestId } : {}),
  };
}

function isContextRequired(payload: unknown) {
  const code = (payload as ApiErrorResponse | null)?.error?.code;
  return (
    code === "ROLE_CONTEXT_REQUIRED" || code === "ROLE_CONTEXT_UNAVAILABLE"
  );
}

function pageForRoute(role: PublicRole, routeId: string): RolePageId {
  if (role === "customer") {
    if (routeId.includes("orders")) return "customer-orders";
    if (routeId.includes("repairs")) return "customer-repairs";
    if (routeId.includes("journeys")) return "customer-reservations";
    return "customer-home";
  }
  if (role === "staff") {
    if (routeId.includes("orders")) return "orders";
    if (routeId.includes("repairs")) return "repairs";
    if (routeId.includes("inventory")) return "inventory";
    if (routeId.includes("shifts")) return "shift";
    if (routeId.includes("reservations")) return "reservations";
    return "workbench";
  }
  if (role === "manager") {
    if (routeId.includes("live-ops")) return "live-ops";
    if (routeId.includes("repairs")) return "manager-repairs";
    if (routeId.includes("inventory")) return "manager-inventory";
    if (routeId.includes("configuration")) return "store-config";
    if (routeId.includes("people")) return "people-schedule";
    if (routeId.includes("audit")) return "store-audit";
    return "store-dashboard";
  }
  if (routeId.includes("comparison")) return "store-compare";
  if (routeId.includes("catalogs")) return "chain-config";
  if (routeId.includes("stores")) return "hq-store-config";
  if (routeId.includes("people")) return "hq-people";
  if (routeId.includes("audit")) return "hq-audit";
  return "chain-dashboard";
}

function customerRouteFor(
  route: ParsedWebRoute,
): CustomerRouteState | undefined {
  if (route.status !== "matched") return undefined;
  if (route.routeId === "customer-reservations") {
    return { kind: "reservations" };
  }
  if (route.routeId === "customer-stores") return { kind: "stores" };
  if (route.routeId.startsWith("customer-journeys-")) {
    const tab = route.routeId.replace("customer-journeys-", "");
    if (tab !== "current" && tab !== "future" && tab !== "history") {
      return undefined;
    }
    const type = route.query.get("type");
    return {
      kind: "journeys",
      refunds: route.query.get("refunds") === "only" ? "only" : "all",
      tab,
      type: type === "order" || type === "repair" ? type : null,
    };
  }
  if (route.routeId.startsWith("customer-coupons-")) {
    const couponStatus = route.routeId.replace("customer-coupons-", "");
    if (
      couponStatus === "available" ||
      couponStatus === "reserved" ||
      couponStatus === "redeemed" ||
      couponStatus === "expired"
    ) {
      return { couponStatus, kind: "membership" };
    }
  }
  return undefined;
}

function routeBoundary(route: ParsedWebRoute) {
  if (route.status === "not-found") return { kind: "not-found" } as const;
  return webRouteMetadata(route.routeId).kind === "detail"
    ? ({ kind: "object-unavailable" } as const)
    : undefined;
}

function CheckingView({ role }: { role: PublicRole }) {
  return (
    <main className="state-page" aria-busy="true">
      <section className="state-card">
        <span className="eyebrow">{roleMeta[role].label}深链保护</span>
        <h1>正在确认服务端角色上下文</h1>
        <p>确认完成前不会请求或显示目标角色的业务数据。</p>
      </section>
    </main>
  );
}

function RoleMismatchView({
  context,
  error,
  onCancel,
  onConfirm,
  switching,
  targetRole,
}: {
  context: RoleContextReadyResponse;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
  switching: boolean;
  targetRole: PublicRole;
}) {
  return (
    <main className="state-page role-mismatch-page">
      <section className="state-card role-mismatch-card" role="alert">
        <div className="state-icon is-warning">
          <Warning weight="duotone" />
        </div>
        <span className="eyebrow">角色上下文不一致</span>
        <h1>当前角色与链接目标不一致</h1>
        <p>
          当前服务端角色是<strong>{context.role.label}</strong>，此链接属于
          <strong>{roleMeta[targetRole].label}</strong>
          。确认前不会读取目标角色数据。
        </p>
        <div className="role-mismatch-proof">
          <ShieldCheck weight="duotone" />
          <span>URL 只表达目标，不会授予角色、门店、沙箱或对象权限。</span>
        </div>
        {error ? <p className="role-mismatch-error">{error}</p> : null}
        <div className="state-actions">
          <button
            className="button primary-button"
            disabled={switching}
            onClick={onConfirm}
            type="button"
          >
            {switching
              ? "正在向服务端确认"
              : `切换为${roleMeta[targetRole].label}并继续`}
            <ArrowRight weight="bold" />
          </button>
          <button
            className="button secondary-button"
            disabled={switching}
            onClick={onCancel}
            type="button"
          >
            留在{context.role.label}首页
          </button>
        </div>
      </section>
    </main>
  );
}

function RoleRouteLayoutClient({
  children,
  role,
}: {
  children: ReactNode;
  role: PublicRole;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [route, setRoute] = useState<ParsedWebRoute>(() =>
    parseWebRoute(pathname),
  );
  const [state, setState] = useState<GuardState>({ kind: "checking" });
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const recoveryPendingRef = useRef(false);

  const finishWithContext = useCallback(
    (context: RoleContextReadyResponse) => {
      setState(
        context.role.id === role
          ? { context, kind: "ready" }
          : { context, kind: "mismatch" },
      );
    },
    [role],
  );

  const loadContext = useCallback(
    async (signal?: AbortSignal) => {
      setState({ kind: "checking" });
      try {
        const { payload, response } = await requestExistingRoleContext(signal);
        if (!response.ok) {
          const reason = sandboxEndReason(payload);
          if (response.status === 401 && reason) {
            setState({ kind: "ended", reason });
          } else if (response.status === 401 && isContextRequired(payload)) {
            setState({ kind: "entry" });
          } else {
            setState({
              failure: failureFrom(
                payload,
                "角色上下文暂时无法确认，请稍后安全重试。",
              ),
              kind: "readonly",
            });
          }
          return;
        }
        finishWithContext(payload as RoleContextReadyResponse);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setState({
          failure: { message: "角色上下文暂时无法确认，请稍后安全重试。" },
          kind: "readonly",
        });
      }
    },
    [finishWithContext],
  );

  useEffect(() => {
    const parsed = parseWebRoute(window.location.href);
    setRoute(parsed);
    if (parsed.status === "matched" && parsed.needsReplace) {
      router.replace(parsed.canonicalUrl);
    }
  }, [pathname, router, search]);

  useEffect(() => {
    const controller = new AbortController();
    void loadContext(controller.signal);
    return () => controller.abort();
  }, [loadContext]);

  const recoverToServerHome = useCallback(
    async (
      context: RoleContextReadyResponse,
      mode: "canonical" | "switch-outcome-unknown",
    ) => {
      if (recoveryPendingRef.current) return;
      recoveryPendingRef.current = true;
      setSwitching(true);
      setSwitchError("");
      try {
        const response = await fetch("/api/v1/demo/context/refresh", {
          body: JSON.stringify(
            mode === "switch-outcome-unknown"
              ? { mode, pageContextVersion: context.contextVersion }
              : { mode },
          ),
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": context.csrfToken,
          },
          method: "POST",
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const reason = sandboxEndReason(payload);
          if (response.status === 401 && reason) {
            setState({ kind: "ended", reason });
          } else if (response.status >= 500) {
            setState({
              failure: failureFrom(
                payload,
                "服务暂时不可用，未猜测任何角色切换结果。",
              ),
              kind: "readonly",
            });
          } else {
            setSwitchError(
              failureFrom(payload, "无法确认服务端当前角色，请安全重试。")
                .message,
            );
          }
          return;
        }
        const recovered = payload as RoleContextReadyResponse;
        setState(
          recovered.role.id === role
            ? { context: recovered, kind: "ready" }
            : { kind: "checking" },
        );
        router.replace(roleHomePath(recovered.role.id));
      } catch {
        setSwitchError("无法确认服务端当前角色，旧上下文继续保持阻断。");
      } finally {
        recoveryPendingRef.current = false;
        setSwitching(false);
      }
    },
    [role, router],
  );

  useEffect(() => {
    if (state.kind !== "mismatch" || !("BroadcastChannel" in window)) {
      return undefined;
    }
    const channel = new BroadcastChannel("jingshu-role-context-v1");
    channel.onmessage = (
      event: MessageEvent<{ contextVersion?: number; type?: string }>,
    ) => {
      if (event.data?.type === "sandbox-reset") {
        setState({ kind: "ended", reason: "reset" });
      } else if (
        typeof event.data?.contextVersion === "number" &&
        event.data.contextVersion > state.context.contextVersion
      ) {
        void recoverToServerHome(state.context, "canonical");
      }
    };
    return () => channel.close();
  }, [recoverToServerHome, state]);

  async function createSandbox(selectedRole: PublicRole, key: string) {
    setState({ kind: "creating", role: selectedRole });
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );
    try {
      const visitorResponse = await fetch("/api/v1/public/visitor", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!visitorResponse.ok) {
        const payload: unknown = await visitorResponse.json().catch(() => null);
        setState({
          failure: failureFrom(payload, "访客上下文无法建立，请稍后安全重试。"),
          kind: "readonly",
        });
        return;
      }
      const response = await fetch("/api/v1/public/sandboxes", {
        body: JSON.stringify({ role: selectedRole }),
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        method: "POST",
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = failureFrom(
          payload,
          "演示世界创建失败，未保存部分数据；你可以安全重试。",
        );
        setState(
          response.status >= 500
            ? { failure, kind: "readonly" }
            : {
                failure,
                kind: "failure",
                requestKind: "error",
                retry: { key, role: selectedRole },
              },
        );
        return;
      }
      const existing = await requestExistingRoleContext(controller.signal);
      if (!existing.response.ok) {
        setState({
          failure: failureFrom(
            existing.payload,
            "沙箱已创建，但角色上下文暂时无法确认。",
          ),
          kind: "readonly",
        });
        return;
      }
      const context = existing.payload as RoleContextReadyResponse;
      if (context.role.id === role) {
        setState({ context, kind: "ready" });
      } else {
        router.replace(roleHomePath(context.role.id));
      }
    } catch (error) {
      const timedOut =
        error instanceof DOMException && error.name === "AbortError";
      setState({
        failure: {
          message: timedOut
            ? "创建结果仍在确认中，请使用原请求重试。"
            : "演示世界创建失败，未保存部分数据；你可以安全重试。",
        },
        kind: "failure",
        requestKind: timedOut ? "timeout" : "error",
        retry: { key, role: selectedRole },
      });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function confirmSwitch(context: RoleContextReadyResponse) {
    setSwitching(true);
    setSwitchError("");
    try {
      const response = await fetch("/api/v1/demo/context/switch", {
        body: JSON.stringify({ targetRole: role }),
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": context.csrfToken,
        },
        method: "POST",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const error = (payload as ApiErrorResponse | null)?.error;
        if (error?.code === "ROLE_CONTEXT_STALE") {
          await recoverToServerHome(context, "canonical");
        } else if (error?.code === "ROLE_CONTEXT_SWITCH_FAILED") {
          await recoverToServerHome(context, "switch-outcome-unknown");
        } else if (
          error?.code === "ROLE_CONTEXT_REQUIRED" ||
          error?.code === "ROLE_CONTEXT_UNAVAILABLE"
        ) {
          const reason = sandboxEndReason(payload);
          setState(reason ? { kind: "ended", reason } : { kind: "entry" });
        } else {
          setSwitchError(error?.message ?? "角色切换失败，请稍后安全重试。");
        }
        return;
      }
      setState({ context: payload as RoleContextReadyResponse, kind: "ready" });
    } catch {
      await recoverToServerHome(context, "switch-outcome-unknown");
    } finally {
      setSwitching(false);
    }
  }

  const routeIntent = useMemo(() => {
    if (route.status === "not-found") {
      return { heading: `${roleMeta[role].label}页面`, role };
    }
    return { heading: webRouteMetadata(route.routeId).heading, role };
  }, [role, route]);
  const resolvedBoundary = useMemo(() => routeBoundary(route), [route]);
  const customerRoute = useMemo(() => customerRouteFor(route), [route]);

  if (state.kind === "checking") return <CheckingView role={role} />;
  if (state.kind === "creating") return <CreationProgress role={state.role} />;
  if (state.kind === "entry") {
    return (
      <PublicEntry
        onCreate={(selectedRole) => {
          const key = createBrowserUuid();
          void createSandbox(selectedRole, key);
        }}
        target={routeIntent}
      />
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
          const key = createBrowserUuid();
          void createSandbox(role, key);
        }}
        onReturn={() => setState({ kind: "entry" })}
        reason={state.reason}
      />
    );
  }
  if (state.kind === "failure") {
    return (
      <FailureView
        failure={state.failure}
        kind={state.requestKind}
        onBack={() => setState({ kind: "entry" })}
        onRetry={() => void createSandbox(state.retry.role, state.retry.key)}
      />
    );
  }
  if (state.kind === "mismatch") {
    return (
      <RoleMismatchView
        context={state.context}
        error={switchError}
        onCancel={() => router.replace(roleHomePath(state.context.role.id))}
        onConfirm={() => void confirmSwitch(state.context)}
        switching={switching}
        targetRole={role}
      />
    );
  }

  return (
    <>
      <RoleContextShell
        {...(customerRoute ? { customerRoute } : {})}
        context={state.context}
        initialPage={
          route.status === "matched"
            ? pageForRoute(role, route.routeId)
            : roleMeta[role].defaultPage
        }
        onContextChange={(context) =>
          setState(
            context.role.id === role
              ? { context, kind: "ready" }
              : { kind: "checking" },
          )
        }
        onContextRequired={() => setState({ kind: "entry" })}
        onContextUnavailable={(reason) => setState({ kind: "ended", reason })}
        onRoleHomeRequired={(context) =>
          router.replace(roleHomePath(context.role.id))
        }
        onServiceUnavailable={(failure) =>
          setState({ failure, kind: "readonly" })
        }
        {...(resolvedBoundary ? { routeBoundary: resolvedBoundary } : {})}
      />
      <div hidden>{children}</div>
    </>
  );
}

export function RoleRouteLayout({
  children,
  role,
}: {
  children: ReactNode;
  role: PublicRole;
}) {
  return (
    <Suspense fallback={<CheckingView role={role} />}>
      <RoleRouteLayoutClient role={role}>{children}</RoleRouteLayoutClient>
    </Suspense>
  );
}
