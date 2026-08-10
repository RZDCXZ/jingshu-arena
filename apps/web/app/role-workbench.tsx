"use client";

import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  CheckCircle,
  MagnifyingGlass,
  Pulse,
  SidebarSimple,
  User,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CustomerReservationStatus,
  FrontlineReservationAction,
  StaffReservationAnomalyFilter,
  StaffReservationDetailResponse,
  StaffReservationListResponse,
  StaffReservationSummary,
  StaffReservationTimeFilter,
  StaffReservationWorkbenchResponse,
} from "@jingshu/contracts";
import { StaffShiftSummary } from "./staff-shift-attendance";

export interface StaffReservationPreset {
  readonly anomaly?: StaffReservationAnomalyFilter;
  readonly status?: CustomerReservationStatus | "all";
  readonly time?: StaffReservationTimeFilter;
}

interface CommandDraft {
  readonly action: FrontlineReservationAction;
  readonly label: string;
  readonly requiresReason: boolean;
}

const statusLabels: Record<CustomerReservationStatus, string> = {
  arrived: "已到店",
  cancelled: "已取消",
  completed: "已完成",
  confirmed: "已确认",
  expired: "已过期",
  "in-use": "使用中",
  "pending-confirmation": "待确认",
};

const eventLabels: Record<string, string> = {
  "reservation.arrived": "已办理到店",
  "reservation.auto-completed": "到计划结束时间，自动完成",
  "reservation.cancelled": "预约已取消",
  "reservation.completed-early": "已提前结束",
  "reservation.pending-created": "预约已创建",
  "reservation.simulated-payment-succeeded": "模拟支付成功",
  "reservation.started": "已开始使用",
};

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

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    currency: "CNY",
    style: "currency",
  }).format(value / 100);
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "预约现场数据暂时不可用。");
  }
  return payload;
}

function ReservationRow({
  emphasized = false,
  onSelect,
  selected,
  summary,
}: {
  emphasized?: boolean;
  onSelect: () => void;
  selected: boolean;
  summary: StaffReservationSummary;
}) {
  return (
    <button
      aria-pressed={selected}
      className={`role-queue-row${emphasized ? " is-primary" : ""}${
        selected ? " is-selected" : ""
      }`}
      onClick={onSelect}
      type="button"
    >
      <time>{formatTime(summary.window.startsAt)}</time>
      <span className="role-row-person">
        <strong>
          <User weight="fill" />
          {summary.customer.displayName} · 虚构人物
        </strong>
        {summary.anomaly ? (
          <small className="is-anomaly">{summary.anomaly.label}</small>
        ) : null}
      </span>
      <span className="role-row-detail is-schedule">
        <span>
          {formatTime(summary.window.startsAt)}–
          {formatTime(summary.window.endsAt)}
        </span>
        <small>
          到店 {formatTime(summary.arrivalWindow.opensAt)}–
          {formatTime(summary.arrivalWindow.closesAt)}
        </small>
      </span>
      <span className="role-row-detail is-seat">
        <small>{summary.area.displayName}</small>
        <strong>{summary.seat.code}</strong>
      </span>
      <span className={`role-status-pill is-${summary.status}`}>
        {statusLabels[summary.status]}
      </span>
      {emphasized ? (
        <span className="role-primary-action">
          查看任务
          <ArrowRight />
        </span>
      ) : (
        <strong>{formatMoney(summary.payableCents)}</strong>
      )}
    </button>
  );
}

