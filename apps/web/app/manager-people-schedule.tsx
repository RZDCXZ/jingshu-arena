"use client";

import {
  CalendarDots,
  CheckCircle,
  ClockCounterClockwise,
  Eye,
  PencilSimple,
  Plus,
  ShieldCheck,
  UserMinus,
  UsersThree,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type {
  HeadquartersPeopleScheduleResponse,
  ManagerPeopleCommandRequest,
  ManagerPeopleScheduleResponse,
  ManagerShiftCoveragePreviewResponse,
} from "@jingshu/contracts";

import { createBrowserUuid } from "./browser-uuid";
import { canonicalHeadquartersStores } from "./headquarters-stores";
import { ManagerHandoverExceptions } from "./staff-handover";

type Employee = ManagerPeopleScheduleResponse["employees"][number];
type Shift = ManagerPeopleScheduleResponse["shifts"][number];
type Attendance = ManagerPeopleScheduleResponse["attendance"][number];
type Tab = "attendance" | "employees" | "schedule";

const shanghaiInputFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Shanghai",
  year: "numeric",
});

function failureMessage(payload: unknown, fallback: string) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }
  return fallback;
}

function shanghai(value: string, includeDate = true) {
  return new Intl.DateTimeFormat("zh-CN", {
    ...(includeDate ? { day: "2-digit", month: "2-digit" } : {}),
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function shanghaiDateTimeLocal(value: string) {
  const parts = shanghaiInputFormatter
    .formatToParts(new Date(value))
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function shanghaiInputToIso(value: string) {
  return new Date(`${value}:00+08:00`).toISOString();
}

function shanghaiDayStart(value: string) {
  const date = shanghaiDateTimeLocal(value).slice(0, 10);
  return new Date(`${date}T00:00:00+08:00`);
}

function timelineSegmentStyle(shift: Shift, dayStart: Date, dayEnd: Date) {
  const range = dayEnd.getTime() - dayStart.getTime();
  const segmentStartsAt = Math.max(
    new Date(shift.startsAt).getTime(),
    dayStart.getTime(),
  );
  const segmentEndsAt = Math.min(
    new Date(shift.endsAt).getTime(),
    dayEnd.getTime(),
  );
  return {
    left: `${((segmentStartsAt - dayStart.getTime()) / range) * 100}%`,
    width: `${((segmentEndsAt - segmentStartsAt) / range) * 100}%`,
  };
}

function defaultShiftWindow(currentTime: string) {
  const now = new Date(currentTime);
  const start = new Date(
    Math.ceil(now.getTime() / (30 * 60_000)) * 30 * 60_000 +
      4 * 24 * 60 * 60_000,
  );
  return {
    endsAt: shanghaiDateTimeLocal(
      new Date(start.getTime() + 8 * 60 * 60_000).toISOString(),
    ),
    startsAt: shanghaiDateTimeLocal(start.toISOString()),
  };
}

function Dialog({
  busy = false,
  children,
  eyebrow,
  onClose,
  title,
}: {
  busy?: boolean;
  children: ReactNode;
  eyebrow: string;
  onClose: () => void;
  title: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    (
      ref.current?.querySelector<HTMLElement>("input, select, textarea") ??
      ref.current?.querySelector<HTMLElement>("button")
    )?.focus();
  }, []);
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      ref.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
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
  return (
    <div className="people-dialog-backdrop">
      <div
        aria-labelledby="people-dialog-title"
        aria-modal="true"
        className="people-dialog"
        onKeyDown={keyDown}
        ref={ref}
        role="dialog"
      >
        <header>
          <div>
            <small>{eyebrow}</small>
            <h2 id="people-dialog-title">{title}</h2>
          </div>
          <button aria-label="关闭弹窗" disabled={busy} onClick={onClose}>
            <X />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function EmployeeDialog({
  csrfToken,
  employee,
  mode,
  onClose,
  onCompleted,
  storeId,
}: {
  csrfToken: string;
  employee: Employee | null;
  mode: "create" | "deactivate" | "edit";
  onClose: () => void;
  onCompleted: (message: string) => void;
  storeId: string;
}) {
  const [displayName, setDisplayName] = useState(employee?.displayName ?? "");
  const [employeeCode, setEmployeeCode] = useState(
    employee?.employeeCode ?? "",
  );
  const [employeeRole, setEmployeeRole] = useState<"manager" | "staff">(
    employee?.role ?? "staff",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef(createBrowserUuid());
  const dependencies = employee?.dependencies;
  const hasDependencies = Boolean(
    dependencies &&
    (dependencies.currentOrFutureShifts > 0 ||
      dependencies.openRepairAssignments > 0),
  );
  const valid =
    displayName.trim().length > 0 && employeeCode.trim().length >= 3 && !busy;

  async function submit() {
    if (mode !== "create" && !employee) return;
    const body: ManagerPeopleCommandRequest =
      mode === "create"
        ? {
            action: "create-employee",
            displayName: displayName.trim(),
            employeeCode: employeeCode.trim().toUpperCase(),
            employeeRole,
            storeId,
          }
        : mode === "edit"
          ? {
              action: "update-employee",
              displayName: displayName.trim(),
              employeeCode: employeeCode.trim().toUpperCase(),
              employeeId: employee!.employeeId,
              expectedVersion: employee!.version,
              storeId,
            }
          : {
              action: "deactivate-employee",
              employeeId: employee!.employeeId,
              expectedVersion: employee!.version,
              storeId,
            };
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/manager/people-schedule/commands", {
        body: JSON.stringify(body),
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
          "X-CSRF-Token": csrfToken,
        },
        method: "POST",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setError(failureMessage(payload, "员工操作未能提交，数据保持不变。"));
        return;
      }
      onCompleted(
        mode === "create"
          ? "背景员工已创建"
          : mode === "edit"
            ? "员工资料已更新"
            : "员工已停用",
      );
    } catch {
      setError("员工操作未能提交，数据保持不变。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      busy={busy}
      eyebrow="WEB-M07 · 所属门店固定"
      onClose={onClose}
      title={
        mode === "create"
          ? "创建背景员工"
          : mode === "edit"
            ? "编辑员工资料"
            : "停用背景员工"
      }
    >
      <div className="people-dialog-body">
        {mode === "deactivate" ? (
          <>
            <div className="people-dialog-callout is-warning">
              <UserMinus />
              <span>
                <strong>{employee?.displayName}</strong>
                停用后保留历史班次与考勤，不删除既有事实。
              </span>
            </div>
            <dl className="people-dependency-list">
              <div>
                <dt>当前 / 未来班次</dt>
                <dd>{dependencies?.currentOrFutureShifts ?? 0}</dd>
              </div>
              <div>
                <dt>未完成报修分派</dt>
                <dd>{dependencies?.openRepairAssignments ?? 0}</dd>
              </div>
            </dl>
            {hasDependencies ? (
              <p className="people-inline-error" role="alert">
                存在依赖，必须先处理以上班次或报修分派。
              </p>
            ) : null}
          </>
        ) : (
          <div className="people-dialog-fields">
            <label>
              <span>员工工作名</span>
              <input
                maxLength={40}
                onChange={(event) => setDisplayName(event.target.value)}
                value={displayName}
              />
              <small>仅使用虚构工作名，请勿填写真实个人信息。</small>
            </label>
            <label>
              <span>员工编号</span>
              <input
                maxLength={32}
                onChange={(event) => setEmployeeCode(event.target.value)}
                value={employeeCode}
              />
            </label>
            <label>
              <span>业务角色</span>
              <select
                disabled={mode === "edit"}
                onChange={(event) =>
                  setEmployeeRole(event.target.value as "manager" | "staff")
                }
                value={employeeRole}
              >
                <option value="staff">店员</option>
                <option value="manager">店长</option>
              </select>
              {mode === "edit" ? <small>既有员工角色保持不变。</small> : null}
            </label>
            <label>
              <span>所属门店</span>
              <input readOnly value="当前店长所属门店（固定）" />
            </label>
          </div>
        )}
        {error ? (
          <p className="people-inline-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <footer>
        <button disabled={busy} onClick={onClose}>
          返回
        </button>
        <button
          className={mode === "deactivate" ? "is-danger" : "is-primary"}
          disabled={mode === "deactivate" ? hasDependencies || busy : !valid}
          onClick={() => void submit()}
        >
          {busy
            ? "事务提交中…"
            : mode === "deactivate"
              ? "确认停用"
              : "保存员工"}
        </button>
      </footer>
    </Dialog>
  );
}

function ShiftDialog({
  csrfToken,
  data,
  employeeId,
  onClose,
  onCompleted,
  shift,
}: {
  csrfToken: string;
  data: ManagerPeopleScheduleResponse;
  employeeId?: string;
  onClose: () => void;
  onCompleted: (message: string) => void;
  shift: Shift | null;
}) {
  const initial = defaultShiftWindow(data.currentTime);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(
    shift?.employee.employeeId ??
      employeeId ??
      data.employees.find((employee) => employee.active)?.employeeId ??
      "",
  );
  const [startsAt, setStartsAt] = useState(
    shift ? shanghaiDateTimeLocal(shift.startsAt) : initial.startsAt,
  );
  const [endsAt, setEndsAt] = useState(
    shift ? shanghaiDateTimeLocal(shift.endsAt) : initial.endsAt,
  );
  const [preview, setPreview] =
    useState<ManagerShiftCoveragePreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef(createBrowserUuid());

  const runPreview = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(
        "/api/v1/manager/people-schedule/shift-preview",
        {
          body: JSON.stringify({
            employeeId: selectedEmployeeId,
            endsAt: shanghaiInputToIso(endsAt),
            ...(shift ? { shiftId: shift.shiftId } : {}),
            startsAt: shanghaiInputToIso(startsAt),
            storeId: data.store.storeId,
          }),
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          method: "POST",
        },
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        setError(failureMessage(payload, "排班预览失败，尚未保存。"));
        setPreview(null);
        return;
      }
      setPreview(payload as ManagerShiftCoveragePreviewResponse);
    } catch {
      setError("排班预览失败，尚未保存。");
      setPreview(null);
    }
  }, [
    csrfToken,
    data.store.storeId,
    endsAt,
    selectedEmployeeId,
    shift,
    startsAt,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => void runPreview(), 250);
    return () => window.clearTimeout(timer);
  }, [runPreview]);

  async function submit() {
    if (preview?.validation.status !== "valid") return;
    const body: ManagerPeopleCommandRequest = shift
      ? {
          action: "update-shift",
          endsAt: shanghaiInputToIso(endsAt),
          shiftId: shift.shiftId,
          startsAt: shanghaiInputToIso(startsAt),
          storeId: data.store.storeId,
        }
      : {
          action: "create-shift",
          employeeId: selectedEmployeeId,
          endsAt: shanghaiInputToIso(endsAt),
          startsAt: shanghaiInputToIso(startsAt),
          storeId: data.store.storeId,
        };
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/manager/people-schedule/commands", {
        body: JSON.stringify(body),
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
          "X-CSRF-Token": csrfToken,
        },
        method: "POST",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setError(failureMessage(payload, "排班未能保存，原排班保持不变。"));
        return;
      }
      onCompleted(
        preview.warnings.length
          ? `排班已保存 · 同时保留 ${preview.warnings.length} 项覆盖告警`
          : "排班已保存",
      );
    } catch {
      setError("排班未能保存，原排班保持不变。");
    } finally {
      setBusy(false);
    }
  }

  const validationLabel =
    preview?.validation.status === "invalid"
      ? preview.validation.reason === "duration"
        ? "班次时长须为 4–12 小时"
        : preview.validation.reason === "half-hour-alignment"
          ? "开始与结束须对齐半小时"
          : "该员工已有重叠班次"
      : null;
  return (
    <Dialog
      busy={busy}
      eyebrow="WEB-M08 · 半小时排班网格"
      onClose={onClose}
      title={shift ? "编辑未来班次" : "创建未来班次"}
    >
      <div className="people-dialog-body">
        <div className="people-dialog-fields">
          <label className="is-wide">
            <span>员工</span>
            <select
              disabled={Boolean(shift)}
              onChange={(event) => setSelectedEmployeeId(event.target.value)}
              value={selectedEmployeeId}
            >
              {data.employees
                .filter((employee) => employee.active)
                .map((employee) => (
                  <option key={employee.employeeId} value={employee.employeeId}>
                    {employee.displayName} · {employee.employeeCode} ·{" "}
                    {employee.role === "manager" ? "店长" : "店员"}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>开始（半小时刻度）</span>
            <input
              onChange={(event) => setStartsAt(event.target.value)}
              step="1800"
              type="datetime-local"
              value={startsAt}
            />
          </label>
          <label>
            <span>结束（可跨午夜）</span>
            <input
              onChange={(event) => setEndsAt(event.target.value)}
              step="1800"
              type="datetime-local"
              value={endsAt}
            />
          </label>
        </div>
        {validationLabel ? (
          <p className="people-inline-error" role="alert">
            {validationLabel}
          </p>
        ) : null}
        {preview?.validation.status === "valid" ? (
          preview.warnings.length ? (
            <div className="people-coverage-preview is-warning" role="status">
              <Warning weight="fill" />
              <span>
                <strong>覆盖不足，但允许保存</strong>
                {preview.warnings
                  .map(
                    (warning) =>
                      `${shanghai(warning.startsAt)}–${shanghai(warning.endsAt, false)} 实际 ${warning.actualStaff}/${warning.minimumStaff} 人`,
                  )
                  .join("；")}
              </span>
            </div>
          ) : (
            <div className="people-coverage-preview" role="status">
              <CheckCircle weight="fill" />
              <span>
                <strong>覆盖检查通过</strong>班次格式与人员覆盖均可保存。
              </span>
            </div>
          )
        ) : null}
        {error ? (
          <p className="people-inline-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <footer>
        <button disabled={busy} onClick={onClose}>
          返回
        </button>
        <button
          className="is-primary"
          disabled={busy || preview?.validation.status !== "valid"}
          onClick={() => void submit()}
        >
          {busy
            ? "事务提交中…"
            : preview?.warnings.length
              ? "保留告警并保存"
              : "保存班次"}
        </button>
      </footer>
    </Dialog>
  );
}

function HandoverSnapshotDialog({
  onClose,
  refreshKey,
}: {
  onClose: () => void;
  refreshKey: string;
}) {
  return (
    <Dialog
      eyebrow="WEB-M09 · 交接快照只读"
      onClose={onClose}
      title="交接异常与冻结快照"
    >
      <div className="people-handover-dialog-body">
        <ManagerHandoverExceptions refreshKey={refreshKey} />
      </div>
      <footer>
        <button className="is-primary" onClick={onClose}>
          完成查看
        </button>
      </footer>
    </Dialog>
  );
}

function AbsenceDetailDialog({
  attendance,
  onClose,
}: {
  attendance: Attendance;
  onClose: () => void;
}) {
  return (
    <Dialog eyebrow="WEB-M09 · 原始缺勤事实" onClose={onClose} title="缺勤详情">
      <div className="people-dialog-body">
        <div className="people-dialog-callout is-warning">
          <Warning />
          <span>
            <strong>{attendance.employee.displayName}</strong>
            系统在签到窗口关闭后追加缺勤事实，详情只读。
          </span>
        </div>
        <dl className="people-evidence-list">
          <div>
            <dt>计划班次</dt>
            <dd>
              {shanghai(attendance.window.startsAt)}–
              {shanghai(attendance.window.endsAt)}
            </dd>
          </div>
          <div>
            <dt>原始状态</dt>
            <dd>缺勤</dd>
          </div>
          <div>
            <dt>业务发生时间</dt>
            <dd>
              {attendance.original.absenceBusinessAt
                ? shanghai(attendance.original.absenceBusinessAt)
                : "—"}
            </dd>
          </div>
          <div>
            <dt>追加更正</dt>
            <dd>{attendance.corrections.length} 条</dd>
          </div>
        </dl>
      </div>
      <footer>
        <button className="is-primary" onClick={onClose}>
          完成查看
        </button>
      </footer>
    </Dialog>
  );
}

function CancelShiftDialog({
  csrfToken,
  onClose,
  onCompleted,
  shift,
  storeId,
}: {
  csrfToken: string;
  onClose: () => void;
  onCompleted: (message: string) => void;
  shift: Shift;
  storeId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef(createBrowserUuid());

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const body: ManagerPeopleCommandRequest = {
        action: "cancel-shift",
        shiftId: shift.shiftId,
        storeId,
      };
      const response = await fetch("/api/v1/manager/people-schedule/commands", {
        body: JSON.stringify(body),
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
          "X-CSRF-Token": csrfToken,
        },
        method: "POST",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setError(failureMessage(payload, "班次未能取消，原排班保持不变。"));
        return;
      }
      onCompleted("未来班次已取消");
    } catch {
      setError("班次未能取消，原排班保持不变。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      busy={busy}
      eyebrow="WEB-M08 · 仅未来未签到"
      onClose={onClose}
      title="取消未来班次"
    >
      <div className="people-dialog-body">
        <div className="people-dialog-callout is-warning">
          <CalendarDots />
          <span>
            <strong>{shift.employee.displayName}</strong>
            {shanghai(shift.startsAt)}–{shanghai(shift.endsAt)}
            ；取消后保留排班历史。
          </span>
        </div>
        {error ? (
          <p className="people-inline-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <footer>
        <button disabled={busy} onClick={onClose}>
          返回
        </button>
        <button
          className="is-danger"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? "事务提交中…" : "确认取消"}
        </button>
      </footer>
    </Dialog>
  );
}

function AttendanceCorrectionDialog({
  attendance,
  csrfToken,
  onClose,
  onCompleted,
  storeId,
}: {
  attendance: Attendance;
  csrfToken: string;
  onClose: () => void;
  onCompleted: (message: string) => void;
  storeId: string;
}) {
  const availableKinds = [
    ...(attendance.original.checkInBusinessAt ? ["late" as const] : []),
    ...(attendance.original.status === "absent" ? ["absence" as const] : []),
    ...(attendance.original.checkOutBusinessAt ? ["check-out" as const] : []),
  ];
  const [kind, setKind] = useState<"absence" | "check-out" | "late">(
    availableKinds[0] ?? "late",
  );
  const [correctedAt, setCorrectedAt] = useState(
    shanghaiDateTimeLocal(
      attendance.original.checkInBusinessAt ?? attendance.window.startsAt,
    ),
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef(createBrowserUuid());

  async function submit() {
    if (!reason.trim()) return;
    const body: ManagerPeopleCommandRequest = {
      action: "correct-attendance",
      attendanceRecordId: attendance.attendanceRecordId,
      correctedBusinessAt: shanghaiInputToIso(correctedAt),
      correctionKind: kind,
      reason: reason.trim(),
      storeId,
    };
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/manager/people-schedule/commands", {
        body: JSON.stringify(body),
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
          "X-CSRF-Token": csrfToken,
        },
        method: "POST",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setError(failureMessage(payload, "操作未能提交，原始事实保持不变。"));
        return;
      }
      onCompleted("考勤更正已追加，原始事实未覆盖");
    } catch {
      setError("操作未能提交，原始事实保持不变。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      busy={busy}
      eyebrow="WEB-M09 · 追加证据"
      onClose={onClose}
      title="创建考勤更正"
    >
      <div className="people-dialog-body">
        <div className="people-dialog-callout">
          <ClockCounterClockwise />
          <span>
            <strong>原始记录不会被覆盖</strong>
            更正将作为独立事实追加，并记录业务时间、服务器时间和店长人物。
          </span>
        </div>
        <div className="people-dialog-fields">
          <label>
            <span>更正类型</span>
            <select
              onChange={(event) => setKind(event.target.value as typeof kind)}
              value={kind}
            >
              {availableKinds.map((value) => (
                <option key={value} value={value}>
                  {value === "late"
                    ? "迟到时间"
                    : value === "absence"
                      ? "缺勤事实"
                      : "签退时间"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>更正业务时间</span>
            <input
              onChange={(event) => setCorrectedAt(event.target.value)}
              step="1800"
              type="datetime-local"
              value={correctedAt}
            />
          </label>
          <label className="is-wide">
            <span>更正原因（必填，最多 200 字）</span>
            <textarea
              maxLength={200}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              value={reason}
            />
            <small>请勿填写真实个人信息 · {reason.length}/200</small>
          </label>
        </div>
        {error ? (
          <p className="people-inline-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <footer>
        <button disabled={busy} onClick={onClose}>
          返回
        </button>
        <button
          className="is-primary"
          disabled={busy || !reason.trim()}
          onClick={() => void submit()}
        >
          {busy ? "事务提交中…" : "追加更正"}
        </button>
      </footer>
    </Dialog>
  );
}

export function ManagerPeopleSchedule({
  csrfToken,
  onToast,
  refreshKey,
}: {
  csrfToken: string;
  onToast: (message: string) => void;
  refreshKey: string;
}) {
  const [data, setData] = useState<ManagerPeopleScheduleResponse | null>(null);
  const [tab, setTab] = useState<Tab>("employees");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<
    | {
        employee: Employee | null;
        kind: "employee";
        mode: "create" | "deactivate" | "edit";
      }
    | { employeeId?: string; kind: "shift"; shift: Shift | null }
    | { attendance: Attendance; kind: "absence" }
    | { kind: "cancel-shift"; shift: Shift }
    | { attendance: Attendance; kind: "correction" }
    | { kind: "handover" }
    | null
  >(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/manager/people-schedule", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setError(failureMessage(payload, "人员与排班读取失败。"));
        return;
      }
      setData(payload as ManagerPeopleScheduleResponse);
    } catch {
      setError("人员与排班读取失败，页面不会伪造数据。");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  function open(next: NonNullable<typeof dialog>, trigger: HTMLButtonElement) {
    openerRef.current = trigger;
    setDialog(next);
  }
  function close() {
    setDialog(null);
    window.requestAnimationFrame(() => openerRef.current?.focus());
  }
  function completed(message: string) {
    close();
    onToast(message);
    void load();
  }

  const scheduleEmployees = useMemo(
    () => data?.employees.filter((employee) => employee.active) ?? [],
    [data],
  );
  return (
    <main className="people-main">
      <header className="people-title-row">
        <div>
          <span>
            {data?.store.displayName ?? "所属门店"} · WEB-M07 / M08 / M09
          </span>
          <h1>员工、排班与考勤</h1>
          <p>门店固定范围 · 半小时排班 · 原始事实与追加更正并列保留</p>
        </div>
        <div className="people-title-status">
          <ShieldCheck />
          <span>
            <small>服务端授权范围</small>
            <strong>{data?.store.displayName ?? "读取中…"}</strong>
          </span>
        </div>
      </header>
      <nav aria-label="员工与排班工作区" className="people-tabs">
        {(["employees", "schedule", "attendance"] as const).map((value) => (
          <button
            aria-current={tab === value ? "page" : undefined}
            className={tab === value ? "is-active" : ""}
            key={value}
            onClick={() => setTab(value)}
            type="button"
          >
            {value === "employees" ? (
              <UsersThree />
            ) : value === "schedule" ? (
              <CalendarDots />
            ) : (
              <ClockCounterClockwise />
            )}
            {value === "employees"
              ? "员工"
              : value === "schedule"
                ? "未来排班"
                : "考勤与交接"}
            <strong>
              {value === "employees"
                ? (data?.employees.length ?? 0)
                : value === "schedule"
                  ? (data?.shifts.filter(
                      (shift) =>
                        shift.status === "scheduled" &&
                        new Date(shift.startsAt) > new Date(data.currentTime),
                    ).length ?? 0)
                  : (data?.attendance.length ?? 0)}
            </strong>
          </button>
        ))}
      </nav>
      {error ? (
        <div className="people-page-error" role="alert">
          {error}
          <button onClick={() => void load()}>重试</button>
        </div>
      ) : null}
      {loading && !data ? (
        <div className="people-loading">正在读取人员、排班与考勤事实…</div>
      ) : null}
      {data && tab === "employees" ? (
        <section className="people-panel">
          <div className="people-panel-heading">
            <div>
              <small>WEB-M07</small>
              <h2>所属门店员工</h2>
              <p>公开角色人物带保护标记；背景员工保留依赖检查。</p>
            </div>
            <button
              className="is-primary"
              onClick={(event) =>
                open(
                  { employee: null, kind: "employee", mode: "create" },
                  event.currentTarget,
                )
              }
            >
              <Plus />
              创建背景员工
            </button>
          </div>
          <div className="people-table-scroll">
            <table className="people-table">
              <thead>
                <tr>
                  <th>工作名 / 编号</th>
                  <th>角色</th>
                  <th>任职状态</th>
                  <th>所属门店</th>
                  <th>依赖</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.employees.map((employee) => (
                  <tr
                    className={!employee.active ? "is-muted" : ""}
                    key={employee.employeeId}
                  >
                    <td>
                      <span className="people-employee-cell">
                        <strong>
                          {employee.displayName}
                          {employee.protected ? (
                            <ShieldCheck
                              aria-label="受保护演示人物"
                              weight="fill"
                            />
                          ) : null}
                        </strong>
                        <small>{employee.employeeCode}</small>
                      </span>
                    </td>
                    <td>
                      <span className="people-role-badge">
                        {employee.role === "manager" ? "店长" : "店员"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={
                          employee.active
                            ? "people-state is-active"
                            : "people-state"
                        }
                      >
                        {employee.active ? "任职" : "已停用"}
                      </span>
                    </td>
                    <td>
                      <span className="people-fixed-store">
                        <strong>{employee.store.displayName}</strong>
                        <small>固定 · 不可跨店</small>
                      </span>
                    </td>
                    <td>
                      <span className="people-dependencies">
                        未来班次 {employee.dependencies.futureShifts}
                        <small>
                          报修 {employee.dependencies.openRepairAssignments}
                        </small>
                      </span>
                    </td>
                    <td>
                      <div className="people-row-actions">
                        <button
                          aria-label={`编辑 ${employee.displayName}`}
                          disabled={employee.protected || !employee.active}
                          onClick={(event) =>
                            open(
                              { employee, kind: "employee", mode: "edit" },
                              event.currentTarget,
                            )
                          }
                          title={
                            employee.protected
                              ? "公开演示人物受保护"
                              : "编辑员工"
                          }
                        >
                          <PencilSimple />
                        </button>
                        <button
                          aria-label={`停用 ${employee.displayName}`}
                          disabled={employee.protected || !employee.active}
                          onClick={(event) =>
                            open(
                              {
                                employee,
                                kind: "employee",
                                mode: "deactivate",
                              },
                              event.currentTarget,
                            )
                          }
                          title={
                            employee.protected
                              ? "公开演示人物受保护"
                              : "停用员工"
                          }
                        >
                          <UserMinus />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {data && tab === "schedule" ? (
        <section className="people-panel people-schedule-panel">
          <div className="people-panel-heading">
            <div>
              <small>WEB-M08 · 30 分钟刻度</small>
              <h2>未来排班时间轴</h2>
              <p>4–12 小时，支持跨午夜；覆盖告警与格式错误分开呈现。</p>
            </div>
            <button
              className="is-primary"
              onClick={(event) =>
                open({ kind: "shift", shift: null }, event.currentTarget)
              }
            >
              <Plus />
              创建班次
            </button>
          </div>
          {data.coverageWarnings.length ? (
            <div className="people-coverage-banner">
              <Warning weight="fill" />
              <span>
                <strong>{data.coverageWarnings.length} 段人员覆盖不足</strong>
                当前提示不阻断保存；创建或编辑班次时将再次预览。
              </span>
            </div>
          ) : null}
          <div className="people-timeline-scroll">
            <div className="people-timeline">
              <div className="people-timeline-head">
                <strong>员工</strong>
                {Array.from({ length: 8 }, (_, day) => {
                  const value = new Date(
                    shanghaiDayStart(data.currentTime).getTime() +
                      day * 24 * 60 * 60_000,
                  );
                  return (
                    <span key={value.toISOString()}>
                      {new Intl.DateTimeFormat("zh-CN", {
                        day: "2-digit",
                        month: "2-digit",
                        timeZone: "Asia/Shanghai",
                      }).format(value)}
                      <small>00:00 · · 12:00 · · 24:00</small>
                    </span>
                  );
                })}
              </div>
              {scheduleEmployees.map((employee) => (
                <div className="people-timeline-row" key={employee.employeeId}>
                  <div>
                    <strong>{employee.displayName}</strong>
                    <small>{employee.employeeCode}</small>
                    <button
                      aria-label={`为 ${employee.displayName} 创建班次`}
                      onClick={(event) =>
                        open(
                          {
                            employeeId: employee.employeeId,
                            kind: "shift",
                            shift: null,
                          },
                          event.currentTarget,
                        )
                      }
                    >
                      <Plus />
                    </button>
                  </div>
                  {Array.from({ length: 8 }, (_, day) => {
                    const start = new Date(
                      shanghaiDayStart(data.currentTime).getTime() +
                        day * 24 * 60 * 60_000,
                    );
                    const end = new Date(start.getTime() + 24 * 60 * 60_000);
                    const shifts = data.shifts.filter(
                      (shift) =>
                        shift.employee.employeeId === employee.employeeId &&
                        shift.status === "scheduled" &&
                        new Date(shift.endsAt) > new Date(data.currentTime) &&
                        new Date(shift.startsAt) < end &&
                        new Date(shift.endsAt) > start,
                    );
                    return (
                      <div
                        className="people-timeline-day"
                        key={`${employee.employeeId}-${day}`}
                      >
                        {shifts.map((shift) => (
                          <button
                            className={
                              shift.canManage
                                ? "people-shift-chip"
                                : "people-shift-chip is-locked"
                            }
                            key={shift.shiftId}
                            onClick={(event) =>
                              shift.canManage &&
                              open(
                                { kind: "shift", shift },
                                event.currentTarget,
                              )
                            }
                            title={
                              shift.canManage
                                ? "编辑未来班次"
                                : "已有考勤或非未来班次，不可修改"
                            }
                            style={timelineSegmentStyle(shift, start, end)}
                          >
                            <strong>
                              {shanghai(shift.startsAt, false)}–
                              {shanghai(shift.endsAt, false)}
                            </strong>
                            <small>
                              {shanghaiDateTimeLocal(shift.endsAt).slice(
                                0,
                                10,
                              ) !==
                              shanghaiDateTimeLocal(shift.startsAt).slice(0, 10)
                                ? "跨午夜 · 次日"
                                : shift.canManage
                                  ? "可编辑"
                                  : "已锁定"}
                            </small>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="people-schedule-list">
            <h3>可管理的未来班次</h3>
            {data.shifts
              .filter((shift) => shift.canManage)
              .slice(0, 12)
              .map((shift) => (
                <article key={shift.shiftId}>
                  <span>
                    <strong>{shift.employee.displayName}</strong>
                    <small>
                      {shanghai(shift.startsAt)}–{shanghai(shift.endsAt)}
                    </small>
                  </span>
                  <div>
                    <button
                      onClick={(event) =>
                        open({ kind: "shift", shift }, event.currentTarget)
                      }
                    >
                      <PencilSimple />
                      编辑
                    </button>
                    <button
                      onClick={(event) =>
                        open(
                          {
                            kind: "cancel-shift",
                            shift,
                          },
                          event.currentTarget,
                        )
                      }
                    >
                      <X />
                      取消
                    </button>
                  </div>
                </article>
              ))}
          </div>
        </section>
      ) : null}
      {data && tab === "attendance" ? (
        <section className="people-panel">
          <div className="people-panel-heading">
            <div>
              <small>WEB-M09 · 追加证据</small>
              <h2>考勤事实与更正</h2>
              <p>左侧始终是原始签到、缺勤或签退；右侧按时间追加更正。</p>
            </div>
            <button
              onClick={(event) =>
                open(
                  {
                    kind: "handover",
                  },
                  event.currentTarget,
                )
              }
            >
              <Eye />
              查看交接快照
            </button>
          </div>
          <div className="people-attendance-list">
            {data.attendance.length ? (
              data.attendance.map((record) => (
                <article key={record.attendanceRecordId}>
                  <header>
                    <span>
                      <strong>{record.employee.displayName}</strong>
                      <small>
                        {record.employee.employeeCode} ·{" "}
                        {shanghai(record.window.startsAt)}–
                        {shanghai(record.window.endsAt)}
                      </small>
                    </span>
                    <em className={`is-${record.original.status}`}>
                      {record.original.status === "absent"
                        ? "缺勤"
                        : record.original.status === "checked-out"
                          ? "已签退"
                          : "已签到"}
                    </em>
                  </header>
                  <div className="people-attendance-facts">
                    <section>
                      <small>原始事实 · 不可编辑</small>
                      <dl>
                        <div>
                          <dt>签到</dt>
                          <dd>
                            {record.original.checkInBusinessAt
                              ? `${shanghai(record.original.checkInBusinessAt)}${record.original.checkInOutcome === "late" ? " · 迟到" : " · 准时"}`
                              : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt>缺勤</dt>
                          <dd>
                            {record.original.absenceBusinessAt
                              ? shanghai(record.original.absenceBusinessAt)
                              : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt>签退</dt>
                          <dd>
                            {record.original.checkOutBusinessAt
                              ? shanghai(record.original.checkOutBusinessAt)
                              : "—"}
                          </dd>
                        </div>
                      </dl>
                    </section>
                    <section>
                      <small>追加更正 · {record.corrections.length} 条</small>
                      {record.corrections.length ? (
                        record.corrections.map((correction) => (
                          <div
                            className="people-correction"
                            key={correction.correctionId}
                          >
                            <strong>
                              {correction.correctionKind === "late"
                                ? "迟到"
                                : correction.correctionKind === "absence"
                                  ? "缺勤"
                                  : "签退"}{" "}
                              → {shanghai(correction.correctedBusinessAt)}
                            </strong>
                            <p>{correction.reason}</p>
                            <small>
                              {correction.correctedBy} · 记录于{" "}
                              {shanghai(correction.recordedAt)}
                            </small>
                          </div>
                        ))
                      ) : (
                        <p className="people-no-correction">
                          暂无更正，原始事实保持有效。
                        </p>
                      )}
                    </section>
                  </div>
                  <footer>
                    {record.original.status === "absent" ? (
                      <button
                        onClick={(event) =>
                          open(
                            {
                              attendance: record,
                              kind: "absence",
                            },
                            event.currentTarget,
                          )
                        }
                      >
                        <Eye />
                        缺勤详情
                      </button>
                    ) : null}
                    <button
                      disabled={
                        !record.original.checkInBusinessAt &&
                        !record.original.checkOutBusinessAt &&
                        record.original.status !== "absent"
                      }
                      onClick={(event) =>
                        open(
                          {
                            attendance: record,
                            kind: "correction",
                          },
                          event.currentTarget,
                        )
                      }
                    >
                      <ClockCounterClockwise />
                      创建更正
                    </button>
                  </footer>
                </article>
              ))
            ) : (
              <div className="people-empty">
                <CheckCircle />
                <strong>暂无考勤事实</strong>
                <p>员工模拟签到、手动签退或签到窗口关闭后会在此出现。</p>
              </div>
            )}
          </div>
        </section>
      ) : null}
      {data && dialog?.kind === "employee" ? (
        <EmployeeDialog
          csrfToken={csrfToken}
          employee={dialog.employee}
          mode={dialog.mode}
          onClose={close}
          onCompleted={completed}
          storeId={data.store.storeId}
        />
      ) : null}
      {data && dialog?.kind === "shift" ? (
        <ShiftDialog
          csrfToken={csrfToken}
          data={data}
          {...(dialog.employeeId ? { employeeId: dialog.employeeId } : {})}
          onClose={close}
          onCompleted={completed}
          shift={dialog.shift}
        />
      ) : null}
      {dialog?.kind === "handover" ? (
        <HandoverSnapshotDialog onClose={close} refreshKey={refreshKey} />
      ) : null}
      {dialog?.kind === "absence" ? (
        <AbsenceDetailDialog attendance={dialog.attendance} onClose={close} />
      ) : null}
      {data && dialog?.kind === "cancel-shift" ? (
        <CancelShiftDialog
          csrfToken={csrfToken}
          onClose={close}
          onCompleted={completed}
          shift={dialog.shift}
          storeId={data.store.storeId}
        />
      ) : null}
      {data && dialog?.kind === "correction" ? (
        <AttendanceCorrectionDialog
          attendance={dialog.attendance}
          csrfToken={csrfToken}
          onClose={close}
          onCompleted={completed}
          storeId={data.store.storeId}
        />
      ) : null}
    </main>
  );
}

export function HeadquartersPeopleSchedule({
  refreshKey,
}: {
  refreshKey: string;
}) {
  const [data, setData] = useState<HeadquartersPeopleScheduleResponse | null>(
    null,
  );
  const [error, setError] = useState("");
  const stores = useMemo(
    () =>
      canonicalHeadquartersStores(
        data?.stores ?? [],
        (item) => item.store.code,
      ),
    [data],
  );
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void fetch("/api/v1/hq/people-schedule", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok)
          throw new Error(failureMessage(payload, "总部人员汇总读取失败。"));
        return payload as HeadquartersPeopleScheduleResponse;
      })
      .then(setData)
      .catch((loadError: Error) => {
        if (loadError.name !== "AbortError") setError(loadError.message);
      });
    return () => controller.abort();
  }, [refreshKey]);
  return (
    <main className="people-main">
      <header className="people-title-row">
        <div>
          <span>总部运营 · 只读</span>
          <h1>人员与排班汇总</h1>
          <p>跨店仅展示汇总事实；总部没有员工、排班或考勤一线写入口。</p>
        </div>
        <div className="people-title-status">
          <Eye />
          <span>
            <small>权限模式</small>
            <strong>全门店只读</strong>
          </span>
        </div>
      </header>
      {error ? (
        <div className="people-page-error" role="alert">
          {error}
        </div>
      ) : null}
      <section className="people-hq-readonly-notice">
        <ShieldCheck />
        <span>
          <strong>总部只读，不产生访问审计噪声</strong>
          <small>
            需要调整员工或排班时，请切换到对应门店的店长角色；总部不能签到、签退或确认交接。
          </small>
        </span>
      </section>
      <section className="people-hq-summary-wrap">
        {data ? (
          <table aria-label="三店人员与排班汇总">
            <thead>
              <tr>
                <th>门店</th>
                <th>任职人数</th>
                <th>店员 / 店长</th>
                <th>未来班次</th>
                <th>考勤异常</th>
                <th>未来覆盖</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => (
                <tr key={store.store.code}>
                  <td>
                    <strong>{store.store.displayName}</strong>
                    <small>{store.store.code}</small>
                  </td>
                  <td>
                    {store.activeEmployeeCount}/{store.employeeCount}
                  </td>
                  <td>
                    {store.staffCount} / {store.managerCount}
                  </td>
                  <td>{store.futureShiftCount}</td>
                  <td>
                    <span
                      className={`people-hq-status ${store.attendanceAnomalyCount ? "is-warning" : "is-active"}`}
                    >
                      {store.attendanceAnomalyCount
                        ? `${store.attendanceAnomalyCount} 项`
                        : "无异常"}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`people-hq-status ${store.coverageWarnings ? "is-warning" : "is-active"}`}
                    >
                      {store.coverage.warnings.length
                        ? `${shanghai(store.coverage.warnings[0]!.startsAt)} 起覆盖不足`
                        : "覆盖充足"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="people-loading">正在读取三店人员汇总…</div>
        )}
      </section>
      {data ? (
        <div className="people-hq-detail-grid">
          <section>
            <header>
              <span>
                <UsersThree />
              </span>
              <div>
                <small>虚构工作名 · 业务所需字段</small>
                <h2>三店人员明细</h2>
              </div>
            </header>
            <div className="people-hq-table-wrap">
              <table aria-label="三店人员只读明细">
                <thead>
                  <tr>
                    <th>门店</th>
                    <th>员工</th>
                    <th>角色</th>
                    <th>任职</th>
                  </tr>
                </thead>
                <tbody>
                  {stores.flatMap((store) =>
                    store.employees.map((employee) => (
                      <tr key={`${store.store.code}-${employee.employeeCode}`}>
                        <td>{store.store.displayName}</td>
                        <td>
                          <strong>
                            {employee.displayName} · {employee.employeeCode}
                          </strong>
                        </td>
                        <td>{employee.role === "manager" ? "店长" : "店员"}</td>
                        <td>
                          <span
                            className={`people-hq-status ${employee.active ? "is-active" : ""}`}
                          >
                            {employee.active ? "任职中" : "已停用"}
                          </span>
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <header>
              <span>
                <CalendarDots />
              </span>
              <div>
                <small>服务端未来班次 · 上海业务时间</small>
                <h2>未来班次明细</h2>
              </div>
            </header>
            <div className="people-hq-table-wrap">
              <table aria-label="三店未来班次只读明细">
                <thead>
                  <tr>
                    <th>门店</th>
                    <th>员工</th>
                    <th>角色</th>
                    <th>班次</th>
                  </tr>
                </thead>
                <tbody>
                  {stores.flatMap((store) =>
                    store.futureShifts.map((shift) => (
                      <tr
                        key={`${store.store.code}-${shift.employee.employeeCode}-${shift.startsAt}`}
                      >
                        <td>{store.store.displayName}</td>
                        <td>
                          <strong>
                            {shift.employee.displayName} ·{" "}
                            {shift.employee.employeeCode}
                          </strong>
                        </td>
                        <td>
                          {shift.employee.role === "manager" ? "店长" : "店员"}
                        </td>
                        <td>
                          <strong>{shanghai(shift.startsAt)}</strong>
                          <small>至 {shanghai(shift.endsAt)}</small>
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
