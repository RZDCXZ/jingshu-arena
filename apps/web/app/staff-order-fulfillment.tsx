"use client";

import {
  ArrowRight,
  CheckCircle,
  MagnifyingGlass,
  Package,
  Receipt,
  SidebarSimple,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CustomerOrderStatus,
  StaffOrderAction,
  StaffOrderCommandResponse,
  StaffOrderDetailResponse,
  StaffOrderQueueResponse,
  StaffOrderStageFilter,
  StaffOrderSummaryResponse,
} from "@jingshu/contracts";

const statusLabels: Record<CustomerOrderStatus, string> = {
  cancelled: "已取消",
  completed: "已完成",
  expired: "已过期",
  "pending-simulated-payment": "待模拟支付",
  preparing: "制作中",
  "ready-for-pickup": "待取",
  "simulated-paid": "已模拟支付",
};

const eventLabels: Record<string, string> = {
  "order.cancelled": "订单已取消",
  "order.completed": "订单已完成",
  "order.inventory-reserved": "整单库存已预留",
  "order.marked-ready": "已标记待取",
  "order.preparing-started": "已开始制作",
  "order.simulated-payment-succeeded": "模拟支付成功",
};

const stageTabs: ReadonlyArray<{
  key: StaffOrderStageFilter;
  label: string;
}> = [
  { key: "all", label: "全部" },
  { key: "simulated-paid", label: "待制作" },
  { key: "preparing", label: "制作中" },
  { key: "ready-for-pickup", label: "待取" },
  { key: "exception", label: "异常" },
];

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    currency: "CNY",
    style: "currency",
  }).format(value / 100);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "商品订单数据暂时不可用。");
  }
  return payload;
}

function stageCount(
  queue: StaffOrderQueueResponse | null,
  stage: StaffOrderStageFilter,
) {
  if (!queue) return 0;
  if (stage === "all") return queue.rows.length;
  return queue.counts[stage];
}

function OrderRow({
  onSelect,
  selected,
  summary,
}: {
  onSelect: () => void;
  selected: boolean;
  summary: StaffOrderSummaryResponse;
}) {
  return (
    <button
      aria-pressed={selected}
      className={`staff-order-row${selected ? " is-selected" : ""}`}
      onClick={onSelect}
      type="button"
    >
      <time>{formatTime(summary.stageEnteredAt)}</time>
      <span className="staff-order-person">
        <strong>{summary.customerDisplayName} · 虚构人物</strong>
        <small>{summary.reservation.seatCode} · 关联预约</small>
      </span>
      <span className="staff-order-items">{summary.itemSummary}</span>
      <strong>{formatMoney(summary.amountCents)}</strong>
      <span className={`role-status-pill is-${summary.status}`}>
        {statusLabels[summary.status]}
      </span>
      <span className="staff-order-wait">
        等待 {summary.waitingMinutes} 分钟
      </span>
      <ArrowRight />
    </button>
  );
}

