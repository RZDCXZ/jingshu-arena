"use client";

import {
  ArrowClockwise,
  BellRinging,
  CheckCircle,
  Handshake,
  Package,
  ShieldCheck,
  Ticket,
  UserCheck,
  Warning,
  Wrench,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type {
  ApiErrorResponse,
  HandoverCommandResponse,
  HandoverExceptionKind,
  ManagerHandoverExceptionsResponse,
  StaffHandover,
  StaffHandoverSnapshot,
  StaffHandoversResponse,
} from "@jingshu/contracts";

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
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = payload as ApiErrorResponse | null;
    throw new Error(
      failure?.error.message ?? "交接班数据暂时不可用，请稍后安全重试。",
    );
  }
  return payload as T;
}

const snapshotSections = [
  ["reservations", "未完成预约", Ticket],
  ["orders", "商品订单", Package],
  ["repairs", "报修", Wrench],
  ["lowStockAlerts", "低库存告警", BellRinging],
] as const;

function SnapshotCounts({ snapshot }: { snapshot: StaffHandoverSnapshot }) {
  return (
    <div className="handover-snapshot-counts">
      {snapshotSections.map(([key, label, Icon]) => (
        <section key={key}>
          <Icon weight="duotone" />
          <span>{label}</span>
          <strong>{snapshot[key].length}</strong>
        </section>
      ))}
    </div>
  );
}

