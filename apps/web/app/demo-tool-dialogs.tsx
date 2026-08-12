"use client";

import {
  ArrowCounterClockwise,
  ArrowRight,
  CheckCircle,
  CircleNotch,
  ClockCountdown,
  Info,
  ShieldWarning,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type {
  ApiErrorResponse,
  DemoTimeAdvancedResponse,
  DemoTimeAdvanceMode,
  DemoTimeDueHandlerKind,
  DemoTimeImpactResponse,
  DemoTimePreviewResponse,
  RoleContextReadyResponse,
  SandboxEndReason,
  SandboxResetReadyResponse,
} from "@jingshu/contracts";

import { createBrowserUuid } from "./browser-uuid";
import { useDialogKeyboard } from "./role-context-dialogs";

const impactLabels: Record<DemoTimeDueHandlerKind, string> = {
  "attendance-absence": "考勤缺勤",
  "handover-exception": "交接异常",
  "pending-order-expiration": "待支付订单过期",
  "pending-reservation-expiration": "待确认预约过期",
  "reservation-auto-completion": "使用中预约自动完成",
  "reservation-no-show": "预约爽约",
};

function formatBusinessMoment(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function formatAdvanceDuration(milliseconds: number) {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  if (hours === 0) return `${minutes} 分钟`;
  if (minutes === 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分钟`;
}

function ImpactList({
  impacts,
}: {
  impacts: ReadonlyArray<DemoTimeImpactResponse>;
}) {
  if (impacts.length === 0) {
    return <p className="demo-time-no-impact">此时间段没有到期业务事件。</p>;
  }

  return (
    <ul className="demo-time-impact-list">
      {impacts.map((impact) => (
        <li key={impact.kind}>
          <span>{impactLabels[impact.kind]}</span>
          <strong>{impact.count} 项</strong>
        </li>
      ))}
    </ul>
  );
}

function readFailure(payload: unknown, fallback: string) {
  const failure = payload as Partial<ApiErrorResponse>;
  return {
    code: failure.error?.code ?? "UNKNOWN_ERROR",
    message: failure.error?.message ?? fallback,
    sandboxEndReason: failure.error?.sandboxEndReason,
  };
}

function unavailableSandboxReason(
  sandboxEndReason: SandboxEndReason | undefined,
): SandboxEndReason | undefined {
  return sandboxEndReason === "expired" || sandboxEndReason === "reset"
    ? sandboxEndReason
    : undefined;
}

function retryAfterNotice(response: Response) {
  const seconds = Number(response.headers.get("Retry-After"));
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "请稍后使用原请求安全重试。";
  }
  return `${Math.ceil(seconds)} 秒后可使用原请求安全重试。`;
}

export function DemoTimeDialog({
  context,
  onAdvanced,
  onClose,
  onStale,
  onUnavailable,
  returnFocusRef,
}: {
  context: RoleContextReadyResponse;
  onAdvanced: (result: DemoTimeAdvancedResponse) => void;
  onClose: () => void;
  onStale: () => void;
  onUnavailable: (reason: SandboxEndReason | undefined) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [preview, setPreview] = useState<DemoTimePreviewResponse | null>(null);
  const [selectedMode, setSelectedMode] = useState<DemoTimeAdvanceMode | null>(
    null,
  );
  const [stage, setStage] = useState<
    "loading" | "choose" | "confirm" | "processing" | "success" | "limit"
  >("loading");
  const [error, setError] = useState("");
  const [result, setResult] = useState<DemoTimeAdvancedResponse | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previewCallbacksRef = useRef({ onClose, onStale, onUnavailable });

  useEffect(() => {
    previewCallbacksRef.current = { onClose, onStale, onUnavailable };
  }, [onClose, onStale, onUnavailable]);

  const canClose = stage !== "processing";
  const close = useCallback(() => {
    if (canClose) onClose();
  }, [canClose, onClose]);

  useDialogKeyboard({
    containerRef: dialogRef,
    onEscape: close,
    returnFocusRef,
  });

  const loadPreview = useCallback(async () => {
    setStage("loading");
    setError("");
    try {
      const response = await fetch("/api/v1/demo/time", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const failure = readFailure(
          payload,
          "业务时间暂时无法读取，请稍后重试。",
        );
        if (
          failure.code === "ROLE_CONTEXT_UNAVAILABLE" ||
          failure.code === "ROLE_CONTEXT_REQUIRED"
        ) {
          previewCallbacksRef.current.onUnavailable(
            unavailableSandboxReason(failure.sandboxEndReason),
          );
          previewCallbacksRef.current.onClose();
          return;
        }
        if (failure.code === "ROLE_CONTEXT_STALE") {
          previewCallbacksRef.current.onStale();
          previewCallbacksRef.current.onClose();
          return;
        }
        setError(failure.message);
        setStage("choose");
        return;
      }
      const nextPreview = payload as DemoTimePreviewResponse;
      setPreview(nextPreview);
      if (!nextPreview.nextEvent && !nextPreview.halfHour.afterTime) {
        setSelectedMode(null);
        setStage("limit");
        return;
      }
      setSelectedMode(
        nextPreview.nextEvent
          ? "next-event"
          : nextPreview.halfHour.afterTime
            ? "half-hour"
            : null,
      );
      setStage("choose");
    } catch {
      setError("业务时间暂时无法读取；页面没有假装成功。请稍后重试。");
      setStage("choose");
    }
  }, []);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const selection = useMemo(() => {
    if (!preview || !selectedMode) return null;
    return selectedMode === "next-event" ? preview.nextEvent : preview.halfHour;
  }, [preview, selectedMode]);

  function selectMode(mode: DemoTimeAdvanceMode) {
    setSelectedMode(mode);
    setIdempotencyKey(null);
    setError("");
  }

  async function advanceTime() {
    if (!selectedMode || !selection?.afterTime) return;
    const requestKey = idempotencyKey ?? createBrowserUuid();
    if (!idempotencyKey) setIdempotencyKey(requestKey);
    setStage("processing");
    setError("");
    try {
      const response = await fetch("/api/v1/demo/time/advance", {
        body: JSON.stringify({ mode: selectedMode }),
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey,
          "X-CSRF-Token": context.csrfToken,
        },
        method: "POST",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const failure = readFailure(
          payload,
          "事务推进失败，业务时间和到期对象均未改变；可以安全重试。",
        );
        if (
          failure.code === "ROLE_CONTEXT_UNAVAILABLE" ||
          failure.code === "ROLE_CONTEXT_REQUIRED"
        ) {
          onUnavailable(unavailableSandboxReason(failure.sandboxEndReason));
          onClose();
          return;
        }
        if (failure.code === "ROLE_CONTEXT_STALE") {
          onStale();
          onClose();
          return;
        }
        if (failure.code === "DEMO_TIME_ADVANCE_LIMIT_REACHED") {
          setError(failure.message);
          setStage("limit");
          return;
        }
        setError(failure.message);
        setStage("confirm");
        return;
      }
      const nextResult = payload as DemoTimeAdvancedResponse;
      setResult(nextResult);
      setStage("success");
      onAdvanced(nextResult);
    } catch {
      setError(
        "事务推进响应未送达；业务时间不会显示为已改变，可使用同一请求安全重试。",
      );
      setStage("confirm");
    }
  }

  const currentTime =
    preview?.clock.currentTime ?? context.sandbox.businessClock.currentTime;
  const usedMilliseconds =
    preview?.clock.advancedMilliseconds ??
    context.sandbox.businessClock.advancedMilliseconds;
  const remainingMilliseconds =
    preview?.clock.remainingAdvanceMilliseconds ??
    context.sandbox.businessClock.remainingAdvanceMilliseconds;

  return (
    <div className="shell-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="demo-time-title"
        aria-modal="true"
        className="shell-dialog demo-time-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <button
          aria-label="关闭业务时间工具"
          className="shell-icon-button shell-dialog-close"
          disabled={!canClose}
          onClick={close}
          ref={closeRef}
          type="button"
        >
          <X />
        </button>
        <span className="shell-eyebrow">上海业务时钟 · 沙箱工具</span>

        {stage === "loading" ? (
          <div className="demo-tool-loading" role="status">
            <CircleNotch />
            <h2 id="demo-time-title">正在读取事务预览</h2>
            <p>只读取当前沙箱；业务时间和业务对象尚未改变。</p>
          </div>
        ) : null}

        {stage === "processing" ? (
          <div className="demo-tool-loading" role="status">
            <CircleNotch />
            <h2 id="demo-time-title">正在原子推进业务时间</h2>
            <p>到期处理、业务时钟和审计会在同一事务中一起成功或一起回滚。</p>
          </div>
        ) : null}

        {stage === "choose" ? (
          <>
            <h2 id="demo-time-title">选择业务时间推进方式</h2>
            <p>
              先预览前后时间和到期对象，再进入确认。真实服务器时间、TTL、验证码与安全截止时间不会跟随推进。
            </p>
            <div className="demo-time-clock-strip" aria-label="当前业务时间">
              <ClockCountdown weight="duotone" />
              <span>
                <small>当前业务时间</small>
                <strong>{formatBusinessMoment(currentTime)}</strong>
              </span>
              <span>
                已推进 {formatAdvanceDuration(usedMilliseconds)} · 剩余{" "}
                {formatAdvanceDuration(remainingMilliseconds)}
              </span>
            </div>
            {preview ? (
              <div className="demo-time-option-grid">
                <section
                  className={`demo-time-option-card${selectedMode === "next-event" ? " is-selected" : ""}`}
                >
                  <button
                    aria-pressed={selectedMode === "next-event"}
                    disabled={!preview.nextEvent}
                    onClick={() => selectMode("next-event")}
                    type="button"
                  >
                    <span>
                      <strong>推进到下一事件</strong>
                      <small>
                        {preview.nextEvent
                          ? `${formatBusinessMoment(currentTime)} → ${formatBusinessMoment(preview.nextEvent.afterTime)}`
                          : "暂无已登记的下一业务事件"}
                      </small>
                    </span>
                  </button>
                  {preview.nextEvent ? (
                    <ImpactList impacts={preview.nextEvent.impacts} />
                  ) : (
                    <p className="demo-time-no-impact">
                      暂无可预览的到期对象。
                    </p>
                  )}
                </section>
                <section
                  className={`demo-time-option-card${selectedMode === "half-hour" ? " is-selected" : ""}`}
                >
                  <button
                    aria-pressed={selectedMode === "half-hour"}
                    disabled={!preview.halfHour.afterTime}
                    onClick={() => selectMode("half-hour")}
                    type="button"
                  >
                    <span>
                      <strong>向前推进 30 分钟</strong>
                      <small>
                        {preview.halfHour.afterTime
                          ? `${formatBusinessMoment(currentTime)} → ${formatBusinessMoment(preview.halfHour.afterTime)}`
                          : "本次推进将超过 24 小时累计上限"}
                      </small>
                    </span>
                  </button>
                  <ImpactList impacts={preview.halfHour.impacts} />
                </section>
              </div>
            ) : null}
            {error ? (
              <div className="shell-form-error demo-tool-error" role="alert">
                <WarningCircle />
                <span>{error}</span>
                <button onClick={() => void loadPreview()} type="button">
                  重新读取
                </button>
              </div>
            ) : null}
            <div className="shell-dialog-actions">
              <button
                className="shell-secondary-button"
                onClick={onClose}
                type="button"
              >
                取消
              </button>
              <button
                className="shell-primary-button"
                disabled={!selection?.afterTime}
                onClick={() => setStage("confirm")}
                type="button"
              >
                查看推进影响
                <ArrowRight />
              </button>
            </div>
          </>
        ) : null}

        {stage === "confirm" && selection?.afterTime ? (
          <>
            <h2 id="demo-time-title">确认业务时间与到期影响</h2>
            <p>
              确认后会以固定顺序处理全部到期事件；任何一步失败都不会留下半完成状态。
            </p>
            <div className="demo-time-before-after">
              <span>
                <small>推进前</small>
                <strong>{formatBusinessMoment(currentTime)}</strong>
              </span>
              <ArrowRight />
              <span>
                <small>推进后</small>
                <strong>{formatBusinessMoment(selection.afterTime)}</strong>
              </span>
            </div>
            <div className="shell-warning-note">
              <ShieldWarning weight="duotone" />
              <span>
                <strong>真实服务器时间保持不变。</strong> 沙箱
                TTL、验证码、限流窗口、幂等保留期和会话截止仍只使用真实服务器时间。
              </span>
            </div>
            <section className="demo-time-impact-summary">
              <h3>本次到期对象</h3>
              <ImpactList impacts={selection.impacts} />
            </section>
            {error ? (
              <div className="shell-form-error demo-tool-error" role="alert">
                <WarningCircle />
                <span>{error}</span>
              </div>
            ) : null}
            <div className="shell-dialog-actions">
              <button
                className="shell-secondary-button"
                onClick={() => {
                  setError("");
                  setStage("choose");
                }}
                type="button"
              >
                返回修改
              </button>
              <button
                className="shell-primary-button"
                onClick={() => void advanceTime()}
                type="button"
              >
                {error ? "使用同一请求安全重试" : "确认并原子推进"}
              </button>
            </div>
          </>
        ) : null}

        {stage === "limit" ? (
          <div className="demo-tool-result is-limit">
            <WarningCircle weight="duotone" />
            <h2 id="demo-time-title">已达到本沙箱的推进上限</h2>
            <p>
              {error ||
                "累计业务时间最多可向前推进 24 小时。当前沙箱与业务对象保持不变。"}
            </p>
            <div className="shell-info-note">
              <Info weight="duotone" />
              <span>
                如需从标准故事起点重新演示，请关闭后使用顶栏“重置沙箱”。
              </span>
            </div>
            <div className="shell-dialog-actions">
              <button
                className="shell-primary-button"
                onClick={onClose}
                type="button"
              >
                知道了
              </button>
            </div>
          </div>
        ) : null}

        {stage === "success" && result ? (
          <div className="demo-tool-result is-success" role="status">
            <CheckCircle weight="duotone" />
            <h2 id="demo-time-title">业务时间已完整推进</h2>
            <p>
              时钟、到期对象与审计已在同一事务中提交
              {result.replayed ? "；这是同一请求的安全重放结果" : ""}。
            </p>
            <div className="demo-time-before-after">
              <span>
                <small>推进前</small>
                <strong>{formatBusinessMoment(result.beforeTime)}</strong>
              </span>
              <ArrowRight />
              <span>
                <small>推进后</small>
                <strong>{formatBusinessMoment(result.afterTime)}</strong>
              </span>
            </div>
            <section className="demo-time-impact-summary">
              <h3>已处理到期对象</h3>
              <ImpactList impacts={result.impacts} />
            </section>
            <div className="shell-dialog-actions">
              <button
                className="shell-primary-button"
                onClick={onClose}
                type="button"
              >
                返回当前角色
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

const resetImpacts = [
  ["顾客", "预约、订单、会员与个人故事进度"],
  ["店员", "当班队列、考勤与交接故事进度"],
  ["店长", "门店配置、库存与人员管理故事进度"],
  ["总部运营", "跨店对比、连锁配置与审计故事进度"],
] as const;

export function SandboxResetDialog({
  context,
  onClose,
  onReset,
  onStale,
  onUnavailable,
  returnFocusRef,
}: {
  context: RoleContextReadyResponse;
  onClose: () => void;
  onReset: (result: SandboxResetReadyResponse) => void;
  onStale: () => void;
  onUnavailable: (reason: SandboxEndReason | undefined) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [stage, setStage] = useState<
    "impact" | "confirm" | "processing" | "success"
  >("impact");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SandboxResetReadyResponse | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const canClose = stage !== "processing";
  const close = useCallback(() => {
    if (canClose) onClose();
  }, [canClose, onClose]);

  useDialogKeyboard({
    containerRef: dialogRef,
    onEscape: close,
    returnFocusRef,
  });

  useEffect(() => closeRef.current?.focus(), []);
  useEffect(() => {
    if (stage === "confirm") confirmRef.current?.focus();
  }, [stage]);

  async function resetSandbox() {
    if (!confirmed) return;
    const requestKey = idempotencyKey ?? createBrowserUuid();
    if (!idempotencyKey) setIdempotencyKey(requestKey);
    setStage("processing");
    setError("");
    try {
      const response = await fetch("/api/v1/demo/reset", {
        body: JSON.stringify({ confirm: true }),
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey,
          "X-CSRF-Token": context.csrfToken,
        },
        method: "POST",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const failure = readFailure(
          payload,
          "全新沙箱创建失败，当前沙箱仍完整保留；可以安全重试。",
        );
        if (
          failure.code === "ROLE_CONTEXT_UNAVAILABLE" ||
          failure.code === "ROLE_CONTEXT_REQUIRED"
        ) {
          onUnavailable(unavailableSandboxReason(failure.sandboxEndReason));
          onClose();
          return;
        }
        if (failure.code === "ROLE_CONTEXT_STALE") {
          onStale();
          onClose();
          return;
        }
        if (
          response.status === 429 &&
          failure.code === "SANDBOX_RESET_RATE_LIMITED"
        ) {
          setError(`${failure.message} ${retryAfterNotice(response)}`);
          setStage("confirm");
          return;
        }
        setError(failure.message);
        setStage("confirm");
        return;
      }
      const nextResult = payload as SandboxResetReadyResponse;
      setResult(nextResult);
      setStage("success");
      onReset(nextResult);
    } catch {
      setError(
        "重置响应未送达；当前沙箱不会被页面丢弃，可使用同一请求安全重试。",
      );
      setStage("confirm");
    }
  }

  return (
    <div className="shell-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="sandbox-reset-title"
        aria-modal="true"
        className="shell-dialog sandbox-reset-dialog"
        ref={dialogRef}
        role="alertdialog"
      >
        <button
          aria-label="关闭沙箱重置"
          className="shell-icon-button shell-dialog-close"
          disabled={!canClose}
          onClick={close}
          ref={closeRef}
          type="button"
        >
          <X />
        </button>
        <span className="shell-eyebrow">危险操作 · 全新标准沙箱</span>

        {stage === "impact" ? (
          <>
            <h2 id="sandbox-reset-title">重置会替换四个角色的整条演示故事</h2>
            <div className="shell-warning-note sandbox-reset-danger-note">
              <ShieldWarning weight="duotone" />
              <span>
                系统会先完整创建并校验新沙箱，再轮换会话并使旧沙箱失效；任一步失败仍停留在当前沙箱。成功后任何标签都不能继续操作旧对象，业务时间累计值回到标准种子起点。
              </span>
            </div>
            <div className="sandbox-reset-impact-grid">
              {resetImpacts.map(([role, impact]) => (
                <section key={role}>
                  <strong>{role}</strong>
                  <span>{impact}</span>
                </section>
              ))}
            </div>
            <div className="shell-dialog-actions">
              <button
                className="shell-secondary-button"
                onClick={onClose}
                type="button"
              >
                保留当前沙箱
              </button>
              <button
                className="shell-primary-button sandbox-reset-continue"
                onClick={() => setStage("confirm")}
                type="button"
              >
                继续二次确认
                <ArrowRight />
              </button>
            </div>
          </>
        ) : null}

        {stage === "confirm" ? (
          <>
            <h2 id="sandbox-reset-title">最后确认：创建并切换到全新沙箱</h2>
            <p>
              新沙箱将从顾客角色与标准种子开始。只有创建、审计、旧沙箱失效和会话轮换全部成功后，页面才会切换。
            </p>
            <label className="sandbox-reset-check">
              <input
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                ref={confirmRef}
                type="checkbox"
              />
              <span>
                我了解顾客、店员、店长与总部运营的当前演示数据和故事进度都会被全新标准种子替换。
              </span>
            </label>
            {error ? (
              <div className="shell-form-error demo-tool-error" role="alert">
                <WarningCircle />
                <span>{error}</span>
              </div>
            ) : null}
            <div className="shell-info-note">
              <Info weight="duotone" />
              <span>
                {error
                  ? "当前沙箱仍完整保留。重试会复用同一幂等请求，不会创建多个替代沙箱。"
                  : "重置不会延长或修改任何真实服务器时间截止；新沙箱会获得自己的真实服务器时间 TTL。"}
              </span>
            </div>
            <div className="shell-dialog-actions">
              <button
                className="shell-secondary-button"
                onClick={() => {
                  setError("");
                  setStage("impact");
                }}
                type="button"
              >
                返回查看影响
              </button>
              <button
                className="shell-danger-button"
                disabled={!confirmed}
                onClick={() => void resetSandbox()}
                type="button"
              >
                <ArrowCounterClockwise />
                {error ? "安全重试创建新沙箱" : "创建新沙箱并使旧沙箱失效"}
              </button>
            </div>
          </>
        ) : null}

        {stage === "processing" ? (
          <div className="demo-tool-loading" role="status">
            <CircleNotch />
            <h2 id="sandbox-reset-title">正在创建并校验全新沙箱</h2>
            <p>请勿关闭。当前沙箱会一直保留到新沙箱完整可用为止。</p>
          </div>
        ) : null}

        {stage === "success" && result ? (
          <div className="demo-tool-result is-success" role="status">
            <CheckCircle weight="duotone" />
            <h2 id="sandbox-reset-title">全新标准沙箱已就绪</h2>
            <p>
              {result.context.role.id === "customer"
                ? "已切换到顾客主演示起点，旧沙箱已失效"
                : `同一重置请求已安全重放；旧沙箱仍失效，当前会话保持服务端${result.context.role.label}上下文`}
              。
            </p>
            <div className="sandbox-reset-success-facts">
              <span>
                <small>当前角色</small>
                <strong>{result.context.role.label}</strong>
              </span>
              <span>
                <small>当前人物</small>
                <strong>{result.context.persona.displayName} · 虚构人物</strong>
              </span>
              <span>
                <small>业务时间</small>
                <strong>
                  {formatBusinessMoment(
                    result.context.sandbox.businessClock.currentTime,
                  )}
                </strong>
              </span>
            </div>
            <div className="shell-dialog-actions">
              <button
                className="shell-primary-button"
                onClick={onClose}
                type="button"
              >
                {result.context.role.id === "customer"
                  ? "回到主演示起点"
                  : "进入当前标准沙箱"}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
