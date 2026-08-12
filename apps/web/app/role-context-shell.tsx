"use client";

import Image from "next/image";
import {
  ArrowCounterClockwise,
  ArrowClockwise,
  CaretDown,
  Clock,
  ListChecks,
  Pulse,
  Repeat,
  SidebarSimple,
  User,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type {
  DemoTimeAdvancedResponse,
  DemoStoryResponse,
  DemoStoryStepId,
  PublicRole,
  RoleContextReadyResponse,
  SandboxEndReason,
  SandboxResetReadyResponse,
} from "@jingshu/contracts";

import jingshuMark from "../../../product-ui/management-system/design-prototype/public/assets/jingshu-mark.png";
import { DemoTimeDialog, SandboxResetDialog } from "./demo-tool-dialogs";
import { DemoStoryDrawer } from "./demo-story-drawer";
import { RoleSwitchDialog, StaleRoleDialog } from "./role-context-dialogs";
import { roleMeta, type RolePageId } from "./role-context-model";
import { RoleWorkbench, type StaffReservationPreset } from "./role-workbench";
import { CustomerSeatBrowser } from "./customer-seat-browser";
import { StaffOrderFulfillment } from "./staff-order-fulfillment";
import { StoreInventory } from "./store-inventory";
import { StaffRepairQueue } from "./staff-repair-queue";
import { StaffShiftAttendance } from "./staff-shift-attendance";
import {
  HeadquartersStoreConfiguration,
  ManagerStoreConfiguration,
} from "./manager-store-configuration";
import {
  HeadquartersPeopleSchedule,
  ManagerPeopleSchedule,
} from "./manager-people-schedule";
import { ManagerDashboard } from "./manager-dashboard";
import { ManagerAuditExport } from "./manager-audit-export";
import { HeadquartersCatalogs } from "./headquarters-catalogs";
import { HeadquartersComparison } from "./headquarters-comparison";
import {
  type AuthoritativeRefreshResult,
  type RealtimeConnectionMode,
  useSandboxRealtime,
} from "./sandbox-realtime";

const narrowWorkbenchQuery = "(max-width: 960px)";

const realtimeStatusCopy = {
  manual: {
    detail: "自动更新暂不可用；请手动从服务端重新读取。",
    label: "需手动刷新",
  },
  polling: {
    detail: "实时连接不可用，当前使用短轮询重新读取权威状态。",
    label: "轮询更新",
  },
  realtime: {
    detail: "连接正常；收到失效通知后会从服务端重新读取。",
    label: "实时更新",
  },
  reconnecting: {
    detail: "正在重新连接；当前不会把缓存包装成新数据。",
    label: "正在重新连接",
  },
} as const satisfies Record<
  RealtimeConnectionMode,
  { readonly detail: string; readonly label: string }
>;

type ContextRefreshSource =
  "business-time" | "manual" | "polling" | "realtime" | "replay";

type StoryNavigation =
  | {
      readonly kind: "page";
      readonly page: RolePageId;
      readonly role: PublicRole;
    }
  | { readonly kind: "reset" }
  | { readonly kind: "time" };

const storyNavigation: Record<DemoStoryStepId, StoryNavigation> = {
  "business-time-advanced": { kind: "time" },
  "headquarters-exported": {
    kind: "page",
    page: "store-compare",
    role: "hq",
  },
  "order-fulfilled": { kind: "page", page: "orders", role: "staff" },
  "order-paid": { kind: "page", page: "customer-orders", role: "customer" },
  "repair-created": {
    kind: "page",
    page: "customer-repairs",
    role: "customer",
  },
  "repair-resolved": { kind: "page", page: "repairs", role: "staff" },
  "repair-verified": {
    kind: "page",
    page: "manager-repairs",
    role: "manager",
  },
  "reservation-arrived": { kind: "page", page: "workbench", role: "staff" },
  "reservation-created": {
    kind: "page",
    page: "customer-home",
    role: "customer",
  },
  "reservation-in-use": { kind: "page", page: "workbench", role: "staff" },
  "reservation-paid": {
    kind: "page",
    page: "customer-reservations",
    role: "customer",
  },
  "sandbox-reset": { kind: "reset" },
};

function unavailableSandboxReason(
  error:
    | {
        sandboxEndReason?: SandboxEndReason;
      }
    | undefined,
): SandboxEndReason | undefined {
  const reason = error?.sandboxEndReason;
  return reason === "expired" || reason === "reset" ? reason : undefined;
}

function sandboxWasRotated(
  current: RoleContextReadyResponse,
  next: RoleContextReadyResponse,
) {
  return Boolean(
    current.sandbox.fingerprint &&
    next.sandbox.fingerprint &&
    current.sandbox.fingerprint !== next.sandbox.fingerprint,
  );
}

function Brand() {
  return (
    <div className="shell-brand" aria-label="竞枢 Jingshu Arena">
      <Image
        aria-hidden="true"
        alt=""
        priority
        src={jingshuMark}
        width={34}
        height={34}
      />
      <span>
        <strong>竞枢</strong>
        <small>JINGSHU ARENA</small>
      </span>
    </div>
  );
}

function formatShanghaiTimestamp(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function formatShanghaiTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function BusinessTimeButton({
  currentTime,
  observedAt,
  onOpen,
  triggerRef,
}: {
  currentTime: string;
  observedAt: string;
  onOpen: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const [wallTime, setWallTime] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setWallTime(Date.now());
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedMilliseconds =
    wallTime === null ? 0 : Math.max(0, wallTime - Date.parse(observedAt));
  const liveBusinessTime = new Date(
    Date.parse(currentTime) + elapsedMilliseconds,
  ).toISOString();
  const label = formatShanghaiTime(liveBusinessTime);

  return (
    <button
      aria-label={`打开业务时间工具，当前 ${label}`}
      className="role-business-time"
      onClick={onOpen}
      ref={triggerRef}
      type="button"
    >
      <Clock />
      <span>业务时间</span> <strong>{label}</strong>
    </button>
  );
}

function ContextPage({
  context,
  pageLabel,
}: {
  context: RoleContextReadyResponse;
  pageLabel: string;
}) {
  return (
    <main className="role-context-page">
      <span className="shell-eyebrow">{context.role.label} · 获授权范围</span>
      <h1>{pageLabel}</h1>
      <p>
        当前页面沿用共享角色框架。服务端上下文只允许{" "}
        {context.persona.displayName} 在“{context.storeScope.label}
        ”范围内使用已授予能力。
      </p>
      <div className="role-context-facts">
        <section>
          <small>演示人物</small>
          <strong>{context.persona.displayName} · 虚构人物</strong>
        </section>
        <section>
          <small>业务角色</small>
          <strong>{context.role.label}</strong>
        </section>
        <section>
          <small>门店范围</small>
          <strong>{context.storeScope.label}</strong>
        </section>
        <section>
          <small>上下文版本</small>
          <strong>第 {context.contextVersion} 版</strong>
        </section>
      </div>
      <section className="role-capability-panel">
        <h2>当前能力边界</h2>
        <ul>
          {context.capabilities.map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>
        <p>
          页面可见性只用于说明；服务端会以当前沙箱、角色、门店和目标对象重新执行能力检查。
        </p>
      </section>
    </main>
  );
}

export function RoleContextShell({
  context,
  initialPage,
  onContextChange,
  onContextRequired,
  onContextUnavailable,
  onServiceUnavailable,
}: {
  context: RoleContextReadyResponse;
  initialPage?: RolePageId;
  onContextChange: (context: RoleContextReadyResponse) => void;
  onContextRequired: () => void;
  onContextUnavailable: (reason: SandboxEndReason) => void;
  onServiceUnavailable: (failure: {
    message: string;
    requestId?: string;
  }) => void;
}) {
  const [activePage, setActivePage] = useState<RolePageId>(
    initialPage ?? roleMeta[context.role.id].defaultPage,
  );
  const [filter, setFilter] = useState("");
  const [reservationFiltersDirty, setReservationFiltersDirty] = useState(false);
  const [reservationPreset, setReservationPreset] =
    useState<StaffReservationPreset>({});
  const [managerLiveMode, setManagerLiveMode] = useState<
    "reservations" | "workbench"
  >("workbench");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [demoToolDialog, setDemoToolDialog] = useState<"reset" | "time" | null>(
    null,
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [stale, setStale] = useState(false);
  const [staleReason, setStaleReason] = useState<"reset" | "role">("role");
  const [toolPanel, setToolPanel] = useState<"life" | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);
  const [storyCompletedCount, setStoryCompletedCount] = useState<number | null>(
    null,
  );
  const [customerSandboxVersion, setCustomerSandboxVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [authoritativeRefreshPending, setAuthoritativeRefreshPending] =
    useState(false);
  const [authoritativeRefreshVersion, setAuthoritativeRefreshVersion] =
    useState(0);
  const [toast, setToast] = useState("");
  const roleTriggerRef = useRef<HTMLButtonElement>(null);
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const activeRoleTriggerRef = useRef<HTMLButtonElement>(null);
  const storyTriggerRef = useRef<HTMLButtonElement>(null);
  const timeTriggerRef = useRef<HTMLButtonElement>(null);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const recoveryFenceRef = useRef(false);
  const realtimeRefreshCountRef = useRef(0);
  const pendingStoryNavigationRef = useRef<Extract<
    StoryNavigation,
    { readonly kind: "page" }
  > | null>(null);
  const storyPageAfterSwitchRef = useRef<Extract<
    StoryNavigation,
    { readonly kind: "page" }
  > | null>(null);
  const meta = roleMeta[context.role.id];

  const handleContextUnavailable = useCallback(
    (reason: SandboxEndReason | undefined) => {
      if (reason) {
        onContextUnavailable(reason);
        return;
      }
      onContextRequired();
    },
    [onContextRequired, onContextUnavailable],
  );

  useEffect(() => {
    const expiresAt = Date.parse(context.sandbox.expiresAt);
    const observedAt = Date.parse(context.freshness.observedAt);
    if (!Number.isFinite(expiresAt) || !Number.isFinite(observedAt)) {
      return undefined;
    }

    // 仅按服务端签发的寿命差值安排 UI 收束，不以浏览器墙钟裁决访问权；
    // 任一 API 仍会由服务端真实时钟再次拒绝过期上下文。
    const timer = window.setTimeout(
      () => handleContextUnavailable("expired"),
      Math.max(0, expiresAt - observedAt),
    );
    return () => window.clearTimeout(timer);
  }, [
    context.freshness.observedAt,
    context.sandbox.expiresAt,
    handleContextUnavailable,
  ]);

  const beginAuthoritativeRefresh = useCallback(() => {
    realtimeRefreshCountRef.current += 1;
    setAuthoritativeRefreshPending(true);
  }, []);

  const finishAuthoritativeRefresh = useCallback(() => {
    realtimeRefreshCountRef.current = Math.max(
      0,
      realtimeRefreshCountRef.current - 1,
    );
    if (realtimeRefreshCountRef.current === 0) {
      setAuthoritativeRefreshPending(false);
    }
  }, []);

  useEffect(() => {
    const storyPage = storyPageAfterSwitchRef.current;
    setActivePage(initialPage ?? roleMeta[context.role.id].defaultPage);
    if (storyPage?.role === context.role.id) {
      setActivePage(storyPage.page);
      storyPageAfterSwitchRef.current = null;
    }
    setFilter("");
    setReservationFiltersDirty(false);
    setReservationPreset({});
    setManagerLiveMode("workbench");
  }, [context.role.id, initialPage]);

  useEffect(() => {
    if (activePage !== "live-ops") setManagerLiveMode("workbench");
  }, [activePage]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(narrowWorkbenchQuery);
    const closeInspectorOnNarrowViewport = (matches: boolean) => {
      if (matches) setInspectorOpen(false);
    };
    const handleViewportChange = (event: MediaQueryListEvent) => {
      closeInspectorOnNarrowViewport(event.matches);
    };

    closeInspectorOnNarrowViewport(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleViewportChange);
    return () => mediaQuery.removeEventListener("change", handleViewportChange);
  }, []);

  useEffect(() => {
    if (!stale) return;
    setRoleDialogOpen(false);
    setDemoToolDialog(null);
    setToolPanel(null);
    setStoryOpen(false);
    pendingStoryNavigationRef.current = null;
  }, [stale]);

  useEffect(() => {
    const controller = new AbortController();
    setStoryCompletedCount(null);
    void fetch("/api/v1/demo/story", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as DemoStoryResponse;
      })
      .then((story) => {
        if (!controller.signal.aborted && story) {
          setStoryCompletedCount(story.completedCount);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [
    authoritativeRefreshVersion,
    context.contextVersion,
    context.sandbox.fingerprint,
  ]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 3_600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const refreshContext = useCallback(
    async (
      source: ContextRefreshSource = "manual",
    ): Promise<AuthoritativeRefreshResult> => {
      setRefreshing(true);
      try {
        const response = await fetch("/api/v1/demo/context", {
          cache: "no-store",
          credentials: "same-origin",
        });
        const payload: unknown = await response.json();
        if (!response.ok) {
          const failure = payload as {
            error?: {
              code?: string;
              message?: string;
              requestId?: string;
              sandboxEndReason?: SandboxEndReason;
            };
          };
          if (failure.error?.code === "ROLE_CONTEXT_STALE") {
            recoveryFenceRef.current = false;
            setStaleReason("role");
            setStale(true);
            return "stale";
          } else if (
            failure.error?.code === "ROLE_CONTEXT_UNAVAILABLE" ||
            failure.error?.code === "ROLE_CONTEXT_REQUIRED"
          ) {
            handleContextUnavailable(unavailableSandboxReason(failure.error));
            return "unavailable";
          } else if (response.status >= 500) {
            onServiceUnavailable({
              message:
                failure.error?.message ??
                "服务暂时不可用，已切换到只读标准种子快照。",
              ...(failure.error?.requestId
                ? { requestId: failure.error.requestId }
                : {}),
            });
            return "unavailable";
          } else {
            if (source !== "polling") {
              setToast(failure.error?.message ?? "数据刷新失败，请稍后重试。");
            }
            return "failed";
          }
        }
        const nextContext = payload as RoleContextReadyResponse;
        const reset = sandboxWasRotated(context, nextContext);
        if (reset || nextContext.contextVersion !== context.contextVersion) {
          recoveryFenceRef.current = false;
          setStaleReason(reset ? "reset" : "role");
          setStale(true);
          return "stale";
        }
        onContextChange(nextContext);
        setAuthoritativeRefreshVersion((version) => version + 1);
        if (source === "manual") setFilter("");
        setStale(false);
        setStaleReason("role");
        if (source !== "polling" && source !== "realtime") {
          setToast(
            source === "business-time"
              ? "其他标签已推进业务时间，当前视图已从服务端刷新"
              : source === "replay"
                ? "同一请求已安全重放，当前业务时间已从服务端确认"
                : "角色上下文已由服务端手动确认",
          );
        }
        return "updated";
      } catch {
        if (source !== "polling") {
          setToast("数据刷新失败，当前页面不会伪造成功。");
        }
        return "failed";
      } finally {
        if (source === "realtime") finishAuthoritativeRefresh();
        setRefreshing(false);
      }
    },
    [
      context,
      finishAuthoritativeRefresh,
      onContextChange,
      handleContextUnavailable,
      onServiceUnavailable,
    ],
  );

  const realtime = useSandboxRealtime({
    contextVersion: context.contextVersion,
    onInvalidationStart: beginAuthoritativeRefresh,
    observedAt: context.freshness.observedAt,
    refreshAuthoritativeState: refreshContext,
  });

  useEffect(() => {
    if (!("BroadcastChannel" in window)) return undefined;
    const channel = new BroadcastChannel("jingshu-role-context-v1");
    broadcastRef.current = channel;
    channel.onmessage = (
      event: MessageEvent<{ contextVersion?: number; type?: string }>,
    ) => {
      if (event.data?.type === "sandbox-reset") {
        onContextUnavailable("reset");
        return;
      }
      if (event.data?.type === "business-time-advanced") {
        setDemoToolDialog(null);
        void refreshContext("business-time");
        return;
      }
      if (
        typeof event.data?.contextVersion === "number" &&
        event.data.contextVersion > context.contextVersion
      ) {
        recoveryFenceRef.current = false;
        setStaleReason("role");
        setStale(true);
      }
    };
    return () => {
      broadcastRef.current = null;
      channel.close();
    };
  }, [context.contextVersion, onContextUnavailable, refreshContext]);

  async function recoverContext() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/v1/demo/context/refresh", {
        body: JSON.stringify(
          recoveryFenceRef.current
            ? {
                mode: "switch-outcome-unknown",
                pageContextVersion: context.contextVersion,
              }
            : { mode: "canonical" },
        ),
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": context.csrfToken,
        },
        method: "POST",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const failure = payload as {
          error?: {
            code?: string;
            message?: string;
            requestId?: string;
            sandboxEndReason?: SandboxEndReason;
          };
        };
        if (
          failure.error?.code === "ROLE_CONTEXT_UNAVAILABLE" ||
          failure.error?.code === "ROLE_CONTEXT_REQUIRED"
        ) {
          handleContextUnavailable(unavailableSandboxReason(failure.error));
        } else if (response.status >= 500) {
          onServiceUnavailable({
            message:
              failure.error?.message ??
              "服务暂时不可用，已切换到只读标准种子快照。",
            ...(failure.error?.requestId
              ? { requestId: failure.error.requestId }
              : {}),
          });
        } else if (failure.error?.code === "ROLE_CONTEXT_STALE") {
          recoveryFenceRef.current = false;
          setToast("会话凭据已变化，请再次刷新到服务端当前角色。");
        } else {
          setToast(
            failure.error?.message ?? "当前角色恢复失败，请稍后安全重试。",
          );
        }
        return;
      }
      const recovered = payload as RoleContextReadyResponse;
      onContextChange(recovered);
      setFilter("");
      setStale(false);
      setStaleReason("role");
      recoveryFenceRef.current = false;
      setToast("已恢复到服务端当前角色");
      if (recovered.contextVersion > context.contextVersion) {
        broadcastRef.current?.postMessage({
          contextVersion: recovered.contextVersion,
          role: recovered.role.id,
          type: "role-context-changed",
        });
      }
    } catch {
      setToast("当前角色恢复失败，旧上下文仍保持阻断。");
    } finally {
      setRefreshing(false);
    }
  }

  function openRoleDialog(trigger: HTMLButtonElement) {
    pendingStoryNavigationRef.current = null;
    activeRoleTriggerRef.current = trigger;
    setRoleDialogOpen(true);
  }

  function closeRoleDialog() {
    pendingStoryNavigationRef.current = null;
    setRoleDialogOpen(false);
  }

  function acceptSwitchedContext(nextContext: RoleContextReadyResponse) {
    const storyTarget = pendingStoryNavigationRef.current;
    pendingStoryNavigationRef.current = null;
    if (storyTarget?.role === nextContext.role.id) {
      storyPageAfterSwitchRef.current = storyTarget;
    }
    onContextChange(nextContext);
    setFilter("");
    setStale(false);
    setStaleReason("role");
    recoveryFenceRef.current = false;
    setToast(
      `已切换为${nextContext.persona.displayName} · ${nextContext.role.label}`,
    );
    broadcastRef.current?.postMessage({
      contextVersion: nextContext.contextVersion,
      role: nextContext.role.id,
      type: "role-context-changed",
    });
  }

  function acceptAdvancedTime(result: DemoTimeAdvancedResponse) {
    if (result.replayed) {
      void refreshContext("replay");
    } else {
      onContextChange({
        ...context,
        sandbox: {
          ...context.sandbox,
          businessClock: {
            ...result.clock,
            currentTime: result.afterTime,
          },
        },
      });
      setAuthoritativeRefreshVersion((version) => version + 1);
      setToast(
        `业务时间已推进到 ${formatShanghaiTime(result.afterTime)}；沙箱寿命未延长`,
      );
    }
    broadcastRef.current?.postMessage({ type: "business-time-advanced" });
  }

  function openStoryAction(step: DemoStoryStepId) {
    setStoryOpen(false);
    const target = storyNavigation[step];
    if (target.kind === "time") {
      setDemoToolDialog("time");
      return;
    }
    if (target.kind === "reset") {
      setDemoToolDialog("reset");
      return;
    }
    if (target.role === context.role.id) {
      setActivePage(target.page);
      return;
    }
    pendingStoryNavigationRef.current = target;
    activeRoleTriggerRef.current = storyTriggerRef.current;
    setRoleDialogOpen(true);
  }

  function acceptResetSandbox(result: SandboxResetReadyResponse) {
    onContextChange(result.context);
    setAuthoritativeRefreshVersion((version) => version + 1);
    setActivePage(roleMeta[result.context.role.id].defaultPage);
    setFilter("");
    setStale(false);
    setStaleReason("role");
    recoveryFenceRef.current = false;
    setToolPanel(null);
    setStoryOpen(false);
    setStoryCompletedCount(0);
    setCustomerSandboxVersion((version) => version + 1);
    setToast(
      result.context.role.id === "customer"
        ? "已创建全新标准沙箱，并回到顾客主演示起点"
        : `同一重置请求已安全重放，保持服务端当前${result.context.role.label}上下文`,
    );
    broadcastRef.current?.postMessage({
      type: "sandbox-reset",
    });
  }

  const activePageLabel =
    meta.navigation.find(([id]) => id === activePage)?.[1] ?? meta.label;
  const storyCompletedLabel =
    storyCompletedCount === null ? "读取中" : `${storyCompletedCount} / 12`;
  const resourceRefreshKey = `${context.contextVersion}-${context.sandbox.businessClock.currentTime}-${authoritativeRefreshVersion}`;
  const expirationLabel = formatShanghaiTimestamp(context.sandbox.expiresAt);
  const observedAtLabel = formatShanghaiTimestamp(context.freshness.observedAt);
  const modalOpen = roleDialogOpen || demoToolDialog !== null || storyOpen;
  const backgroundProps =
    stale || modalOpen || authoritativeRefreshPending
      ? ({ "aria-hidden": true, inert: true } as const)
      : {};

  return (
    <div
      className={`role-shell ${context.role.id === "customer" ? "is-customer" : ""} ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}
    >
      <header className="role-shell-topbar" {...backgroundProps}>
        <div className="role-topbar-brand">
          <Brand />
          <span className="role-demo-chip">演示数据</span>
          <span className="role-business-day">上海业务时钟&nbsp; 自然流逝</span>
        </div>
        <nav aria-label="共享演示工具" className="role-topbar-tools">
          <button
            aria-label={
              storyCompletedCount === null
                ? "打开主演示清单，正在读取服务端进度"
                : `打开主演示清单，已完成 ${storyCompletedCount} / 12`
            }
            onClick={() => {
              setToolPanel(null);
              setStoryOpen(true);
            }}
            ref={storyTriggerRef}
            type="button"
          >
            <ListChecks />
            <span>主演示</span>
            <strong>{storyCompletedLabel}</strong>
          </button>
          <BusinessTimeButton
            currentTime={context.sandbox.businessClock.currentTime}
            observedAt={context.freshness.observedAt}
            onOpen={() => setDemoToolDialog("time")}
            triggerRef={timeTriggerRef}
          />
          <button
            aria-label="切换角色"
            onClick={(event) => openRoleDialog(event.currentTarget)}
            ref={roleTriggerRef}
            type="button"
          >
            <Repeat />
            <span>切换角色</span>
          </button>
          <button
            aria-label="重置为全新标准沙箱"
            onClick={() => setDemoToolDialog("reset")}
            ref={resetTriggerRef}
            type="button"
          >
            <ArrowCounterClockwise />
            <span>重置沙箱</span>
          </button>
          <button
            aria-label="手动刷新角色上下文"
            disabled={refreshing}
            onClick={() => {
              realtime.reconnect();
              void refreshContext();
            }}
            type="button"
          >
            <ArrowClockwise />
            <span>{refreshing ? "刷新中" : "手动刷新"}</span>
          </button>
          <span
            aria-label={`数据更新状态：${realtimeStatusCopy[realtime.state.mode].label}。${realtimeStatusCopy[realtime.state.mode].detail}`}
            className={`role-realtime-status is-${realtime.state.mode}`}
            role="status"
          >
            <Pulse weight="duotone" />
            <span>{realtimeStatusCopy[realtime.state.mode].label}</span>
          </span>
        </nav>
        <button
          aria-label={`${context.persona.displayName} ${context.role.label} ${context.storeScope.label}，打开角色切换`}
          className="role-profile-menu"
          onClick={(event) => openRoleDialog(event.currentTarget)}
          ref={profileTriggerRef}
          type="button"
        >
          <span>
            <User weight="fill" />
          </span>
          <span>
            <strong>{context.persona.displayName} · 虚构人物</strong>
            <small>
              {context.role.label}｜{context.storeScope.label}
            </small>
          </span>
          <CaretDown />
        </button>
      </header>

      {toolPanel === "life" ? (
        <div className="role-tool-panel" role="status" {...backgroundProps}>
          <Clock />
          <span>
            <strong>沙箱生命周期</strong> 预计 {expirationLabel}{" "}
            到期；业务时间推进不会延长寿命。
          </span>
          <button
            aria-label="关闭信息"
            onClick={() => setToolPanel(null)}
            type="button"
          >
            <X />
          </button>
        </div>
      ) : null}

      <div className="role-shell-body" {...backgroundProps}>
        <aside className="role-sidebar" data-testid="role-sidebar">
          <div className="role-sidebar-context">
            <span>
              <User weight="fill" />
            </span>
            <span>
              <strong>{context.storeScope.label}</strong>
              <small>{context.role.label}</small>
            </span>
          </div>
          <nav aria-label={`${context.role.label}导航`}>
            {meta.navigation.map(([id, label, Icon]) => (
              <button
                aria-label={label}
                className={activePage === id ? "is-active" : ""}
                data-label={label}
                key={id}
                onClick={() => setActivePage(id)}
                type="button"
              >
                <Icon weight="regular" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="role-sidebar-footer">
            <button
              className="role-sandbox-life"
              onClick={() => setToolPanel("life")}
              type="button"
            >
              <Clock />
              <span>
                <small>沙箱到期</small>
                <strong>{expirationLabel}</strong>
              </span>
            </button>
            <button
              aria-label={sidebarCollapsed ? "展开导航" : "折叠导航"}
              className="shell-icon-button role-sidebar-toggle"
              onClick={() => setSidebarCollapsed((value) => !value)}
              type="button"
            >
              <SidebarSimple />
            </button>
          </div>
        </aside>
        <section className="role-workspace">
          {context.role.id === "customer" &&
          (activePage === "customer-home" ||
            activePage === "customer-reservations" ||
            activePage === "customer-orders" ||
            activePage === "customer-repairs") ? (
            <CustomerSeatBrowser
              csrfToken={context.csrfToken}
              entryPage={activePage}
              key={`customer-sandbox-${customerSandboxVersion}`}
              refreshKey={resourceRefreshKey}
            />
          ) : context.role.id === "manager" &&
            activePage === "store-dashboard" ? (
            <ManagerDashboard
              onNavigateAudit={() => setActivePage("store-audit")}
              onNavigateInventory={() => setActivePage("manager-inventory")}
              onNavigatePeople={() => setActivePage("people-schedule")}
              onNavigateRepairs={() => setActivePage("manager-repairs")}
              onNavigateReservations={() => {
                setManagerLiveMode("reservations");
                setActivePage("live-ops");
              }}
              refreshKey={resourceRefreshKey}
            />
          ) : context.role.id === "staff" && activePage === "shift" ? (
            <StaffShiftAttendance
              csrfToken={context.csrfToken}
              onToast={setToast}
              refreshKey={resourceRefreshKey}
            />
          ) : context.role.id === "staff" && activePage === "orders" ? (
            <StaffOrderFulfillment
              csrfToken={context.csrfToken}
              filter={filter}
              inspectorOpen={inspectorOpen}
              onFilter={setFilter}
              onFilterDirty={setReservationFiltersDirty}
              onInspector={setInspectorOpen}
              onToast={setToast}
              refreshKey={resourceRefreshKey}
            />
          ) : (context.role.id === "staff" && activePage === "repairs") ||
            (context.role.id === "manager" &&
              activePage === "manager-repairs") ? (
            <StaffRepairQueue
              csrfToken={context.csrfToken}
              onNavigateManagerAudit={() => setActivePage("store-audit")}
              onNavigateManagerDashboard={() =>
                setActivePage("store-dashboard")
              }
              onToast={setToast}
              refreshKey={resourceRefreshKey}
              role={context.role.id}
            />
          ) : context.role.id === "manager" &&
            activePage === "people-schedule" ? (
            <ManagerPeopleSchedule
              csrfToken={context.csrfToken}
              onToast={setToast}
              refreshKey={resourceRefreshKey}
            />
          ) : context.role.id === "manager" && activePage === "store-audit" ? (
            <ManagerAuditExport
              csrfToken={context.csrfToken}
              onToast={setToast}
              refreshKey={resourceRefreshKey}
            />
          ) : context.role.id === "hq" &&
            (activePage === "chain-dashboard" ||
              activePage === "store-compare") ? (
            <HeadquartersComparison
              onNavigateAudit={() => setActivePage("hq-audit")}
              onNavigateCompare={() => setActivePage("store-compare")}
              page={activePage === "chain-dashboard" ? "chain" : "compare"}
              refreshKey={resourceRefreshKey}
            />
          ) : context.role.id === "hq" && activePage === "hq-audit" ? (
            <ManagerAuditExport
              csrfToken={context.csrfToken}
              onToast={setToast}
              refreshKey={resourceRefreshKey}
              scope="headquarters"
            />
          ) : context.role.id === "hq" && activePage === "chain-config" ? (
            <HeadquartersCatalogs
              csrfToken={context.csrfToken}
              onToast={setToast}
              refreshKey={resourceRefreshKey}
            />
          ) : context.role.id === "hq" && activePage === "hq-people" ? (
            <HeadquartersPeopleSchedule refreshKey={resourceRefreshKey} />
          ) : context.role.id === "hq" && activePage === "hq-store-config" ? (
            <HeadquartersStoreConfiguration
              csrfToken={context.csrfToken}
              onToast={setToast}
              refreshKey={resourceRefreshKey}
            />
          ) : (context.role.id === "staff" && activePage === "inventory") ||
            (context.role.id === "manager" &&
              activePage === "manager-inventory") ? (
            <StoreInventory
              csrfToken={context.csrfToken}
              onToast={setToast}
              refreshKey={resourceRefreshKey}
              role={context.role.id}
            />
          ) : context.role.id === "manager" && activePage === "store-config" ? (
            <ManagerStoreConfiguration
              csrfToken={context.csrfToken}
              onNavigateRepairs={() => setActivePage("manager-repairs")}
              onNavigateReservations={() => {
                setManagerLiveMode("reservations");
                setActivePage("live-ops");
              }}
              onToast={setToast}
              refreshKey={resourceRefreshKey}
            />
          ) : (context.role.id === "staff" &&
              (activePage === "workbench" || activePage === "reservations")) ||
            (context.role.id === "manager" && activePage === "live-ops") ? (
            <RoleWorkbench
              csrfToken={context.csrfToken}
              filter={filter}
              inspectorOpen={inspectorOpen}
              onFilter={setFilter}
              onFilterDirty={setReservationFiltersDirty}
              onInspector={setInspectorOpen}
              onNavigateReservations={(preset) => {
                setReservationPreset(preset);
                setFilter("");
                if (context.role.id === "manager") {
                  setManagerLiveMode("reservations");
                } else {
                  setActivePage("reservations");
                }
              }}
              {...(context.role.id === "staff"
                ? { onNavigateShift: () => setActivePage("shift" as const) }
                : {})}
              onNavigateWorkbench={() => {
                setReservationPreset({});
                setFilter("");
                if (context.role.id === "manager") {
                  setManagerLiveMode("workbench");
                } else {
                  setActivePage("workbench");
                }
              }}
              onToast={setToast}
              page={
                context.role.id === "manager"
                  ? managerLiveMode
                  : activePage === "reservations"
                    ? "reservations"
                    : "workbench"
              }
              preset={reservationPreset}
              refreshKey={resourceRefreshKey}
            />
          ) : (
            <ContextPage context={context} pageLabel={activePageLabel} />
          )}
        </section>
      </div>
      <footer className="role-shell-statusbar" {...backgroundProps}>
        <span>
          <Pulse />
          <strong>{realtimeStatusCopy[realtime.state.mode].label}</strong>
        </span>
        <span>
          第 {context.contextVersion} 版 · {context.storeScope.label}
        </span>
        <span>服务器确认于 {observedAtLabel}</span>
      </footer>

      {authoritativeRefreshPending && !stale ? (
        <div
          aria-live="assertive"
          className="role-authority-refresh-fence"
          role="status"
        >
          <Pulse weight="duotone" />
          正在确认服务端当前上下文；暂时停止写操作。
        </div>
      ) : null}

      {storyOpen && !stale && !authoritativeRefreshPending ? (
        <DemoStoryDrawer
          onClose={() => setStoryOpen(false)}
          onLoaded={setStoryCompletedCount}
          onNextAction={openStoryAction}
          onStale={() => {
            setStaleReason("role");
            setStale(true);
          }}
          onUnavailable={handleContextUnavailable}
          refreshKey={authoritativeRefreshVersion}
          returnFocusRef={storyTriggerRef}
        />
      ) : null}

      {roleDialogOpen && !stale && !authoritativeRefreshPending ? (
        <RoleSwitchDialog
          context={context}
          dirty={filter.length > 0 || reservationFiltersDirty}
          onClose={closeRoleDialog}
          onStale={(reason) => {
            recoveryFenceRef.current = reason === "switch-outcome-unknown";
            setStaleReason("role");
            setStale(true);
          }}
          onSwitch={acceptSwitchedContext}
          onUnavailable={handleContextUnavailable}
          returnFocusRef={activeRoleTriggerRef}
        />
      ) : null}

      {demoToolDialog === "time" && !stale && !authoritativeRefreshPending ? (
        <DemoTimeDialog
          context={context}
          onAdvanced={acceptAdvancedTime}
          onClose={() => setDemoToolDialog(null)}
          onStale={() => {
            setStaleReason("role");
            setStale(true);
          }}
          onUnavailable={handleContextUnavailable}
          returnFocusRef={timeTriggerRef}
        />
      ) : null}

      {demoToolDialog === "reset" && !stale && !authoritativeRefreshPending ? (
        <SandboxResetDialog
          context={context}
          onClose={() => setDemoToolDialog(null)}
          onReset={acceptResetSandbox}
          onStale={() => {
            setStaleReason("role");
            setStale(true);
          }}
          onUnavailable={handleContextUnavailable}
          returnFocusRef={resetTriggerRef}
        />
      ) : null}

      {stale ? (
        <StaleRoleDialog
          dirty={filter.length > 0}
          onRefresh={() => void recoverContext()}
          reason={staleReason}
          refreshing={refreshing}
          returnFocusRef={roleTriggerRef}
        />
      ) : null}

      {toast ? (
        <div className="role-toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