function CancelOrderDialog({
  error,
  onClose,
  onSubmit,
  submitting,
}: {
  error: string;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  submitting: boolean;
}) {
  const [reason, setReason] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("textarea")?.focus();
    return () => returnFocusRef.current?.focus();
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !submitting) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), textarea:not(:disabled)",
      ) ?? [],
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const trimmedReason = reason.trim();
  return (
    <div className="staff-command-backdrop">
      <div
        aria-labelledby="staff-order-cancel-title"
        aria-modal="true"
        className="staff-command-dialog"
        onKeyDown={handleKeyDown}
        ref={panelRef}
        role="dialog"
      >
        <div className="staff-command-heading">
          <span>
            <Warning />
          </span>
          <div>
            <small>商品订单履约动作</small>
            <h2 id="staff-order-cancel-title">取消商品订单</h2>
          </div>
          <button
            aria-label="关闭取消商品订单"
            disabled={submitting}
            onClick={onClose}
            type="button"
          >
            <X />
          </button>
        </div>
        <p>
          服务端会按当前履约阶段原子决定库存释放或损耗、模拟退款与体验券恢复结果。
        </p>
        <label className="staff-command-reason">
          <span>取消原因</span>
          <textarea
            aria-label="取消原因"
            maxLength={200}
            onChange={(event) => setReason(event.target.value)}
            placeholder="请输入 1–200 字纯文本原因"
            rows={4}
            value={reason}
          />
          <small>请勿填写真实个人信息 · {reason.length}/200</small>
        </label>
        {error ? (
          <p className="staff-command-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="staff-command-actions">
          <button disabled={submitting} onClick={onClose} type="button">
            返回
          </button>
          <button
            className="is-primary"
            disabled={submitting || trimmedReason.length === 0}
            onClick={() => onSubmit(trimmedReason)}
            type="button"
          >
            {submitting ? "正在提交取消订单" : error ? "重试取消" : "确认取消"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderInspector({
  commandError,
  detail,
  error,
  loading,
  onCancel,
  onClose,
  onPrimary,
  submitting,
}: {
  commandError: string;
  detail: StaffOrderDetailResponse | null;
  error: string;
  loading: boolean;
  onCancel: () => void;
  onClose: () => void;
  onPrimary: (action: Exclude<StaffOrderAction, "cancel">) => void;
  submitting: StaffOrderAction | null;
}) {
  return (
    <aside
      aria-label="商品订单详情"
      className="role-inspector staff-order-inspector"
    >
      <div className="role-inspector-title">
        <h2>订单详情</h2>
        <button onClick={onClose} type="button">
          收起
        </button>
      </div>
      {loading ? (
        <p className="staff-inspector-state">正在读取服务端详情…</p>
      ) : null}
      {error ? <p className="staff-inspector-state is-error">{error}</p> : null}
      {detail ? (
        <>
          <section className="staff-order-identity">
            <h3>
              <Receipt />
              {detail.order.customerDisplayName} · 虚构人物
              <span>{statusLabels[detail.order.status]}</span>
            </h3>
            <dl>
              <div>
                <dt>订单</dt>
                <dd className="staff-order-mono">
                  {detail.order.orderId.slice(0, 8)}…
                </dd>
              </div>
              <div>
                <dt>座位</dt>
                <dd>{detail.order.reservation.seatCode}</dd>
              </div>
              <div>
                <dt>等待</dt>
                <dd>{detail.order.waitingMinutes} 分钟</dd>
              </div>
            </dl>
            {detail.actions.primary ? (
              <button
                aria-label={
                  submitting === detail.actions.primary.kind
                    ? `正在提交${detail.actions.primary.label}`
                    : detail.actions.primary.label
                }
                className="staff-detail-primary"
                disabled={submitting !== null}
                onClick={() => onPrimary(detail.actions.primary!.kind)}
                type="button"
              >
                {submitting === detail.actions.primary.kind
                  ? `正在提交${detail.actions.primary.label}`
                  : detail.actions.primary.label}
                <ArrowRight />
              </button>
            ) : (
              <p className="staff-terminal-note">
                订单已进入终态，不再提供履约动作。
              </p>
            )}
            {detail.actions.canCancel ? (
              <button
                className="staff-detail-cancel"
                disabled={submitting !== null}
                onClick={onCancel}
                type="button"
              >
                取消订单
              </button>
            ) : null}
            {commandError ? (
              <p className="staff-order-command-error" role="alert">
                {commandError}
              </p>
            ) : null}
          </section>
          <section className="staff-order-snapshot">
            <h3>商品快照</h3>
            <ul>
              {detail.snapshot.lines.map((line) => (
                <li key={line.productId}>
                  <span>
                    {line.productName} × {line.quantity}
                  </span>
                  <strong>{formatMoney(line.lineTotalCents)}</strong>
                </li>
              ))}
              {detail.snapshot.coupon ? (
                <li>
                  <span>{detail.snapshot.coupon.displayName}</span>
                  <strong>-{formatMoney(detail.snapshot.discountCents)}</strong>
                </li>
              ) : null}
            </ul>
            <p>
              <span>最终模拟金额</span>
              <strong>{formatMoney(detail.snapshot.payableCents)}</strong>
            </p>
          </section>
          <section>
            <h3>库存与关联</h3>
            <dl>
              <div>
                <dt>库存预留</dt>
                <dd>
                  {detail.inventory.every(
                    (item) => item.reservationStatus === "active",
                  )
                    ? "整单已预留"
                    : detail.inventory
                        .map((item) => item.reservationStatus)
                        .join("、")}
                </dd>
              </div>
              <div>
                <dt>关联预约</dt>
                <dd>{detail.order.reservation.reservationId.slice(0, 8)}…</dd>
              </div>
              <div>
                <dt>预约状态</dt>
                <dd>{detail.order.reservation.status}</dd>
              </div>
              {detail.refund ? (
                <div>
                  <dt>模拟退款</dt>
                  <dd>{formatMoney(detail.refund.amountCents)}</dd>
                </div>
              ) : null}
              {detail.growth ? (
                <div>
                  <dt>成长值</dt>
                  <dd>+{detail.growth.growthPoints}</dd>
                </div>
              ) : null}
            </dl>
          </section>
          <section>
            <h3>不可变履约事件</h3>
            <ol>
              {detail.timeline.map((event, index) => (
                <li key={`${event.occurredAt}-${event.type}-${index}`}>
                  <CheckCircle weight="fill" />
                  <span>
                    <time>{formatTime(event.occurredAt)}</time>
                    <strong>{eventLabels[event.type] ?? event.type}</strong>
                    <small>{formatDateTime(event.occurredAt)}</small>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : null}
    </aside>
  );
}

export function StaffOrderFulfillment({
  csrfToken,
  filter,
  inspectorOpen,
  onFilter,
  onFilterDirty,
  onInspector,
  onToast,
  refreshKey,
}: {
  csrfToken: string;
  filter: string;
  inspectorOpen: boolean;
  onFilter: (value: string) => void;
  onFilterDirty: (dirty: boolean) => void;
  onInspector: (value: boolean) => void;
  onToast: (message: string) => void;
  refreshKey: string;
}) {
  const [stage, setStage] = useState<StaffOrderStageFilter>("all");
  const [queue, setQueue] = useState<StaffOrderQueueResponse | null>(null);
  const [detail, setDetail] = useState<StaffOrderDetailResponse | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [commandError, setCommandError] = useState("");
  const [submitting, setSubmitting] = useState<StaffOrderAction | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [outcome, setOutcome] = useState("");
  const retryRef = useRef<{
    action: StaffOrderAction;
    key: string;
    reason?: string;
  } | null>(null);

  useEffect(() => {
    onFilterDirty(stage !== "all");
  }, [onFilterDirty, stage]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch(`/api/v1/staff/orders?stage=${stage}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(readJson<StaffOrderQueueResponse>)
      .then((payload) => {
        setQueue(payload);
        setSelectedId((current) =>
          payload.rows.some((row) => row.orderId === current)
            ? current
            : (payload.rows[0]?.orderId ?? ""),
        );
      })
      .catch((loadError: Error) => {
        if (loadError.name !== "AbortError") setError(loadError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey, refreshNonce, stage]);

  useEffect(() => {
    if (!selectedId || !inspectorOpen) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError("");
    void fetch(`/api/v1/staff/orders/${selectedId}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(readJson<StaffOrderDetailResponse>)
      .then(setDetail)
      .catch((loadError: Error) => {
        if (loadError.name !== "AbortError") setDetailError(loadError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [inspectorOpen, refreshKey, refreshNonce, selectedId]);

  const normalizedFilter = filter.trim().toLocaleLowerCase("zh-CN");
  const rows = useMemo(
    () =>
      (queue?.rows ?? []).filter((row) =>
        normalizedFilter
          ? `${row.orderId} ${row.customerDisplayName} ${row.itemSummary} ${row.reservation.seatCode}`
              .toLocaleLowerCase("zh-CN")
              .includes(normalizedFilter)
          : true,
      ),
    [normalizedFilter, queue?.rows],
  );

  function selectOrder(orderId: string) {
    setSelectedId(orderId);
    setCommandError("");
    onInspector(true);
  }

  async function submitCommand(action: StaffOrderAction, reason?: string) {
    if (!selectedId) return;
    const previous = retryRef.current;
    const attempt =
      previous?.action === action && previous.reason === reason
        ? previous
        : { action, key: crypto.randomUUID(), ...(reason ? { reason } : {}) };
    retryRef.current = attempt;
    setSubmitting(action);
    setCommandError("");
    try {
      const response = await fetch(
        `/api/v1/staff/orders/${selectedId}/commands`,
        {
          body: JSON.stringify({
            action,
            ...(reason ? { reason } : {}),
          }),
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": attempt.key,
            "X-CSRF-Token": csrfToken,
          },
          method: "POST",
        },
      );
      const result = await readJson<StaffOrderCommandResponse>(response);
      const resultParts = [
        statusLabels[result.status],
        result.simulatedRefundCents
          ? `模拟退款 ${formatMoney(result.simulatedRefundCents)}`
          : "",
        result.inventoryEffect === "waste"
          ? "库存记为损耗"
          : result.inventoryEffect === "release"
            ? "库存预留已释放"
            : result.inventoryEffect === "sale"
              ? "库存已售出"
              : "库存预留保持",
        result.growthPoints ? `成长值 +${result.growthPoints}` : "",
        result.couponRestored ? "体验券已恢复" : "",
      ].filter(Boolean);
      const message = result.replayed
        ? `同一请求已安全重放 · ${resultParts.join(" · ")}`
        : resultParts.join(" · ");
      setOutcome(message);
      onToast(message);
      setCancelOpen(false);
      retryRef.current = null;
      setRefreshNonce((value) => value + 1);
    } catch (submitError) {
      setCommandError((submitError as Error).message);
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className={`role-workbench ${inspectorOpen ? "has-inspector" : ""}`}>
      <main className="role-workbench-main staff-order-main">
        <div className="role-page-title staff-order-title">
          <div>
            <span>
              <Package />
            </span>
            <div>
              <h1>商品订单</h1>
              <small>
                {queue?.store.displayName ?? "当前门店"} ·
                已支付订单严格按履约阶段推进
              </small>
            </div>
          </div>
          <div className="role-page-tools">
            <label>
              <MagnifyingGlass />
              <input
                aria-label="搜索商品订单"
                onChange={(event) => onFilter(event.target.value)}
                placeholder="订单 / 顾客 / 商品"
                type="search"
                value={filter}
              />
            </label>
            {!inspectorOpen ? (
              <button onClick={() => onInspector(true)} type="button">
                <SidebarSimple />
                <span>展开详情</span>
              </button>
            ) : null}
          </div>
        </div>
        <div
          aria-label="订单履约阶段"
          className="staff-order-tabs"
          role="tablist"
        >
          {stageTabs.map((tab) => (
            <button
              aria-selected={stage === tab.key}
              className={stage === tab.key ? "is-active" : ""}
              key={tab.key}
              onClick={() => {
                setStage(tab.key);
                setOutcome("");
              }}
              role="tab"
              type="button"
            >
              {tab.label} <strong>{stageCount(queue, tab.key)}</strong>
            </button>
          ))}
        </div>
        {outcome ? (
          <p className="staff-order-outcome" role="status">
            <CheckCircle weight="fill" />
            {outcome}
          </p>
        ) : null}
        {loading ? (
          <p className="staff-order-state">正在读取履约队列…</p>
        ) : null}
        {error ? (
          <div className="role-empty-state">
            <Warning />
            <strong>商品订单队列暂时不可用</strong>
            <p>{error}</p>
            <button
              onClick={() => setRefreshNonce((value) => value + 1)}
              type="button"
            >
              重试读取
            </button>
          </div>
        ) : null}
        {!loading && !error ? (
          <section aria-label="商品订单履约队列" className="staff-order-table">
            <div aria-hidden="true" className="staff-order-table-head">
              <span>阶段时间</span>
              <span>顾客 / 座位</span>
              <span>商品快照</span>
              <span>模拟金额</span>
              <span>履约状态</span>
              <span>等待</span>
              <span />
            </div>
            {rows.map((row) => (
              <OrderRow
                key={row.orderId}
                onSelect={() => selectOrder(row.orderId)}
                selected={row.orderId === selectedId}
                summary={row}
              />
            ))}
            {rows.length === 0 ? (
              <p className="staff-order-empty">当前筛选下没有商品订单。</p>
            ) : null}
          </section>
        ) : null}
      </main>
      {inspectorOpen ? (
        <OrderInspector
          commandError={cancelOpen ? "" : commandError}
          detail={detail}
          error={detailError}
          loading={detailLoading}
          onCancel={() => {
            retryRef.current = null;
            setCommandError("");
            setCancelOpen(true);
          }}
          onClose={() => onInspector(false)}
          onPrimary={(action) => {
            retryRef.current = null;
            void submitCommand(action);
          }}
          submitting={submitting}
        />
      ) : null}
      {cancelOpen ? (
        <CancelOrderDialog
          error={commandError}
          onClose={() => {
            if (submitting === null) {
              setCancelOpen(false);
              setCommandError("");
              retryRef.current = null;
            }
          }}
          onSubmit={(reason) => void submitCommand("cancel", reason)}
          submitting={submitting === "cancel"}
        />
      ) : null}
    </div>
  );
}
