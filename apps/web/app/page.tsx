"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  ArrowRight,
  Check,
  ClockClockwise,
  Database,
  Hourglass,
  Info,
  LockKey,
  Monitor,
  ShieldCheck,
  Warning,
  X,
} from "@phosphor-icons/react";
import type {
  ApiErrorResponse,
  PublicRole,
  PublicSandboxReadyResponse,
  RoleContextReadyResponse,
} from "@jingshu/contracts";

import jingshuMark from "../../../product-ui/management-system/design-prototype/public/assets/jingshu-mark.png";
import { publicRoleCards } from "./role-context-model";
import { RoleContextShell } from "./role-context-shell";

const REQUEST_TIMEOUT_MS = 8_000;
const roles = publicRoleCards;

type CreationStage =
  | "checking"
  | "context-error"
  | "entry"
  | "creating"
  | "ready"
  | "shell"
  | "error"
  | "timeout";

interface FailureState {
  message: string;
  requestId?: string;
}

function isEndedRoleContext(error: ApiErrorResponse | null) {
  return (
    error?.error?.code === "ROLE_CONTEXT_REQUIRED" ||
    error?.error?.code === "ROLE_CONTEXT_UNAVAILABLE"
  );
}

async function requestExistingRoleContext(signal?: AbortSignal) {
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

function Brand() {
  return (
    <div className="brand" aria-label="竞枢 Jingshu Arena">
      <Image
        aria-hidden="true"
        src={jingshuMark}
        alt=""
        width={36}
        height={36}
      />
      <span className="brand-type">
        <strong>竞枢</strong>
        <span>JINGSHU ARENA</span>
      </span>
    </div>
  );
}

function PublicHeader({
  exploreButtonRef,
  onExplore,
}: {
  exploreButtonRef?: RefObject<HTMLButtonElement | null>;
  onExplore?: () => void;
}) {
  return (
    <header className="public-header">
      <Brand />
      <div className="header-actions">
        <span className="demo-chip">演示数据</span>
        {onExplore ? (
          <button
            className="text-button"
            onClick={onExplore}
            ref={exploreButtonRef}
            type="button"
          >
            只读了解
          </button>
        ) : null}
      </div>
    </header>
  );
}

function ReadonlyOverview({
  onClose,
  returnFocusRef,
}: {
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const returnFocusTarget = returnFocusRef.current;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      );
      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }

    dialog?.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog?.removeEventListener("keydown", handleKeyDown);
      returnFocusTarget?.focus();
    };
  }, [onClose, returnFocusRef]);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="readonly-title"
        aria-modal="true"
        className="readonly-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <button
          aria-label="关闭只读了解"
          className="icon-button"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          <X weight="bold" />
        </button>
        <span className="eyebrow">只读产品导览 · 不创建沙箱</span>
        <h2 id="readonly-title">先看清演示边界，再决定是否创建。</h2>
        <p>
          竞枢演示电竞场馆从顾客预约到总部经营比较的协同过程。这里展示的是栖光市的固定三店合成故事，不提供任何真实门店服务。
        </p>
        <div className="readonly-grid">
          <div>
            <strong>棱镜旗舰店</strong>
            <span>96 座 · 24 小时 · 主演示发生地</span>
          </div>
          <div>
            <strong>星桥标准店</strong>
            <span>64 座 · 10:00–次日 02:00</span>
          </div>
          <div>
            <strong>极点新店</strong>
            <span>40 座 · 12:00–24:00</span>
          </div>
        </div>
        <div className="dialog-note">
          <ShieldCheck weight="duotone" />
          <span>
            <strong>浏览这段说明不会创建任何可写数据。</strong>
            只有关闭说明并明确选择角色后，系统才会请求独立沙箱。
          </span>
        </div>
        <button
          className="button secondary-button"
          onClick={onClose}
          type="button"
        >
          返回角色入口
        </button>
      </section>
    </div>
  );
}

