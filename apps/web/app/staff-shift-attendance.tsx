"use client";

import {
  ArrowClockwise,
  CalendarBlank,
  CheckCircle,
  Clock,
  IdentificationBadge,
  ShieldCheck,
  SignIn,
  SignOut,
  Warning,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type {
  ApiErrorResponse,
  StaffAttendanceAction,
  StaffAttendanceCommandResponse,
  StaffShiftAttendanceResponse,
  StaffShiftAttendanceSummary,
} from "@jingshu/contracts";
import { createBrowserUuid } from "./browser-uuid";
import { StaffHandoverPanel } from "./staff-handover";

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

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function businessDateKey(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).format(new Date(value));
}

async function readJson<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = payload as ApiErrorResponse | null;
    throw new Error(
      failure?.error.message ?? "班次数据暂时不可用，请稍后重试。",
    );
  }
  return payload as T;
}

const attendanceLabels = {
  absent: "缺勤",
  "checked-in": "已签到",
  "checked-out": "已签退",
} as const;

function shiftStatus(shift: StaffShiftAttendanceSummary) {
  if (shift.attendance?.status === "absent") {
    return { className: "is-danger", label: "缺勤" };
  }
  if (shift.attendance?.status === "checked-out") {
    return { className: "is-complete", label: "已签退" };
  }
  if (shift.attendance?.checkIn?.outcome === "late") {
    return { className: "is-warning", label: "迟到 · 已签到" };
  }
  if (shift.attendance?.status === "checked-in") {
    return { className: "is-live", label: "已签到" };
  }
  if (shift.nextAction?.kind === "simulated-check-in") {
    return { className: "is-ready", label: "签到窗口已开启" };
  }
  return { className: "is-upcoming", label: "未来班次" };
}

function ShiftWindow({ shift }: { shift: StaffShiftAttendanceSummary }) {
  const endsLabel =
    businessDateKey(shift.window.startsAt) ===
    businessDateKey(shift.window.endsAt)
      ? formatTime(shift.window.endsAt)
      : `次日 ${formatTime(shift.window.endsAt)}`;
  return (
    <div className="attendance-shift-window">
      <strong>
        {formatDateTime(shift.window.startsAt)} — {endsLabel}
      </strong>
      <small>
        签到窗口 {formatTime(shift.signInWindow.opensAt)} 开启 · 可跨午夜
      </small>
    </div>
  );
}

