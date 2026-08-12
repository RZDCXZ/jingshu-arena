"use client";

import {
  ArrowRight,
  Check,
  CircleNotch,
  ClockCounterClockwise,
  LockKey,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type {
  ApiErrorResponse,
  DemoStoryResponse,
  DemoStoryStepId,
  PublicRole,
  SandboxEndReason,
} from "@jingshu/contracts";

import { useDialogKeyboard } from "./role-context-dialogs";

type StoryRole = PublicRole | "shared";

interface StoryStepCopy {
  readonly businessObject: string;
  readonly completion: string;
  readonly entry: string;
  readonly nextAction: string;
  readonly role: StoryRole;
  readonly title: string;
}

const roleLabels: Record<StoryRole, string> = {
  customer: "顾客",
  hq: "总部运营",
  manager: "店长",
  shared: "共享工具",
  staff: "店员",
};

const storyStepCopy: Record<DemoStoryStepId, StoryStepCopy> = {
  "business-time-advanced": {
    businessObject: "共享业务时钟",
    completion:
      "向前推进 30 分钟的审计事件存在，真实服务器时间与沙箱 TTL 不变。",
    entry: "顶栏 · 业务时间",
    nextAction: "打开业务时间并推进 30 分钟",
    role: "shared",
    title: "推进共享业务时间",
  },
  "headquarters-exported": {
    businessObject: "固定三店看板与 CSV 导出",
    completion: "同一总部请求为三家固定门店写入导出审计记录。",
    entry: "总部运营 · 门店比较 → 审计与导出",
    nextAction: "切换总部并比较固定三店",
    role: "hq",
    title: "比较三店并导出 CSV",
  },
  "order-fulfilled": {
    businessObject: "顾客商品订单",
    completion:
      "店员已开始制作、标记待取或完成订单；已模拟支付订单仍保留在履约链路。",
    entry: "店员 · 商品订单",
    nextAction: "切换店员并推进订单履约",
    role: "staff",
    title: "推进商品订单履约",
  },
  "order-paid": {
    businessObject: "顾客商品订单",
    completion: "主预约关联订单的模拟支付成功事件存在。",
    entry: "顾客 H5 · 我的订单",
    nextAction: "切换顾客并创建、模拟支付订单",
    role: "customer",
    title: "创建并模拟支付订单",
  },
  "repair-created": {
    businessObject: "主预约关联报修",
    completion: "顾客在推进时间后提交“耳机右声道无声”报修。",
    entry: "顾客 H5 · 我的报修",
    nextAction: "切换顾客并提交报修",
    role: "customer",
    title: "提交耳机右声道无声报修",
  },
  "repair-resolved": {
    businessObject: "维修、库存流水与价格分段模拟退款",
    completion:
      "店员已指派并开始处理，座位维护和模拟退款已记录，领用一副替换耳机后提交维修结论。",
    entry: "店员 · 报修",
    nextAction: "切换店员并处理报修与备件",
    role: "staff",
    title: "处理维修、备件与结论",
  },
  "repair-verified": {
    businessObject: "维修复核、座位恢复与审计",
    completion:
      "店长独立复核通过，维修关闭、座位恢复可用，并可在看板和审计中读取同一证据。",
    entry: "店长 · 报修 → 经营看板 / 审计与导出",
    nextAction: "切换店长，复核维修并读取经营证据",
    role: "manager",
    title: "复核维修并查看经营证据",
  },
  "reservation-arrived": {
    businessObject: "主预约到店状态",
    completion: "店员办理到店业务事件存在。",
    entry: "店员 · 工作台",
    nextAction: "切换店员并办理到店",
    role: "staff",
    title: "办理顾客到店",
  },
  "reservation-created": {
    businessObject: "棱镜旗舰店即时预约",
    completion: "顾客创建竞技型两小时即时预约，并使用预约体验券。",
    entry: "顾客 H5 · 预约首页",
    nextAction: "前往顾客 H5 创建预约",
    role: "customer",
    title: "创建即时两小时预约",
  },
  "reservation-in-use": {
    businessObject: "主预约使用状态",
    completion: "店员开始使用业务事件存在。",
    entry: "店员 · 工作台",
    nextAction: "开始顾客使用",
    role: "staff",
    title: "开始使用预约座位",
  },
  "reservation-paid": {
    businessObject: "主预约模拟支付",
    completion: "预约模拟支付成功并进入已确认状态；不会产生真实扣款。",
    entry: "顾客 H5 · 我的预约",
    nextAction: "模拟支付该预约",
    role: "customer",
    title: "确认预约模拟支付",
  },
  "sandbox-reset": {
    businessObject: "独立三店演示世界",
    completion: "创建替换沙箱，旧标签与旧对象均被服务端拒绝，十二步清单归零。",
    entry: "顶栏 · 重置沙箱",
    nextAction: "创建全新沙箱并重置清单",
    role: "shared",
    title: "重置为全新主演示",
  },
};

function formatEvidenceTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function sandboxEndReason(
  error: Pick<ApiErrorResponse["error"], "sandboxEndReason"> | undefined,
): SandboxEndReason | undefined {
  const reason = error?.sandboxEndReason;
  return reason === "expired" || reason === "reset" ? reason : undefined;
}

export function DemoStoryDrawer({
  onClose,
  onLoaded,
  onNextAction,
  onStale,
  onUnavailable,
  refreshKey,
  returnFocusRef,
}: {
  onClose: () => void;
  onLoaded: (completedCount: number) => void;
  onNextAction: (step: DemoStoryStepId) => void;
  onStale: () => void;
  onUnavailable: (reason: SandboxEndReason | undefined) => void;
  refreshKey: number;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const [story, setStory] = useState<DemoStoryResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const callbacksRef = useRef({ onClose, onLoaded, onStale, onUnavailable });

  useEffect(() => {
    callbacksRef.current = { onClose, onLoaded, onStale, onUnavailable };
  }, [onClose, onLoaded, onStale, onUnavailable]);

  useDialogKeyboard({
    containerRef: drawerRef,
    onEscape: onClose,
    returnFocusRef,
  });

  const loadStory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/demo/story", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const failure = payload as ApiErrorResponse;
        if (
          failure.error?.code === "ROLE_CONTEXT_UNAVAILABLE" ||
          failure.error?.code === "ROLE_CONTEXT_REQUIRED"
        ) {
          callbacksRef.current.onUnavailable(sandboxEndReason(failure.error));
          callbacksRef.current.onClose();
          return;
        }
        if (failure.error?.code === "ROLE_CONTEXT_STALE") {
          callbacksRef.current.onStale();
          callbacksRef.current.onClose();
          return;
        }
        setError(failure.error?.message ?? "主演示清单暂时无法读取。");
        return;
      }
      const next = payload as DemoStoryResponse;
      setStory(next);
      callbacksRef.current.onLoaded(next.completedCount);
    } catch {
      setError("主演示清单暂时无法读取；页面没有假装进度。请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStory();
  }, [loadStory, refreshKey]);

  useEffect(() => {
    if (loading) return;
    (error ? retryRef.current : closeRef.current)?.focus();
  }, [error, loading]);

  const currentStep = story?.steps.find((step) => step.state === "current");

  return (
    <div className="demo-story-backdrop" role="presentation">
      <section
        aria-labelledby="demo-story-title"
        aria-modal="true"
        className="demo-story-drawer"
        ref={drawerRef}
        role="dialog"
      >
        <header className="demo-story-drawer-header">
          <span>
            <LockKey weight="duotone" />
            <small>WEB-G03 · 服务端业务证据</small>
          </span>
          <button
            aria-label="关闭主演示清单"
            className="shell-icon-button"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <X />
          </button>
        </header>
        <div className="demo-story-drawer-intro">
          <h2 id="demo-story-title">十二步主演示清单</h2>
          <p>
            进度只从主顾客、主对象、业务事件、库存流水、导出与重置记录推导；不能手动勾选，也不会被背景历史提前完成。
          </p>
        </div>

        {loading ? (
          <div className="demo-story-loading" role="status">
            <CircleNotch />
            <strong>正在读取当前沙箱证据</strong>
            <span>读取不会改变预约、订单、维修、库存或业务时间。</span>
          </div>
        ) : null}

        {error ? (
          <div className="demo-story-error" role="alert">
            <WarningCircle weight="duotone" />
            <span>{error}</span>
            <button
              onClick={() => void loadStory()}
              ref={retryRef}
              type="button"
            >
              重新读取
            </button>
          </div>
        ) : null}

        {story?.resetAt ? (
          <div className="demo-story-reset-note" role="status">
            <ClockCounterClockwise weight="duotone" />
            <span>
              <strong>全新沙箱已从标准故事起点开始</strong>
              <small>
                {formatEvidenceTime(story.resetAt)} ·
                旧对象和旧上下文已失效，清单已归零。
              </small>
            </span>
          </div>
        ) : null}

        {story ? (
          <ol className="demo-story-steps">
            {story.steps.map((step, index) => {
              const copy = storyStepCopy[step.id];
              const completed = step.state === "completed";
              const current = step.state === "current";
              return (
                <li
                  aria-current={current ? "step" : undefined}
                  className={`is-${step.state}`}
                  data-testid={`demo-story-step-${index + 1}`}
                  key={step.id}
                >
                  <span className="demo-story-step-number">
                    {completed ? (
                      <Check weight="bold" />
                    ) : (
                      String(index + 1).padStart(2, "0")
                    )}
                  </span>
                  <div className="demo-story-step-content">
                    <span>
                      {roleLabels[copy.role]} · {copy.businessObject}
                    </span>
                    <strong>{copy.title}</strong>
                    <small>入口 · {copy.entry}</small>
                    <small>完成条件 · {copy.completion}</small>
                    {step.evidence.length > 0 ? (
                      <ul aria-label={`${copy.title} 的已有证据`}>
                        {step.evidence.map((evidence) => (
                          <li
                            key={`${evidence.kind}-${evidence.occurredAt}-${evidence.summary}`}
                          >
                            <time dateTime={evidence.occurredAt}>
                              {formatEvidenceTime(evidence.occurredAt)}
                            </time>
                            <span>{evidence.summary}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <em>
                        {current
                          ? "等待本步骤的合法业务证据"
                          : "等待前序步骤完成"}
                      </em>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}

        <footer className="demo-story-drawer-footer">
          <div>
            <span>已完成 {story?.completedCount ?? 0} / 12</span>
            <progress max="12" value={story?.completedCount ?? 0} />
          </div>
          {currentStep ? (
            <button onClick={() => onNextAction(currentStep.id)} type="button">
              {storyStepCopy[currentStep.id].nextAction}
              <ArrowRight />
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