function PublicEntry({ onCreate }: { onCreate: (role: PublicRole) => void }) {
  const [showReadonly, setShowReadonly] = useState(false);
  const readonlyTriggerRef = useRef<HTMLButtonElement>(null);

  return (
    <main className="public-entry">
      <PublicHeader
        exploreButtonRef={readonlyTriggerRef}
        onExplore={() => setShowReadonly(true)}
      />
      <section className="public-hero" aria-labelledby="product-title">
        <div className="public-hero-copy">
          <span className="eyebrow">电竞场馆预约与运营协同演示</span>
          <h1 id="product-title">从一次预约，看见四个角色如何共同经营。</h1>
          <p>
            竞枢把顾客预约、门店履约、设备维修、库存流水与连锁经营证据放进同一个隔离沙箱。无需注册，不发生真实支付。
          </p>
          <ul className="public-proof" aria-label="演示边界摘要">
            <li>
              <ShieldCheck weight="duotone" />
              <span>虚构数据</span>
            </li>
            <li>
              <LockKey weight="duotone" />
              <span>无需注册</span>
            </li>
            <li>
              <Database weight="duotone" />
              <span>每位访客独立沙箱</span>
            </li>
            <li>
              <Monitor weight="duotone" />
              <span>不连接真实设备</span>
            </li>
          </ul>
        </div>
        <aside className="public-story" aria-label="跨角色主演示概览">
          <div className="story-orbit">
            <span>顾客</span>
            <span>店员</span>
            <span>店长</span>
            <span>总部</span>
            <strong>
              同一业务对象
              <br />
              跨角色流转
            </strong>
          </div>
        </aside>
      </section>

      <section className="public-role-section" aria-labelledby="roles-title">
        <div className="public-section-heading">
          <div>
            <span className="eyebrow">选择一个入口</span>
            <h2 id="roles-title">推荐从顾客开始，也可以直接查看管理端。</h2>
          </div>
          <span>明确选择后才创建可写沙箱</span>
        </div>
        <div className="role-card-grid">
          {roles.map((role, index) => {
            const Icon = role.icon;
            return (
              <button
                aria-label={`进入${role.label}演示`}
                className={`public-role-card ${role.recommended ? "is-recommended" : ""}`}
                key={role.id}
                onClick={() => onCreate(role.id)}
                type="button"
              >
                {role.recommended ? (
                  <span className="recommended-label">推荐起点</span>
                ) : null}
                <Icon aria-hidden="true" weight="duotone" />
                <span className="role-number">0{index + 1}</span>
                <h3>{role.label}</h3>
                <p>{role.description}</p>
                <dl>
                  <div>
                    <dt>演示人物</dt>
                    <dd>{role.persona} · 虚构人物</dd>
                  </div>
                  <div>
                    <dt>数据范围</dt>
                    <dd>{role.scope}</dd>
                  </div>
                </dl>
                <span className="role-enter">
                  进入{role.label}演示 <ArrowRight weight="bold" />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="public-boundary" aria-label="完整演示边界">
        <div>
          <Info aria-hidden="true" weight="fill" />
          <span>
            <strong>这是产品能力演示，不提供真实门店服务。</strong>
            所有门店、人物、订单、金额和经营数据均为合成数据；模拟支付不会扣款，也不连接真实设备。
          </span>
        </div>
        <div>
          <ClockClockwise aria-hidden="true" weight="duotone" />
          <span>
            <strong>沙箱保留 24 小时。</strong>
            复制公开地址不会分享当前可写状态，其他访客会得到自己的沙箱。
          </span>
        </div>
      </section>

      <footer className="public-footer">
        <span>竞枢 JINGSHU ARENA · 基础 RC</span>
        <span>人民币 · Asia/Shanghai · 经营日 06:00 开始</span>
      </footer>
      {showReadonly ? (
        <ReadonlyOverview
          onClose={() => setShowReadonly(false)}
          returnFocusRef={readonlyTriggerRef}
        />
      ) : null}
    </main>
  );
}

function CreationProgress({ role }: { role: PublicRole }) {
  const meta = roles.find((item) => item.id === role) ?? roles[0];
  return (
    <main className="state-page">
      <PublicHeader />
      <section className="state-card" role="status" aria-live="polite">
        <div className="state-icon is-loading">
          <Hourglass weight="duotone" />
        </div>
        <span className="eyebrow">正在创建独立演示世界</span>
        <h1>正在准备{meta.label}视图</h1>
        <p>
          {meta.persona} · 虚构人物｜{meta.scope}
        </p>
        <ol className="creation-steps">
          <li className="is-active">
            <Check weight="bold" />
            原子生成经营方与固定三店
          </li>
          <li>
            <Check weight="bold" />
            物化受保护演示人物与版本种子
          </li>
          <li>
            <Check weight="bold" />
            签发角色与门店范围
          </li>
        </ol>
        <small>部分失败会整体回滚；确认完成前不会进入业务页面。</small>
      </section>
    </main>
  );
}

function ReadyWorld({
  result,
  onBack,
  onEnter,
}: {
  result: PublicSandboxReadyResponse;
  onBack: () => void;
  onEnter: () => void;
}) {
  const meta = roles.find((item) => item.id === result.role) ?? roles[0];
  return (
    <main className="state-page ready-page">
      <PublicHeader />
      <section
        className="state-card ready-card"
        role="status"
        aria-live="polite"
      >
        <div className="state-icon is-success">
          <Check weight="bold" />
        </div>
        <span className="eyebrow">独立沙箱 · 演示数据</span>
        <h1>沙箱已准备完成</h1>
        <p>
          {result.persona.displayName} · {meta.label}｜{result.persona.scope}
        </p>
        <div className="world-meta">
          <span>{result.world.operator.displayName}</span>
          <strong>{result.world.operator.city}</strong>
          <span>Schema {result.world.schemaVersion}</span>
          <span>Seed {result.world.seedVersion}</span>
        </div>
        <div className="ready-store-grid">
          {result.world.stores.map((store) => (
            <article key={store.code}>
              <span>{store.seatCount} 座</span>
              <h2>{store.displayName}</h2>
              <p>{store.businessHours}</p>
            </article>
          ))}
        </div>
        <div className="ready-note">
          <ShieldCheck weight="duotone" />
          <span>
            <strong>
              {result.replayed
                ? "已安全恢复原创建结果"
                : "服务端角色范围已签发"}
            </strong>
            当前公开地址不包含沙箱标识、会话凭证或可写能力。
          </span>
        </div>
        <div className="state-actions">
          <button
            className="button primary-button"
            onClick={onEnter}
            type="button"
          >
            进入{meta.label}视图
            <ArrowRight weight="bold" />
          </button>
          <button
            className="button secondary-button"
            onClick={onBack}
            type="button"
          >
            返回公开入口
          </button>
        </div>
      </section>
    </main>
  );
}

function ExistingContextCheck() {
  return (
    <main className="state-page">
      <PublicHeader />
      <section className="state-card" role="status" aria-live="polite">
        <div className="state-icon is-loading">
          <Hourglass weight="duotone" />
        </div>
        <span className="eyebrow">正在检查当前浏览器会话</span>
        <h1>正在确认已有角色上下文</h1>
        <p>没有已有沙箱时会直接返回公开角色入口，不会创建任何数据。</p>
      </section>
    </main>
  );
}

function FailureView({
  kind,
  failure,
  onRetry,
  onBack,
}: {
  kind: "error" | "timeout";
  failure: FailureState;
  onRetry: () => void;
  onBack: () => void;
}) {
  const isTimeout = kind === "timeout";
  return (
    <main className="state-page">
      <PublicHeader />
      <section className="state-card failure-card" role="alert">
        <div className="state-icon is-warning">
          <Warning weight="duotone" />
        </div>
        <span className="eyebrow">
          {isTimeout ? "安全确认超时" : "创建已完整回滚"}
        </span>
        <h1>{isTimeout ? "创建结果仍在确认中" : "没有进入半成的演示世界"}</h1>
        <p>{failure.message}</p>
        <div className="failure-proof">
          <strong>当前未显示任何伪造成功状态</strong>
          <span>
            原创建键会被保留；安全重试只会恢复同一个成功结果，不会生成重复沙箱或重复种子。
          </span>
          {failure.requestId ? (
            <code>请求关联 ID {failure.requestId}</code>
          ) : null}
        </div>
        <div className="state-actions">
          <button
            className="button primary-button"
            onClick={onRetry}
            type="button"
          >
            使用原请求安全重试
            <ArrowRight weight="bold" />
          </button>
          <button
            className="button secondary-button"
            onClick={onBack}
            type="button"
          >
            返回角色入口
          </button>
        </div>
      </section>
    </main>
  );
}

function ContextCheckFailureView({
  failure,
  onRetry,
}: {
  failure: FailureState;
  onRetry: () => void;
}) {
  return (
    <main className="state-page">
      <PublicHeader />
      <section className="state-card failure-card" role="alert">
        <div className="state-icon is-warning">
          <Warning weight="duotone" />
        </div>
        <span className="eyebrow">现有会话保护</span>
        <h1>暂时无法确认已有角色上下文</h1>
        <p>{failure.message}</p>
        <div className="failure-proof">
          <strong>确认完成前不会创建新的可写沙箱</strong>
          <span>
            这可避免瞬时网络或数据库故障覆盖仍然有效的演示会话；请安全重试当前检查。
          </span>
          {failure.requestId ? (
            <code>请求关联 ID {failure.requestId}</code>
          ) : null}
        </div>
        <div className="state-actions">
          <button
            className="button primary-button"
            onClick={onRetry}
            type="button"
          >
            重试确认
            <ArrowRight weight="bold" />
          </button>
        </div>
      </section>
    </main>
  );
}

export default function PublicEntryPage() {
  const [stage, setStage] = useState<CreationStage>("checking");
  const [selectedRole, setSelectedRole] = useState<PublicRole>("customer");
  const [creationKey, setCreationKey] = useState("");
  const [result, setResult] = useState<PublicSandboxReadyResponse | null>(null);
  const [roleContext, setRoleContext] =
    useState<RoleContextReadyResponse | null>(null);
  const [failure, setFailure] = useState<FailureState>({
    message: "演示世界暂时无法创建，请稍后安全重试。",
  });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    void requestExistingRoleContext(controller.signal)
      .then(({ payload, response }) => {
        if (!active) return;
        if (!response.ok) {
          const apiError = payload as ApiErrorResponse | null;
          if (response.status === 401 && isEndedRoleContext(apiError)) {
            setStage("entry");
            return;
          }
          setFailure({
            message:
              apiError?.error?.message ??
              "角色上下文暂时无法确认，请稍后安全重试。",
            ...(apiError?.error?.requestId
              ? { requestId: apiError.error.requestId }
              : {}),
          });
          setStage("context-error");
          return;
        }
        const context = payload as RoleContextReadyResponse;
        if (context.status !== "ready") {
          throw new Error("The role-context response was incomplete.");
        }
        setRoleContext(context);
        setStage("shell");
      })
      .catch(() => {
        if (!active) return;
        setFailure({ message: "角色上下文暂时无法确认，请稍后安全重试。" });
        setStage("context-error");
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  async function enterRoleContext() {
    setStage("checking");
    try {
      const { payload, response } = await requestExistingRoleContext();
      if (!response.ok) {
        const apiError = payload as ApiErrorResponse;
        if (response.status === 401 && isEndedRoleContext(apiError)) {
          returnToEntry();
          return;
        }
        setFailure({
          message:
            apiError.error?.message ??
            "角色上下文暂时无法确认，请稍后安全重试。",
          ...(apiError.error?.requestId
            ? { requestId: apiError.error.requestId }
            : {}),
        });
        setStage("context-error");
        return;
      }
      const context = payload as RoleContextReadyResponse;
      if (context.status !== "ready") {
        throw new Error("The role-context response was incomplete.");
      }
      setRoleContext(context);
      setStage("shell");
    } catch {
      setFailure({ message: "角色上下文暂时无法确认，请稍后安全重试。" });
      setStage("context-error");
    }
  }

  async function createSandbox(role: PublicRole, key: string) {
    setStage("creating");
    setSelectedRole(role);
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );

    try {
      const visitorResponse = await fetch("/api/v1/public/visitor", {
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
        signal: controller.signal,
      });
      if (!visitorResponse.ok) {
        const visitorError = (await visitorResponse
          .json()
          .catch(() => null)) as ApiErrorResponse | null;
        setFailure({
          message:
            visitorError?.error?.message ??
            "访客上下文无法建立，请稍后安全重试。",
          ...(visitorError?.error?.requestId
            ? { requestId: visitorError.error.requestId }
            : {}),
        });
        setStage("error");
        return;
      }

      const response = await fetch("/api/v1/public/sandboxes", {
        body: JSON.stringify({ role }),
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        method: "POST",
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const apiError = payload as ApiErrorResponse;
        setFailure({
          message:
            apiError.error?.message ??
            "演示世界创建失败，未保存部分数据；你可以安全重试。",
          requestId: apiError.error?.requestId,
        });
        setStage(
          response.status === 504 ||
            apiError.error?.code === "SANDBOX_CREATION_TIMEOUT"
            ? "timeout"
            : "error",
        );
        return;
      }

      const ready = payload as PublicSandboxReadyResponse;
      if (ready.status !== "ready" || !ready.world || !ready.persona) {
        throw new Error("The sandbox response was incomplete.");
      }
      setResult(ready);
      setStage("ready");
    } catch (error) {
      const timedOut =
        error instanceof DOMException && error.name === "AbortError";
      setFailure({
        message: timedOut
          ? "创建结果仍在确认中，请使用原请求重试。"
          : "演示世界创建失败，未保存部分数据；你可以安全重试。",
      });
      setStage(timedOut ? "timeout" : "error");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function startCreation(role: PublicRole) {
    const key = crypto.randomUUID();
    setCreationKey(key);
    void createSandbox(role, key);
  }

  function returnToEntry() {
    setStage("entry");
    setResult(null);
    setRoleContext(null);
    setCreationKey("");
  }

  if (stage === "checking") return <ExistingContextCheck />;
  if (stage === "context-error")
    return (
      <ContextCheckFailureView
        failure={failure}
        onRetry={() => void enterRoleContext()}
      />
    );
  if (stage === "creating") return <CreationProgress role={selectedRole} />;
  if (stage === "ready" && result)
    return (
      <ReadyWorld
        result={result}
        onBack={returnToEntry}
        onEnter={() => void enterRoleContext()}
      />
    );
  if (stage === "shell" && roleContext)
    return (
      <RoleContextShell
        context={roleContext}
        onContextChange={setRoleContext}
        onContextUnavailable={returnToEntry}
      />
    );
  if (stage === "error" || stage === "timeout")
    return (
      <FailureView
        failure={failure}
        kind={stage}
        onBack={returnToEntry}
        onRetry={() => void createSandbox(selectedRole, creationKey)}
      />
    );

  return <PublicEntry onCreate={startCreation} />;
}