function CurrentShiftCard({
  busy,
  onAction,
  shift,
}: {
  busy: boolean;
  onAction: (action: StaffAttendanceAction, shiftId: string) => void;
  shift: StaffShiftAttendanceSummary;
}) {
  const status = shiftStatus(shift);
  const action = shift.nextAction;
  return (
    <section
      className="attendance-current-card"
      aria-labelledby="current-shift-title"
    >
      <div className="attendance-current-heading">
        <div>
          <span className="attendance-kicker">当前班次</span>
          <h2 id="current-shift-title">本人当值时间</h2>
        </div>
        <span className={`attendance-status ${status.className}`}>
          {status.label}
        </span>
      </div>
      <div className="attendance-clock-panel">
        <Clock weight="duotone" />
        <ShiftWindow shift={shift} />
      </div>
      <dl className="attendance-current-facts">
        <div>
          <dt>签到窗口</dt>
          <dd>
            {formatTime(shift.signInWindow.opensAt)} —{" "}
            {formatTime(shift.signInWindow.closesAt)}
          </dd>
        </div>
        <div>
          <dt>签到结果</dt>
          <dd>
            {shift.attendance?.checkIn
              ? `${shift.attendance.checkIn.outcome === "late" ? "迟到" : "准时"} · ${formatTime(shift.attendance.checkIn.businessOccurredAt)}`
              : shift.attendance?.status === "absent"
                ? "班次结束时未签到"
                : "尚未产生原始事实"}
          </dd>
        </div>
        <div>
          <dt>签退事实</dt>
          <dd>
            {shift.attendance?.checkOut
              ? `员工手动签退 · ${formatTime(shift.attendance.checkOut.businessOccurredAt)}`
              : "不会由系统自动补写"}
          </dd>
        </div>
      </dl>
      <div className="attendance-action-zone">
        <div>
          <strong>
            {action ? `下一合法动作 · ${action.label}` : "当前没有可执行动作"}
          </strong>
          <small>
            {action?.kind === "simulated-check-in"
              ? "提交后记录业务发生时间；班次开始后将标记为迟到。"
              : action?.kind === "manual-check-out"
                ? "签退必须由本人触发，保留业务时间与入库时间。"
                : "原始考勤事实保持只读，重复或非法动作会被服务端拒绝。"}
          </small>
        </div>
        {action ? (
          <button
            aria-busy={busy}
            disabled={busy}
            onClick={() => onAction(action.kind, shift.shiftId)}
            type="button"
          >
            {action.kind === "simulated-check-in" ? <SignIn /> : <SignOut />}
            {busy ? "处理中…" : action.label}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function FactTimeline({ shift }: { shift: StaffShiftAttendanceSummary }) {
  const labels = {
    "attendance.absence-recorded": "班次结束 · 记录缺勤",
    "attendance.manual-check-out": "员工手动签退",
    "attendance.simulated-check-in": "员工模拟签到",
  } as const;
  return (
    <section
      className="attendance-fact-card"
      aria-labelledby="attendance-facts-title"
    >
      <div className="attendance-section-heading">
        <div>
          <span className="attendance-kicker">不可变记录</span>
          <h2 id="attendance-facts-title">原始考勤事实</h2>
        </div>
        <ShieldCheck weight="duotone" />
      </div>
      {shift.facts.length ? (
        <ol>
          {shift.facts.map((fact, index) => (
            <li key={`${fact.type}-${fact.recordedAt}-${index}`}>
              <span className="attendance-fact-dot" aria-hidden="true" />
              <div>
                <strong>{labels[fact.type]}</strong>
                <small>
                  业务发生 {formatDateTime(fact.businessOccurredAt)}
                </small>
                <small>系统记录 {formatDateTime(fact.recordedAt)}</small>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="attendance-empty-facts">尚无签到、签退或缺勤事实。</p>
      )}
    </section>
  );
}

function ShiftList({
  empty,
  shifts,
  title,
}: {
  empty: string;
  shifts: ReadonlyArray<StaffShiftAttendanceSummary>;
  title: string;
}) {
  return (
    <section className="attendance-shift-list">
      <div className="attendance-section-heading">
        <div>
          <span className="attendance-kicker">计划</span>
          <h2>{title}</h2>
        </div>
        <CalendarBlank weight="duotone" />
      </div>
      {shifts.length ? (
        <ul>
          {shifts.map((shift) => {
            const status = shiftStatus(shift);
            return (
              <li key={shift.shiftId}>
                <ShiftWindow shift={shift} />
                <span className={`attendance-status ${status.className}`}>
                  {shift.attendance
                    ? attendanceLabels[shift.attendance.status]
                    : status.label}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="attendance-empty-facts">{empty}</p>
      )}
    </section>
  );
}

export function StaffShiftSummary({
  onOpen,
  refreshKey,
}: {
  onOpen: () => void;
  refreshKey: string;
}) {
  const [data, setData] = useState<StaffShiftAttendanceResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/staff/shifts", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(readJson<StaffShiftAttendanceResponse>)
      .then(setData)
      .catch(() => undefined);
    return () => controller.abort();
  }, [refreshKey]);

  if (!data?.shifts.current) return null;
  const status = shiftStatus(data.shifts.current);
  const summaryEndsLabel =
    businessDateKey(data.shifts.current.window.startsAt) ===
    businessDateKey(data.shifts.current.window.endsAt)
      ? formatTime(data.shifts.current.window.endsAt)
      : `次日 ${formatTime(data.shifts.current.window.endsAt)}`;
  return (
    <button
      className="attendance-workbench-summary"
      onClick={onOpen}
      type="button"
    >
      <span>
        <IdentificationBadge weight="duotone" />
      </span>
      <span>
        <small>本人班次</small>
        <strong>
          {formatTime(data.shifts.current.window.startsAt)} — {summaryEndsLabel}
        </strong>
      </span>
      <span className={`attendance-status ${status.className}`}>
        {status.label}
      </span>
      <span>查看班次</span>
    </button>
  );
}

export function StaffShiftAttendance({
  csrfToken,
  onToast,
  refreshKey,
}: {
  csrfToken: string;
  onToast: (message: string) => void;
  refreshKey: string;
}) {
  const [data, setData] = useState<StaffShiftAttendanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [view, setView] = useState<"attendance" | "handover">("attendance");
  const retryRef = useRef<{
    action: StaffAttendanceAction;
    idempotencyKey: string;
    shiftId: string;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch("/api/v1/staff/shifts", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(readJson<StaffShiftAttendanceResponse>)
      .then(setData)
      .catch((loadError: Error) => {
        if (loadError.name !== "AbortError") setError(loadError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey, refreshNonce]);

  async function submit(action: StaffAttendanceAction, shiftId: string) {
    if (
      !retryRef.current ||
      retryRef.current.action !== action ||
      retryRef.current.shiftId !== shiftId
    ) {
      retryRef.current = {
        action,
        idempotencyKey: createBrowserUuid(),
        shiftId,
      };
    }
    const retry = retryRef.current;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(
        `/api/v1/staff/shifts/${shiftId}/attendance`,
        {
          body: JSON.stringify({ action }),
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
      const result = await readJson<StaffAttendanceCommandResponse>(response);
      retryRef.current = null;
      setRefreshNonce((value) => value + 1);
      onToast(
        result.replayed
          ? "同一考勤请求已安全重放，原始事实没有重复写入。"
          : result.action === "simulated-check-in"
            ? `模拟签到已记录 · ${result.outcome === "late" ? "迟到" : "准时"}`
            : "手动签退已记录，系统未自动补写时间。",
      );
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="attendance-page">
      <header className="attendance-page-header">
        <div>
          <span className="attendance-kicker">WEB-S09 / WEB-S10 · 仅本人</span>
          <h1>班次与交接</h1>
          <p>查看本人考勤原始事实，提交不可编辑交接，并确认同店承接。</p>
        </div>
        <button
          aria-label="刷新班次与考勤"
          disabled={loading || submitting}
          onClick={() => setRefreshNonce((value) => value + 1)}
          type="button"
        >
          <ArrowClockwise /> {loading ? "读取中" : "刷新"}
        </button>
      </header>

      <nav className="attendance-tabs" aria-label="班次与交接页面">
        <button
          aria-current={view === "attendance" ? "page" : undefined}
          className={view === "attendance" ? "is-active" : ""}
          onClick={() => setView("attendance")}
          type="button"
        >
          本人班次
        </button>
        <button
          aria-current={view === "handover" ? "page" : undefined}
          className={view === "handover" ? "is-active" : ""}
          onClick={() => setView("handover")}
          type="button"
        >
          交接班
        </button>
      </nav>

      {view === "handover" ? (
        <StaffHandoverPanel
          csrfToken={csrfToken}
          onToast={onToast}
          refreshKey={`${refreshKey}-${refreshNonce}`}
        />
      ) : (
        <>
          <div className="attendance-simulation-notice" role="note">
            <Warning weight="duotone" />
            <div>
              <strong>模拟考勤，不连接真实设备</strong>
              <p>
                不读取定位、人脸或门禁，不接入真实考勤连接器；仅在当前演示沙箱记录事实。
              </p>
            </div>
          </div>

          {error ? (
            <div className="attendance-error" role="alert">
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

          {loading && !data ? (
            <div className="attendance-loading" role="status">
              正在读取本人班次与原始考勤事实…
            </div>
          ) : data ? (
            <>
              <div className="attendance-identity-strip">
                <span>
                  <IdentificationBadge weight="duotone" />
                </span>
                <div>
                  <small>当前员工</small>
                  <strong>
                    {data.employee.displayName} · {data.employee.employeeCode}
                  </strong>
                </div>
                <div>
                  <small>固定所属门店</small>
                  <strong>{data.store.displayName}</strong>
                </div>
                <div>
                  <small>当前业务时间</small>
                  <strong>{formatDateTime(data.currentTime)}</strong>
                </div>
              </div>

              {data.shifts.current ? (
                <div className="attendance-primary-grid">
                  <CurrentShiftCard
                    busy={submitting}
                    onAction={(action, shiftId) => void submit(action, shiftId)}
                    shift={data.shifts.current}
                  />
                  <FactTimeline shift={data.shifts.current} />
                </div>
              ) : (
                <section className="attendance-no-current">
                  <CheckCircle weight="duotone" />
                  <div>
                    <h2>当前没有进行中或已开放签到的班次</h2>
                    <p>
                      未来计划仍在下方展示；到签到窗口后刷新即可执行下一合法动作。
                    </p>
                  </div>
                </section>
              )}

              <div className="attendance-secondary-grid">
                <ShiftList
                  empty="当前没有后续计划班次。"
                  shifts={data.shifts.future}
                  title="未来班次"
                />
                <ShiftList
                  empty="当前没有最近班次记录。"
                  shifts={data.shifts.recent}
                  title="最近班次"
                />
              </div>
            </>
          ) : null}
        </>
      )}
    </main>
  );
}