function CommandDialog({
  draft,
  error,
  onClose,
  onSubmit,
  submitting,
}: {
  draft: CommandDraft;
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
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("textarea, button")?.focus();
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
        aria-labelledby="staff-command-title"
        aria-modal="true"
        className="staff-command-dialog"
        onKeyDown={handleKeyDown}
        ref={panelRef}
        role="dialog"
      >
        <div className="staff-command-heading">
          <span>{draft.requiresReason ? <Warning /> : <CheckCircle />}</span>
          <div>
            <small>预约现场动作</small>
            <h2 id="staff-command-title">确认{draft.label}</h2>
          </div>
          <button
            aria-label="关闭"
            disabled={submitting}
            onClick={onClose}
            type="button"
          >
            <X />
          </button>
        </div>
        <p>
          提交后由服务端原子校验当前状态、时间窗口和门店范围，并写入不可变业务事件。
        </p>
        {draft.requiresReason ? (
          <label className="staff-command-reason">
            <span>办理原因</span>
            <textarea
              maxLength={200}
              onChange={(event) => setReason(event.target.value)}
              placeholder="请输入 1–200 字纯文本原因"
              rows={4}
              value={reason}
            />
            <small>请勿填写真实个人信息 · {reason.length}/200</small>
          </label>
        ) : null}
        {error ? <p className="staff-command-error">{error}</p> : null}
        <div className="staff-command-actions">
          <button disabled={submitting} onClick={onClose} type="button">
            返回
          </button>
          <button
            className="is-primary"
            disabled={
              submitting || (draft.requiresReason && trimmedReason.length === 0)
            }
            onClick={() => onSubmit(trimmedReason)}
            type="button"
          >
            {submitting ? "服务端办理中…" : `确认${draft.label}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReservationInspector({
  detail,
  error,
  loading,
  onClose,
  onCommand,
}: {
  detail: StaffReservationDetailResponse | null;
  error: string;
  loading: boolean;
  onClose: () => void;
  onCommand: (draft: CommandDraft) => void;
}) {
  return (
    <aside
      className="role-inspector staff-reservation-inspector"
      aria-label="当前选中对象"
    >
      <div className="role-inspector-title">
        <h2>预约详情</h2>
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
          <section className="staff-detail-identity">
            <h3>
              <User weight="fill" />
              {detail.reservation.customer.displayName} · 虚构人物
              <span>{statusLabels[detail.reservation.status]}</span>
            </h3>
            <dl>
              <div>
                <dt>计划时间</dt>
                <dd>
                  {formatDateTime(detail.reservation.window.startsAt)}–
                  {formatTime(detail.reservation.window.endsAt)}
                </dd>
              </div>
              <div>
                <dt>座位</dt>
                <dd>
                  {detail.reservation.area.displayName} ·{" "}
                  {detail.reservation.seat.code}
                </dd>
              </div>
              <div>
                <dt>机型</dt>
                <dd>{detail.snapshot.machineProfile.displayName}</dd>
              </div>
              <div>
                <dt>价格快照</dt>
                <dd>{formatMoney(detail.snapshot.price.payableCents)}</dd>
              </div>
              {detail.terminalReason ? (
                <div>
                  <dt>终态原因</dt>
                  <dd>{detail.terminalReason}</dd>
                </div>
              ) : null}
            </dl>
            {detail.actions.primary ? (
              <button
                className="staff-detail-primary"
                onClick={() =>
                  onCommand({
                    action: detail.actions.primary!.kind,
                    label: detail.actions.primary!.label,
                    requiresReason: detail.actions.primary!.requiresReason,
                  })
                }
                type="button"
              >
                {detail.actions.primary.label}
                <ArrowRight />
              </button>
            ) : (
              <p className="staff-terminal-note">
                {detail.reservation.status === "arrived"
                  ? "已完成到店登记；计划开始后才可开始使用。"
                  : detail.reservation.status === "pending-confirmation"
                    ? "预约仍待顾客完成模拟支付；保留期内可带原因取消。"
                    : detail.reservation.status === "confirmed"
                      ? "当前不在可办理到店的时间窗口内。"
                      : detail.reservation.status === "in-use"
                        ? "使用中预约将在计划结束时间自动完成。"
                        : "预约已进入终态，不再提供办理动作。"}
              </p>
            )}
            {detail.actions.canCancel ? (
              <button
                className="staff-detail-cancel"
                onClick={() =>
                  onCommand({
                    action: "cancel",
                    label: "取消预约",
                    requiresReason: true,
                  })
                }
                type="button"
              >
                取消预约
              </button>
            ) : null}
          </section>
          <section className="staff-price-segments">
            <h3>价格快照</h3>
            <ul>
              {detail.snapshot.price.segments.map((segment) => (
                <li key={`${segment.startsAt}-${segment.endsAt}`}>
                  <span>
                    {formatTime(segment.startsAt)}–{formatTime(segment.endsAt)}
                  </span>
                  <strong>{formatMoney(segment.amountCents)}</strong>
                </li>
              ))}
            </ul>
            <p>
              <span>应付合计</span>
              <strong>{formatMoney(detail.snapshot.price.payableCents)}</strong>
            </p>
          </section>
          <section>
            <h3>相关对象</h3>
            <div className="staff-related-grid">
              <span>商品订单</span>
              <strong>
                {detail.related.orders.length
                  ? detail.related.orders.length
                  : "暂无"}
              </strong>
              <span>座位报修</span>
              <strong>
                {detail.related.repairs.length
                  ? detail.related.repairs.length
                  : "暂无"}
              </strong>
              <span>模拟退款</span>
              <strong>
                {detail.refund
                  ? formatMoney(detail.refund.amountCents)
                  : "暂无"}
              </strong>
            </div>
          </section>
          <section>
            <h3>不可变业务事件</h3>
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
            <p className="staff-audit-note">
              {detail.auditAvailable
                ? "当前角色可在审计页追溯对应写入。"
                : "业务事件只读；审计记录仅向获授权角色开放。"}
            </p>
          </section>
        </>
      ) : null}
    </aside>
  );
}

export function RoleWorkbench({
  csrfToken,
  filter,
  inspectorOpen,
  onFilter,
  onFilterDirty,
  onInspector,
  onNavigateReservations,
  onNavigateShift,
  onNavigateWorkbench,
  onToast,
  page,
  preset,
  refreshKey,
}: {
  csrfToken: string;
  filter: string;
  inspectorOpen: boolean;
  onFilter: (value: string) => void;
  onFilterDirty: (dirty: boolean) => void;
  onInspector: (value: boolean) => void;
  onNavigateReservations: (preset: StaffReservationPreset) => void;
  onNavigateShift?: () => void;
  onNavigateWorkbench: () => void;
  onToast: (message: string) => void;
  page: "reservations" | "workbench";
  preset: StaffReservationPreset;
  refreshKey: string;
}) {
  const [workbench, setWorkbench] =
    useState<StaffReservationWorkbenchResponse | null>(null);
  const [list, setList] = useState<StaffReservationListResponse | null>(null);
  const [detail, setDetail] = useState<StaffReservationDetailResponse | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [status, setStatus] = useState<CustomerReservationStatus | "all">(
    preset.status ?? "all",
  );
  const [time, setTime] = useState<StaffReservationTimeFilter>(
    preset.time ?? "all",
  );
  const [anomaly, setAnomaly] = useState<StaffReservationAnomalyFilter>(
    preset.anomaly ?? "all",
  );
  const [area, setArea] = useState("all");
  const [machine, setMachine] = useState("all");
  const [commandDraft, setCommandDraft] = useState<CommandDraft | null>(null);
  const [commandError, setCommandError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKeyRef = useRef("");

  useEffect(() => {
    setStatus(preset.status ?? "all");
    setTime(preset.time ?? "all");
    setAnomaly(preset.anomaly ?? "all");
  }, [preset.anomaly, preset.status, preset.time]);

  useEffect(() => {
    onFilterDirty(
      page === "reservations" &&
        (status !== "all" ||
          time !== "all" ||
          anomaly !== "all" ||
          area !== "all" ||
          machine !== "all"),
    );
  }, [anomaly, area, machine, onFilterDirty, page, status, time]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        if (page === "workbench") {
          const response = await fetch("/api/v1/staff/workbench", {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          });
          const payload =
            await readJson<StaffReservationWorkbenchResponse>(response);
          setWorkbench(payload);
          const rows = [
            ...payload.queues.arrivalWindow,
            ...payload.queues.arrived,
            ...payload.queues.inUse,
            ...payload.queues.anomalies,
          ];
          setSelectedId((current) => current || (rows[0]?.reservationId ?? ""));
        } else {
          const query = new URLSearchParams({
            anomaly,
            area,
            machine,
            status,
            time,
          });
          if (filter.trim()) query.set("search", filter.trim());
          const response = await fetch(
            `/api/v1/staff/reservations?${query.toString()}`,
            {
              cache: "no-store",
              credentials: "same-origin",
              signal: controller.signal,
            },
          );
          const payload =
            await readJson<StaffReservationListResponse>(response);
          setList(payload);
          setSelectedId((current) =>
            payload.rows.some((row) => row.reservationId === current)
              ? current
              : (payload.rows[0]?.reservationId ?? ""),
          );
        }
      } catch (loadError) {
        if ((loadError as Error).name !== "AbortError") {
          setError((loadError as Error).message);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [
    anomaly,
    area,
    filter,
    machine,
    page,
    refreshKey,
    refreshNonce,
    status,
    time,
  ]);

  useEffect(() => {
    if (!selectedId || !inspectorOpen) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError("");
    void fetch(`/api/v1/staff/reservations/${selectedId}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(readJson<StaffReservationDetailResponse>)
      .then(setDetail)
      .catch((loadError: Error) => {
        if (loadError.name !== "AbortError") setDetailError(loadError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [inspectorOpen, refreshKey, refreshNonce, selectedId]);

  const queueSections = useMemo(() => {
    if (!workbench) return [];
    return [
      {
        key: "arrival",
        label: "到店窗口",
        preset: { time: "arrival-window" } satisfies StaffReservationPreset,
        rows: workbench.queues.arrivalWindow,
      },
      {
        key: "arrived",
        label: "已到店待开始",
        preset: { status: "arrived" } satisfies StaffReservationPreset,
        rows: workbench.queues.arrived,
      },
      {
        key: "in-use",
        label: "使用中",
        preset: { status: "in-use" } satisfies StaffReservationPreset,
        rows: workbench.queues.inUse,
      },
      {
        key: "anomalies",
        label: "异常预约",
        preset: { anomaly: "only" } satisfies StaffReservationPreset,
        rows: workbench.queues.anomalies,
      },
    ];
  }, [workbench]);

  const normalizedFilter = filter.trim().toLocaleLowerCase("zh-CN");
  const visibleSections = queueSections.map((section) => ({
    ...section,
    rows: normalizedFilter
      ? section.rows.filter((row) =>
          `${row.customer.displayName} ${row.area.displayName} ${row.seat.code} ${
            statusLabels[row.status]
          } ${row.anomaly?.label ?? ""}`
            .toLocaleLowerCase("zh-CN")
            .includes(normalizedFilter),
        )
      : section.rows,
  }));

  function selectReservation(reservationId: string) {
    setSelectedId(reservationId);
    onInspector(true);
  }

  function openCommand(draft: CommandDraft) {
    idempotencyKeyRef.current = crypto.randomUUID();
    setCommandError("");
    setCommandDraft(draft);
  }

  async function submitCommand(reason: string) {
    if (!commandDraft || !selectedId) return;
    setSubmitting(true);
    setCommandError("");
    try {
      const response = await fetch(
        `/api/v1/staff/reservations/${selectedId}/commands`,
        {
          body: JSON.stringify({
            action: commandDraft.action,
            ...(commandDraft.requiresReason ? { reason } : {}),
          }),
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKeyRef.current,
            "X-CSRF-Token": csrfToken,
          },
          method: "POST",
        },
      );
      const result = await readJson<{
        replayed: boolean;
        status: CustomerReservationStatus;
      }>(response);
      setCommandDraft(null);
      idempotencyKeyRef.current = "";
      setRefreshNonce((value) => value + 1);
      onToast(
        result.replayed
          ? "同一办理请求已安全重放，详情已从服务端刷新。"
          : `${commandDraft.label}已写入，当前状态：${statusLabels[result.status]}。`,
      );
    } catch (submitError) {
      setCommandError((submitError as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const businessDay = workbench?.businessDay ?? list?.businessDay;
  return (
    <div className={`role-workbench ${inspectorOpen ? "has-inspector" : ""}`}>
      <main className="role-workbench-main staff-reservation-main">
        <div className="role-page-title staff-reservation-title">
          <div>
            <span>{page === "workbench" ? <Pulse /> : <CalendarCheck />}</span>
            <div>
              <h1>{page === "workbench" ? "现场脉冲" : "预约"}</h1>
              <small>
                {businessDay
                  ? `${businessDay.key} · 06:00 营业日`
                  : "当前 06:00 营业日"}
              </small>
            </div>
          </div>
          <div className="role-page-tools">
            <label>
              <MagnifyingGlass />
              <input
                aria-label="筛选当前队列"
                onChange={(event) => onFilter(event.target.value)}
                placeholder="顾客 / 座位"
                type="search"
                value={filter}
              />
            </label>
            {!inspectorOpen ? (
              <button
                aria-label="展开当前对象"
                onClick={() => onInspector(true)}
                type="button"
              >
                <SidebarSimple />
                <span>展开详情</span>
              </button>
            ) : null}
          </div>
        </div>

        {page === "workbench" && onNavigateShift ? (
          <StaffShiftSummary onOpen={onNavigateShift} refreshKey={refreshKey} />
        ) : null}

        {page === "reservations" ? (
          <div className="staff-filter-bar" aria-label="预约筛选">
            <button onClick={onNavigateWorkbench} type="button">
              <ArrowLeft /> 工作台
            </button>
            <label>
              <span>状态</span>
              <select
                aria-label="按状态筛选"
                onChange={(event) =>
                  setStatus(
                    event.target.value as CustomerReservationStatus | "all",
                  )
                }
                value={status}
              >
                <option value="all">全部状态</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>时间</span>
              <select
                aria-label="按时间筛选"
                onChange={(event) =>
                  setTime(event.target.value as StaffReservationTimeFilter)
                }
                value={time}
              >
                <option value="all">全天</option>
                <option value="arrival-window">到店窗口</option>
                <option value="upcoming">后续预约</option>
                <option value="in-progress">进行中</option>
              </select>
            </label>
            <label>
              <span>区域</span>
              <select
                aria-label="按区域筛选"
                onChange={(event) => setArea(event.target.value)}
                value={area}
              >
                <option value="all">全部区域</option>
                {list?.filterOptions.areas.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>机型</span>
              <select
                aria-label="按机型筛选"
                onChange={(event) => setMachine(event.target.value)}
                value={machine}
              >
                <option value="all">全部机型</option>
                {list?.filterOptions.machineProfiles.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>异常</span>
              <select
                aria-label="按异常筛选"
                onChange={(event) =>
                  setAnomaly(
                    event.target.value as StaffReservationAnomalyFilter,
                  )
                }
                value={anomaly}
              >
                <option value="all">全部</option>
                <option value="only">仅异常</option>
                <option value="none">排除异常</option>
              </select>
            </label>
          </div>
        ) : null}

        {loading ? (
          <p className="staff-reservation-state">正在读取门店预约…</p>
        ) : null}
        {error ? (
          <div className="staff-reservation-state is-error">
            <Warning />
            <strong>{error}</strong>
            <button
              onClick={() => setRefreshNonce((value) => value + 1)}
              type="button"
            >
              重试
            </button>
          </div>
        ) : null}

        {!loading && !error && page === "workbench" ? (
          <div className="staff-workbench-queues">
            {visibleSections.map((section, sectionIndex) => (
              <section
                className="role-queue-section"
                key={section.key}
                aria-labelledby={`staff-queue-${section.key}`}
              >
                <div className="role-section-heading">
                  <h2 id={`staff-queue-${section.key}`}>{section.label}</h2>
                  <button
                    onClick={() => onNavigateReservations(section.preset)}
                    type="button"
                  >
                    {section.rows.length} 项 · 查看全部 <ArrowRight />
                  </button>
                </div>
                {section.rows.length ? (
                  <div className="role-queue-list">
                    {section.rows.map((row, rowIndex) => (
                      <ReservationRow
                        emphasized={sectionIndex === 0 && rowIndex === 0}
                        key={row.reservationId}
                        onSelect={() => selectReservation(row.reservationId)}
                        selected={selectedId === row.reservationId}
                        summary={row}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="role-inline-empty">当前队列没有匹配预约。</p>
                )}
              </section>
            ))}
          </div>
        ) : null}

        {!loading && !error && page === "reservations" ? (
          <section className="role-queue-section staff-reservation-list">
            <div className="role-section-heading">
              <h2>当前营业日预约</h2>
              <span>{list?.rows.length ?? 0} 项结果</span>
            </div>
            {list?.rows.length ? (
              <div className="role-queue-list">
                {list.rows.map((row) => (
                  <ReservationRow
                    key={row.reservationId}
                    onSelect={() => selectReservation(row.reservationId)}
                    selected={selectedId === row.reservationId}
                    summary={row}
                  />
                ))}
              </div>
            ) : (
              <div className="role-empty-state">
                <CalendarCheck />
                <strong>当前筛选没有预约</strong>
                <button
                  onClick={() => {
                    setStatus("all");
                    setTime("all");
                    setAnomaly("all");
                    setArea("all");
                    setMachine("all");
                    onFilter("");
                  }}
                  type="button"
                >
                  清除筛选
                </button>
              </div>
            )}
          </section>
        ) : null}
      </main>

      {inspectorOpen ? (
        <ReservationInspector
          detail={detail}
          error={detailError}
          loading={detailLoading}
          onClose={() => onInspector(false)}
          onCommand={openCommand}
        />
      ) : null}

      {commandDraft ? (
        <CommandDialog
          draft={commandDraft}
          error={commandError}
          onClose={() => {
            if (!submitting) setCommandDraft(null);
          }}
          onSubmit={(reason) => void submitCommand(reason)}
          submitting={submitting}
        />
      ) : null}
    </div>
  );
}