function SnapshotDetails({ snapshot }: { snapshot: StaffHandoverSnapshot }) {
  return (
    <div className="handover-snapshot-details">
      <section>
        <h3>未完成预约</h3>
        {snapshot.reservations.length ? (
          <ul>
            {snapshot.reservations.map((reservation) => (
              <li key={reservation.reservationId}>
                <strong>
                  {reservation.seatCode} · {reservation.customerDisplayName}
                </strong>
                <span>
                  {formatDateTime(reservation.startsAt)}–
                  {formatDateTime(reservation.endsAt)} · {reservation.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>提交时没有未完成预约。</p>
        )}
      </section>
      <section>
        <h3>商品订单</h3>
        {snapshot.orders.length ? (
          <ul>
            {snapshot.orders.map((order) => (
              <li key={order.orderId}>
                <strong>
                  {order.seatCode} · {order.lineSummary}
                </strong>
                <span>{order.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>提交时没有未完成商品订单。</p>
        )}
      </section>
      <section>
        <h3>报修</h3>
        {snapshot.repairs.length ? (
          <ul>
            {snapshot.repairs.map((repair) => (
              <li key={repair.repairId}>
                <strong>
                  {repair.seatCode} · {repair.description}
                </strong>
                <span>
                  {repair.priority} · {repair.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>提交时没有未关闭报修。</p>
        )}
      </section>
      <section>
        <h3>低库存告警</h3>
        {snapshot.lowStockAlerts.length ? (
          <ul>
            {snapshot.lowStockAlerts.map((alert) => (
              <li key={alert.inventoryItemId}>
                <strong>{alert.displayName}</strong>
                <span>
                  可用 {alert.availableQuantity} · 阈值{" "}
                  {alert.lowStockThreshold}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>提交时没有低库存告警。</p>
        )}
      </section>
    </div>
  );
}

function HandoverEvidence({ handover }: { handover: StaffHandover }) {
  return (
    <section className="handover-evidence">
      <div>
        <ShieldCheck weight="duotone" />
        <span>
          <small>冻结于</small>
          <strong>{formatDateTime(handover.snapshot.capturedAt)}</strong>
        </span>
      </div>
      <div>
        <Handshake weight="duotone" />
        <span>
          <small>交班提交</small>
          <strong>
            {handover.submittedBy.displayName} · 业务时间{" "}
            {formatDateTime(handover.submittedAt.businessOccurredAt)}
          </strong>
          <em>
            真实服务器记录 {formatDateTime(handover.submittedAt.recordedAt)}
          </em>
        </span>
      </div>
      <div>
        <UserCheck weight="duotone" />
        <span>
          <small>接班确认</small>
          <strong>
            {handover.confirmed
              ? `${handover.confirmed.by.displayName} · 业务时间 ${formatDateTime(handover.confirmed.businessOccurredAt)}`
              : "等待另一名已签到同店员工确认"}
          </strong>
          {handover.confirmed ? (
            <em>
              真实服务器记录 {formatDateTime(handover.confirmed.recordedAt)}
            </em>
          ) : null}
        </span>
      </div>
    </section>
  );
}

export function StaffHandoverPanel({
  csrfToken,
  onToast,
  refreshKey,
}: {
  csrfToken: string;
  onToast: (message: string) => void;
  refreshKey: string;
}) {
  const [data, setData] = useState<StaffHandoversResponse | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyTarget, setBusyTarget] = useState("");
  const [error, setError] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const retryRef = useRef<{
    idempotencyKey: string;
    kind: "confirm" | "submit";
    targetId: string;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch("/api/v1/staff/handovers", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(readJson<StaffHandoversResponse>)
      .then((result) => {
        setData(result);
        if (result.outgoing?.handover) {
          setNote(result.outgoing.handover.note);
        }
      })
      .catch((loadError: Error) => {
        if (loadError.name !== "AbortError") setError(loadError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey, refreshNonce]);

  async function runCommand(kind: "confirm" | "submit", targetId: string) {
    if (
      !retryRef.current ||
      retryRef.current.kind !== kind ||
      retryRef.current.targetId !== targetId
    ) {
      retryRef.current = {
        idempotencyKey: crypto.randomUUID(),
        kind,
        targetId,
      };
    }
    const retry = retryRef.current;
    setBusyTarget(`${kind}:${targetId}`);
    setError("");
    try {
      const response = await fetch(
        kind === "submit"
          ? "/api/v1/staff/handovers"
          : `/api/v1/staff/handovers/${targetId}/confirmation`,
        {
          body: JSON.stringify(
            kind === "submit" ? { note, shiftId: targetId } : {},
          ),
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": retry.idempotencyKey,
            "X-CSRF-Token": csrfToken,
          },
          method: "POST",
        },
      );
      const result = await readJson<HandoverCommandResponse>(response);
      retryRef.current = null;
      setRefreshNonce((value) => value + 1);
      onToast(
        result.replayed
          ? "同一交接请求已安全重放，没有重复写入事实。"
          : kind === "submit"
            ? "不可编辑交接快照已提交；现在即可手动签退。"
            : "接班确认已记录，业务时间与真实服务器时间均可追溯。",
      );
    } catch (commandError) {
      setError((commandError as Error).message);
    } finally {
      setBusyTarget("");
    }
  }

  if (loading && !data) {
    return <div className="handover-loading">正在读取交接事项与快照预览…</div>;
  }

  const outgoingSnapshot = data?.outgoing
    ? (data.outgoing.handover?.snapshot ?? data.outgoing.snapshotPreview)
    : null;

  return (
    <div className="handover-workspace">
      <div className="handover-safety-note" role="note">
        <Warning weight="duotone" />
        <div>
          <strong>只交接经营事项，不收集敏感数据</strong>
          <p>不包含现金盘点或真实支付对账；补充说明请勿填写真实个人信息。</p>
        </div>
        <button
          aria-label="刷新交接事项"
          disabled={loading || Boolean(busyTarget)}
          onClick={() => setRefreshNonce((value) => value + 1)}
          type="button"
        >
          <ArrowClockwise /> 刷新
        </button>
      </div>

      {error ? (
        <div className="handover-error" role="alert">
          <Warning />
          <span>{error}</span>
          <button
            onClick={() => setRefreshNonce((value) => value + 1)}
            type="button"
          >
            重试
          </button>
        </div>
      ) : null}

      {data?.outgoing ? (
        <section className="handover-card handover-outgoing-card">
          <header>
            <div>
              <span>交班 · 本人班次</span>
              <h2>冻结未完成业务快照</h2>
              <p>
                班次 {formatDateTime(data.outgoing.window.startsAt)}–
                {formatDateTime(data.outgoing.window.endsAt)}
              </p>
            </div>
            <strong
              className={
                data.outgoing.handover
                  ? "handover-state is-frozen"
                  : "handover-state"
              }
            >
              {data.outgoing.handover ? "已提交 · 不可编辑" : "待提交"}
            </strong>
          </header>
          <SnapshotCounts snapshot={outgoingSnapshot!} />
          <SnapshotDetails snapshot={outgoingSnapshot!} />
          <label className="handover-note-field">
            <span>
              补充说明 <small>{note.length}/500</small>
            </span>
            <textarea
              disabled={Boolean(data.outgoing.handover)}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：A-18 报修待分派；晚高峰到店窗口集中，请优先关注。"
              value={note}
            />
          </label>
          {data.outgoing.handover ? (
            <>
              <div className="handover-frozen-notice">
                <ShieldCheck weight="duotone" />
                <span>
                  <strong>快照与说明已冻结</strong>
                  后续预约、订单、报修或库存变化不会回写；无需等待接班确认即可手动签退。
                </span>
              </div>
              <HandoverEvidence handover={data.outgoing.handover} />
            </>
          ) : (
            <button
              className="handover-primary-action"
              disabled={
                !data.outgoing.canSubmit ||
                busyTarget === `submit:${data.outgoing.shiftId}`
              }
              onClick={() => void runCommand("submit", data.outgoing!.shiftId)}
              type="button"
            >
              <Handshake weight="bold" />
              {busyTarget === `submit:${data.outgoing.shiftId}`
                ? "正在冻结并提交…"
                : data.outgoing.canSubmit
                  ? "提交不可编辑交接"
                  : "模拟签到后可提交"}
            </button>
          )}
        </section>
      ) : (
        <section className="handover-empty-card">
          <CheckCircle weight="duotone" />
          <div>
            <h2>当前没有可提交的本人班次</h2>
            <p>已提交的最近交接和待确认事项仍会保留在服务端事实中。</p>
          </div>
        </section>
      )}

      <section className="handover-card handover-incoming-card">
        <header>
          <div>
            <span>接班 · 同店事项</span>
            <h2>待确认承接</h2>
            <p>只有另一名已签到的同店员工可以确认；交班人无需等待。</p>
          </div>
          <strong className="handover-count">
            {data?.incoming.length ?? 0}
          </strong>
        </header>
        {data?.incoming.length ? (
          <div className="handover-incoming-list">
            {data.incoming.map((handover) => (
              <article key={handover.handoverId}>
                <div>
                  <strong>{handover.submittedBy.displayName} 的交接</strong>
                  <span>
                    {formatDateTime(handover.submittedAt.businessOccurredAt)} ·
                    冻结快照
                  </span>
                </div>
                <SnapshotCounts snapshot={handover.snapshot} />
                {handover.note ? <p>{handover.note}</p> : null}
                <button
                  disabled={busyTarget === `confirm:${handover.handoverId}`}
                  onClick={() =>
                    void runCommand("confirm", handover.handoverId)
                  }
                  type="button"
                >
                  <UserCheck />
                  {busyTarget === `confirm:${handover.handoverId}`
                    ? "正在确认…"
                    : "确认承接"}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="handover-empty-copy">当前没有待本人确认的同店交接。</p>
        )}
      </section>
    </div>
  );
}

const exceptionLabels: Record<
  HandoverExceptionKind,
  { label: string; summary: string }
> = {
  "confirmation-overdue": {
    label: "长期未确认",
    summary: "超过班次结束后 30 分钟仍未形成接班确认",
  },
  "late-submission": {
    label: "迟交",
    summary: "交接提交业务时间晚于计划班次结束",
  },
  "submission-overdue": {
    label: "逾期未提交",
    summary: "班次结束 30 分钟仍未提交交接",
  },
};

export function ManagerHandoverExceptions({
  refreshKey,
}: {
  refreshKey: string;
}) {
  const [data, setData] = useState<ManagerHandoverExceptionsResponse | null>(
    null,
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void fetch("/api/v1/manager/handover-exceptions", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(readJson<ManagerHandoverExceptionsResponse>)
      .then(setData)
      .catch((loadError: Error) => {
        if (loadError.name !== "AbortError") setError(loadError.message);
      });
    return () => controller.abort();
  }, [refreshKey]);

  const selected = data?.exceptions[selectedIndex] ?? null;
  return (
    <main className="manager-handover-page">
      <header>
        <div>
          <span>WEB-M09 · 所属门店只读</span>
          <h1>交接异常与冻结快照</h1>
          <p>经营交接异常独立于考勤；原始提交和确认事实均不可编辑。</p>
        </div>
        <strong>{data?.store.displayName ?? "读取所属门店…"}</strong>
      </header>
      {error ? <div className="handover-error">{error}</div> : null}
      <div className="manager-handover-grid">
        <section className="manager-handover-list">
          <div className="manager-handover-heading">
            <span>异常队列</span>
            <strong>{data?.exceptions.length ?? 0}</strong>
          </div>
          {data?.exceptions.length ? (
            data.exceptions.map((exception, index) => (
              <button
                className={selectedIndex === index ? "is-selected" : ""}
                key={`${exception.shiftId}-${exception.kind}`}
                onClick={() => setSelectedIndex(index)}
                type="button"
              >
                <Warning weight="fill" />
                <span>
                  <strong>{exceptionLabels[exception.kind].label}</strong>
                  <small>
                    {exception.employee.displayName} ·{" "}
                    {formatDateTime(exception.window.endsAt)} 班次结束
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p>当前所属门店没有交接异常。</p>
          )}
        </section>
        <section className="manager-handover-detail">
          {selected ? (
            <>
              <div className="manager-handover-detail-heading">
                <span>{exceptionLabels[selected.kind].label}</span>
                <h2>{selected.employee.displayName} · 交接异常</h2>
                <p>{exceptionLabels[selected.kind].summary}</p>
              </div>
              <dl>
                <div>
                  <dt>班次</dt>
                  <dd>
                    {formatDateTime(selected.window.startsAt)}–
                    {formatDateTime(selected.window.endsAt)}
                  </dd>
                </div>
                <div>
                  <dt>业务发生</dt>
                  <dd>{formatDateTime(selected.businessOccurredAt)}</dd>
                </div>
                <div>
                  <dt>真实服务器记录</dt>
                  <dd>{formatDateTime(selected.recordedAt)}</dd>
                </div>
              </dl>
              {selected.handover ? (
                <>
                  <SnapshotCounts snapshot={selected.handover.snapshot} />
                  <SnapshotDetails snapshot={selected.handover.snapshot} />
                  {selected.handover.note ? (
                    <div className="manager-handover-note">
                      <small>冻结补充说明</small>
                      <p>{selected.handover.note}</p>
                    </div>
                  ) : null}
                  <HandoverEvidence handover={selected.handover} />
                </>
              ) : (
                <div className="handover-frozen-notice is-warning">
                  <Warning weight="duotone" />
                  <span>
                    <strong>逾期时尚未形成快照</strong>
                    若员工随后迟交，将以新的迟交异常保留只读冻结快照。
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="manager-handover-empty">
              <CheckCircle weight="duotone" />
              <h2>选择一项交接异常</h2>
              <p>异常与考勤分别解释，不生成综合评分。</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
