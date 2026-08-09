"use client";

import Image from "next/image";
import {
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
import { useEffect, useRef, useState } from "react";
import type { RoleContextReadyResponse } from "@jingshu/contracts";

import jingshuMark from "../../../product-ui/management-system/design-prototype/public/assets/jingshu-mark.png";
import { RoleSwitchDialog, StaleRoleDialog } from "./role-context-dialogs";
import { roleMeta, type RolePageId } from "./role-context-model";
import { RoleWorkbench } from "./role-workbench";

function Brand() {
  return (
    <div className="shell-brand" aria-label="竞枢 Jingshu Arena">
      <Image
        aria-hidden="true"
        alt=""
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
  onContextChange,
  onContextUnavailable,
}: {
  context: RoleContextReadyResponse;
  onContextChange: (context: RoleContextReadyResponse) => void;
  onContextUnavailable: () => void;
}) {
  const [activePage, setActivePage] = useState<RolePageId>(
    roleMeta[context.role.id].defaultPage,
  );
  const [filter, setFilter] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [stale, setStale] = useState(false);
  const [toolPanel, setToolPanel] = useState<"life" | "story" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState("");
  const roleTriggerRef = useRef<HTMLButtonElement>(null);
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const activeRoleTriggerRef = useRef<HTMLButtonElement>(null);
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const recoveryFenceRef = useRef(false);
  const meta = roleMeta[context.role.id];

  useEffect(() => {
    setActivePage(roleMeta[context.role.id].defaultPage);
    setFilter("");
  }, [context.role.id]);

  useEffect(() => {
    if (!stale) return;
    setRoleDialogOpen(false);
    setToolPanel(null);
  }, [stale]);

  useEffect(() => {
    if (!("BroadcastChannel" in window)) return undefined;
    const channel = new BroadcastChannel("jingshu-role-context-v1");
    broadcastRef.current = channel;
    channel.onmessage = (event: MessageEvent<{ contextVersion?: number }>) => {
      if (
        typeof event.data?.contextVersion === "number" &&
        event.data.contextVersion > context.contextVersion
      ) {
        recoveryFenceRef.current = false;
        setStale(true);
      }
    };
    return () => {
      broadcastRef.current = null;
      channel.close();
    };
  }, [context.contextVersion]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 3_600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function refreshContext() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/v1/demo/context", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const failure = payload as {
          error?: { code?: string; message?: string };
        };
        if (failure.error?.code === "ROLE_CONTEXT_STALE") {
          recoveryFenceRef.current = false;
          setStale(true);
        } else if (
          failure.error?.code === "ROLE_CONTEXT_UNAVAILABLE" ||
          failure.error?.code === "ROLE_CONTEXT_REQUIRED"
        ) {
          onContextUnavailable();
        } else {
          setToast(failure.error?.message ?? "数据刷新失败，请稍后重试。");
        }
        return;
      }
      onContextChange(payload as RoleContextReadyResponse);
      setFilter("");
      setStale(false);
      setToast("角色上下文已由服务端手动确认");
    } catch {
      setToast("数据刷新失败，当前页面不会伪造成功。");
    } finally {
      setRefreshing(false);
    }
  }

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
          error?: { code?: string; message?: string };
        };
        if (
          failure.error?.code === "ROLE_CONTEXT_UNAVAILABLE" ||
          failure.error?.code === "ROLE_CONTEXT_REQUIRED"
        ) {
          onContextUnavailable();
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
    activeRoleTriggerRef.current = trigger;
    setRoleDialogOpen(true);
  }

  function acceptSwitchedContext(nextContext: RoleContextReadyResponse) {
    onContextChange(nextContext);
    setFilter("");
    setStale(false);
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

  const activePageLabel =
    meta.navigation.find(([id]) => id === activePage)?.[1] ?? meta.label;
  const expirationLabel = formatShanghaiTimestamp(context.sandbox.expiresAt);
  const observedAtLabel = formatShanghaiTimestamp(context.freshness.observedAt);
  const backgroundProps = stale
    ? ({ "aria-hidden": true, inert: true } as const)
    : {};

  return (
    <div
      className={`role-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}
    >
      <header className="role-shell-topbar" {...backgroundProps}>
        <div className="role-topbar-brand">
          <Brand />
          <span className="role-demo-chip">演示数据</span>
          <span className="role-business-day">
            经营日预览&nbsp; 08月08日 06:00–次日05:59
          </span>
        </div>
        <nav aria-label="共享演示工具" className="role-topbar-tools">
          <button onClick={() => setToolPanel("story")} type="button">
            <ListChecks />
            <span>主演示</span>
            <strong>路线预览</strong>
          </button>
          <span className="role-business-time">
            <Clock />
            业务时间预览 <strong>19:30</strong>
          </span>
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
            aria-label="手动刷新角色上下文"
            disabled={refreshing}
            onClick={() => void refreshContext()}
            type="button"
          >
            <ArrowClockwise />
            <span>{refreshing ? "刷新中" : "手动刷新"}</span>
          </button>
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

      {toolPanel ? (
        <div className="role-tool-panel" role="status" {...backgroundProps}>
          {toolPanel === "story" ? (
            <>
              <ListChecks />
              <span>
                <strong>主演示路线预览</strong>{" "}
                当前只展示跨角色入口；服务端业务事件进度由 ticket 29
                接入后显示。
              </span>
            </>
          ) : (
            <>
              <Clock />
              <span>
                <strong>沙箱生命周期</strong> 预计 {expirationLabel}{" "}
                到期；业务时间推进不会延长寿命。
              </span>
            </>
          )}
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
          {context.role.id === "staff" && activePage === "workbench" ? (
            <RoleWorkbench
              filter={filter}
              inspectorOpen={inspectorOpen}
              onFilter={setFilter}
              onInspector={setInspectorOpen}
              onPreviewAction={() =>
                setToast(
                  "当前为界面参考任务；服务端办理到店由 ticket 09 接入。",
                )
              }
            />
          ) : (
            <ContextPage context={context} pageLabel={activePageLabel} />
          )}
        </section>
      </div>
      <footer className="role-shell-statusbar" {...backgroundProps}>
        <span>
          <Pulse />
          <strong>服务端角色上下文</strong>
        </span>
        <span>
          第 {context.contextVersion} 版 · {context.storeScope.label}
        </span>
        <span>手动确认于 {observedAtLabel}</span>
      </footer>

      {roleDialogOpen && !stale ? (
        <RoleSwitchDialog
          context={context}
          dirty={filter.length > 0}
          onClose={() => setRoleDialogOpen(false)}
          onStale={(reason) => {
            recoveryFenceRef.current = reason === "switch-outcome-unknown";
            setStale(true);
          }}
          onSwitch={acceptSwitchedContext}
          onUnavailable={onContextUnavailable}
          returnFocusRef={activeRoleTriggerRef}
        />
      ) : null}

      {stale ? (
        <StaleRoleDialog
          dirty={filter.length > 0}
          onRefresh={() => void recoverContext()}
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
