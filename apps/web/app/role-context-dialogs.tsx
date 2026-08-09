"use client";

import { ArrowRight, Info, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type {
  ApiErrorResponse,
  PublicRole,
  RoleContextReadyResponse,
} from "@jingshu/contracts";

import { roleMeta } from "./role-context-model";

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    ),
  );
}

function useDialogKeyboard({
  containerRef,
  onEscape,
  returnFocusRef,
}: {
  containerRef: RefObject<HTMLElement | null>;
  onEscape: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  useEffect(() => {
    const container = containerRef.current;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== "Tab" || !container) return;
      const focusable = focusableElements(container);
      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!container.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }

    container?.addEventListener("keydown", handleKeyDown);
    return () => container?.removeEventListener("keydown", handleKeyDown);
  }, [containerRef, onEscape]);

  useEffect(() => {
    const returnTarget = returnFocusRef.current;
    return () => returnTarget?.focus();
  }, [returnFocusRef]);
}

export function RoleSwitchDialog({
  context,
  dirty,
  onClose,
  onStale,
  onSwitch,
  onUnavailable,
  returnFocusRef,
}: {
  context: RoleContextReadyResponse;
  dirty: boolean;
  onClose: () => void;
  onStale: (reason: "canonical" | "switch-outcome-unknown") => void;
  onSwitch: (context: RoleContextReadyResponse) => void;
  onUnavailable: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [pendingRole, setPendingRole] = useState<PublicRole | null>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pendingReturnRef = useRef<HTMLButtonElement | null>(null);
  const pendingReturnRoleRef = useRef<PublicRole | null>(null);
  const continueEditingRef = useRef<HTMLButtonElement>(null);

  function closeOrReturn() {
    if (pendingRole) {
      setPendingRole(null);
      return;
    }
    onClose();
  }

  useDialogKeyboard({
    containerRef: dialogRef,
    onEscape: closeOrReturn,
    returnFocusRef,
  });

  useEffect(() => {
    if (pendingRole) {
      continueEditingRef.current?.focus();
      return;
    }
    (pendingReturnRef.current ?? closeRef.current)?.focus();
  }, [pendingRole]);

  async function switchRole(targetRole: PublicRole) {
    setSwitching(true);
    setError("");
    try {
      const response = await fetch("/api/v1/demo/context/switch", {
        body: JSON.stringify({ targetRole }),
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": context.csrfToken,
        },
        method: "POST",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const failure = payload as ApiErrorResponse;
        if (failure.error?.code === "ROLE_CONTEXT_STALE") {
          onStale("canonical");
          onClose();
          return;
        }
        if (
          failure.error?.code === "ROLE_CONTEXT_UNAVAILABLE" ||
          failure.error?.code === "ROLE_CONTEXT_REQUIRED"
        ) {
          onUnavailable();
          onClose();
          return;
        }
        if (failure.error?.code === "ROLE_CONTEXT_SWITCH_FAILED") {
          onStale("switch-outcome-unknown");
          onClose();
          return;
        }
        setError(failure.error?.message ?? "角色切换失败，请稍后安全重试。");
        return;
      }
      onSwitch(payload as RoleContextReadyResponse);
      onClose();
    } catch {
      onStale("switch-outcome-unknown");
      onClose();
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="shell-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="role-switch-title"
        aria-modal="true"
        className={`shell-dialog role-switch-dialog${pendingRole ? " is-confirming" : ""}`}
        ref={dialogRef}
        role="dialog"
      >
        {pendingRole ? (
          <>
            <span className="shell-eyebrow">未提交表单保护</span>
            <h2 id="role-switch-title">放弃未提交输入并切换？</h2>
            <p>
              继续切换会放弃“筛选当前队列”中的输入，但不会撤销已经提交的业务数据。
            </p>
            <div className="shell-warning-note">
              <WarningCircle weight="duotone" />
              <span>
                目标：{roleMeta[pendingRole].label} ·{" "}
                {roleMeta[pendingRole].persona} · {roleMeta[pendingRole].scope}
              </span>
            </div>
            {error ? (
              <p className="shell-form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="shell-dialog-actions">
              <button
                className="shell-secondary-button"
                onClick={closeOrReturn}
                ref={continueEditingRef}
                type="button"
              >
                返回继续编辑
              </button>
              <button
                className="shell-primary-button"
                disabled={switching}
                onClick={() => void switchRole(pendingRole)}
                type="button"
              >
                {switching
                  ? "正在安全切换…"
                  : `放弃输入并切换到${roleMeta[pendingRole].label}`}
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              aria-label="关闭角色切换"
              autoFocus
              className="shell-icon-button shell-dialog-close"
              onClick={onClose}
              ref={closeRef}
              type="button"
            >
              <X weight="regular" />
            </button>
            <span className="shell-eyebrow">共享演示壳</span>
            <h2 id="role-switch-title">切换演示角色</h2>
            <p>
              每个入口都由服务端映射到固定受保护演示人物；人物、门店与沙箱范围不能由页面参数改变。
            </p>
            <div className="shell-role-grid">
              {(Object.keys(roleMeta) as PublicRole[]).map((role) => {
                const target = roleMeta[role];
                const Icon = target.icon;
                const current = role === context.role.id;
                return (
                  <button
                    aria-label={`${target.label} ${target.persona} · 虚构人物 ${target.scope}${current ? " 当前角色" : ""}`}
                    className={current ? "is-current" : ""}
                    disabled={current || switching}
                    key={role}
                    onClick={(event) => {
                      pendingReturnRoleRef.current = role;
                      pendingReturnRef.current = event.currentTarget;
                      if (dirty) setPendingRole(role);
                      else void switchRole(role);
                    }}
                    ref={(button) => {
                      if (role === pendingReturnRoleRef.current) {
                        pendingReturnRef.current = button;
                      }
                    }}
                    type="button"
                  >
                    <Icon weight="duotone" />
                    <span>
                      <strong>{target.label}</strong>
                      <small>{target.persona} · 虚构人物</small>
                      <small>{target.scope}</small>
                    </span>
                    {current ? <em>当前角色</em> : <ArrowRight />}
                  </button>
                );
              })}
            </div>
            <div className="shell-info-note">
              <Info weight="duotone" />
              <span>
                <strong>其他标签中的旧角色写操作会立即失效。</strong>
                切换会同步轮换角色上下文与 CSRF，旧标签必须刷新后才能继续。
              </span>
            </div>
            {error ? (
              <p className="shell-form-error" role="alert">
                {error}
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

export function StaleRoleDialog({
  dirty,
  onRefresh,
  refreshing,
  returnFocusRef,
}: {
  dirty: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const refreshRef = useRef<HTMLButtonElement>(null);

  useDialogKeyboard({
    containerRef: dialogRef,
    onEscape: () => refreshRef.current?.focus(),
    returnFocusRef,
  });

  useEffect(() => refreshRef.current?.focus(), []);

  return (
    <div className="role-stale-backdrop">
      <section
        aria-describedby="stale-role-description"
        aria-labelledby="stale-role-title"
        aria-modal="true"
        ref={dialogRef}
        role="alertdialog"
      >
        <WarningCircle weight="duotone" />
        <span className="shell-eyebrow">安全阻断</span>
        <h2 id="stale-role-title">当前标签的角色上下文已失效</h2>
        <p id="stale-role-description">
          另一个标签可能已经切换演示角色，或上次切换响应未送达。旧角色写操作已停止，不能使用缓存继续提交。
        </p>
        <button
          aria-disabled={refreshing}
          className="shell-primary-button"
          onClick={() => {
            if (!refreshing) onRefresh();
          }}
          ref={refreshRef}
          type="button"
        >
          {refreshing ? "正在刷新…" : "刷新到当前角色"}
        </button>
        {dirty ? (
          <small>“筛选当前队列”中的未提交输入仍保留；刷新会放弃该输入。</small>
        ) : null}
      </section>
    </div>
  );
}
