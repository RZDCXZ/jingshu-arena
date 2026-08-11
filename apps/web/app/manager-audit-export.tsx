"use client";

import {
  ArrowClockwise,
  CheckCircle,
  ClockCounterClockwise,
  DownloadSimple,
  FileCsv,
  Funnel,
  IdentificationCard,
  ShieldCheck,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  MANAGER_EXPORT_SORT_FIELDS_BY_TYPE,
  MANAGER_EXPORT_STATUS_VALUES,
} from "@jingshu/contracts";
import type {
  ApiErrorResponse,
  ManagerAuditSortField,
  ManagerAuditEventResponse,
  ManagerAuditResponse,
  ManagerExportDataType,
  ManagerExportPreviewResponse,
  ManagerExportRequest,
  ManagerExportSortDirection,
  ManagerExportSortField,
  PublicRole,
} from "@jingshu/contracts";

interface ManagerAuditExportProps {
  readonly csrfToken: string;
  readonly onToast: (message: string) => void;
  readonly refreshKey: string;
}

interface AuditFilterState {
  readonly action: string;
  readonly objectType: string;
  readonly personaId: string;
  readonly result: string;
  readonly role: string;
}

type ExportPhase = "error" | "exporting" | "loading" | "ready" | "success";

class ManagerAuditExportUiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagerAuditExportUiError";
  }
}

const initialFilters: AuditFilterState = {
  action: "",
  objectType: "",
  personaId: "",
  result: "",
  role: "",
};

const roleLabels: Record<PublicRole, string> = {
  customer: "顾客",
  hq: "总部运营",
  manager: "店长",
  staff: "店员",
};

const exportLabels: Record<ManagerExportDataType, string> = {
  audits: "审计记录",
  inventoryMovements: "库存流水",
  orders: "商品订单",
  repairs: "报修记录",
  reservations: "预约记录",
  shifts: "班次记录",
};

const exportTypes = Object.entries(exportLabels) as ReadonlyArray<
  readonly [ManagerExportDataType, string]
>;

const sortLabels: ReadonlyArray<readonly [ManagerAuditSortField, string]> = [
  ["businessOccurredAt", "业务时间"],
  ["recordedAt", "服务器记录时间"],
  ["persona", "人物"],
  ["role", "角色"],
  ["action", "动作"],
  ["objectType", "对象类型"],
  ["result", "结果"],
];

const exportSortLabels: Record<ManagerExportSortField, string> = {
  action: "动作",
  amountCents: "金额",
  businessOccurredAt: "业务时间",
  objectType: "对象类型",
  persona: "人物",
  recordedAt: "服务器记录时间",
  result: "结果",
  role: "角色",
  status: "状态",
};

const exportStatusLabels: Record<string, string> = {
  active: "有效",
  arrived: "已到店",
  assigned: "已分派",
  cancelled: "已取消",
  closed: "已关闭",
  compensation: "补偿",
  completed: "已完成",
  confirmed: "已确认",
  expired: "已过期",
  "in-use": "使用中",
  new: "新建",
  "pending-confirmation": "待确认",
  "pending-simulated-payment": "待模拟支付",
  preparing: "制作中",
  processing: "处理中",
  "ready-for-pickup": "待取",
  receipt: "入库",
  released: "已释放",
  sale: "销售",
  scheduled: "已排班",
  "simulated-paid": "已模拟支付",
  "spare-return": "备件退回",
  "spare-usage": "备件领用",
  stocktake: "盘点",
  verification: "待验证",
  waste: "损耗",
};

const shanghaiDateTime = new Intl.DateTimeFormat("zh-CN", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Shanghai",
  year: "numeric",
});

function formatDateTime(value: string) {
  return shanghaiDateTime.format(new Date(value));
}

function shortId(value: string | null) {
  if (!value) return "—";
  return value.length > 18 ? value.slice(0, 8) + "…" + value.slice(-4) : value;
}

function failureMessage(payload: unknown, fallback: string) {
  return (payload as ApiErrorResponse | null)?.error?.message ?? fallback;
}

function caughtMessage(error: unknown, fallback: string) {
  return error instanceof ManagerAuditExportUiError ? error.message : fallback;
}

function auditUrl(
  filters: AuditFilterState,
  fromBusinessDay: string,
  toBusinessDay: string,
  sortField: ManagerExportSortField,
  sortDirection: ManagerExportSortDirection,
) {
  const query = new URLSearchParams();
  if (fromBusinessDay && toBusinessDay) {
    query.set("from", fromBusinessDay);
    query.set("to", toBusinessDay);
  }
  if (filters.action) query.set("action", filters.action);
  if (filters.objectType) query.set("objectType", filters.objectType);
  if (filters.personaId) query.set("personaId", filters.personaId);
  if (filters.result) query.set("result", filters.result);
  if (filters.role) query.set("role", filters.role);
  query.set("sort", sortField + ":" + sortDirection);
  return "/api/v1/manager/audits?" + query.toString();
}

function safeJson(value: Record<string, unknown> | null) {
  return value ? JSON.stringify(value, null, 2) : "无";
}

function AuditInspector({
  event,
}: {
  readonly event: ManagerAuditEventResponse;
}) {
  return (
    <aside className="manager-audit-inspector" aria-label="审计详情">
      <header>
        <span>
          <ShieldCheck weight="duotone" />
        </span>
        <div>
          <small>AUDIT EVIDENCE</small>
          <h2>审计详情</h2>
        </div>
        <strong className={"manager-audit-result is-" + event.result}>
          {event.result === "allowed" ? "允许" : "拒绝"}
        </strong>
      </header>
      <dl className="manager-audit-detail-grid">
        <div>
          <dt>动作</dt>
          <dd>{event.action}</dd>
        </div>
        <div>
          <dt>人物 / 角色</dt>
          <dd>
            {event.actor.displayName} · {roleLabels[event.role]}
          </dd>
        </div>
        <div>
          <dt>门店范围</dt>
          <dd>
            {event.store.displayName} · {event.store.code}
          </dd>
        </div>
        <div>
          <dt>业务发生时间</dt>
          <dd>{formatDateTime(event.businessOccurredAt)}</dd>
        </div>
        <div>
          <dt>服务器记录时间</dt>
          <dd>{formatDateTime(event.recordedAt)}</dd>
        </div>
        <div>
          <dt>对象</dt>
          <dd>
            {event.objectType} · {shortId(event.objectId)}
          </dd>
        </div>
        <div>
          <dt>请求编号</dt>
          <dd title={event.requestId}>{shortId(event.requestId)}</dd>
        </div>
      </dl>
      {event.reason ? (
        <section className="manager-audit-reason">
          <small>判定原因</small>
          <p>{event.reason}</p>
        </section>
      ) : null}
      <section className="manager-audit-diff">
        <header>
          <small>BEFORE</small>
          <span>变更前</span>
        </header>
        <pre>{safeJson(event.before)}</pre>
      </section>
      <section className="manager-audit-diff is-after">
        <header>
          <small>AFTER</small>
          <span>变更后</span>
        </header>
        <pre>{safeJson(event.after)}</pre>
      </section>
      <p className="manager-audit-safety-note">
        仅显示服务端允许的审计字段；凭据、原始请求体与图片内容不会进入详情。
      </p>
    </aside>
  );
}

interface ExportDialogProps {
  readonly auditData: ManagerAuditResponse;
  readonly csrfToken: string;
  readonly filters: AuditFilterState;
  readonly fromBusinessDay: string;
  readonly onClose: () => void;
  readonly onToast: (message: string) => void;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
  readonly sortDirection: ManagerExportSortDirection;
  readonly sortField: ManagerExportSortField;
  readonly toBusinessDay: string;
}

function ExportDialog({
  auditData,
  csrfToken,
  filters,
  fromBusinessDay,
  onClose,
  onToast,
  returnFocusRef,
  sortDirection,
  sortField,
  toBusinessDay,
}: ExportDialogProps) {
  const [dataType, setDataType] = useState<ManagerExportDataType>("audits");
  const [exportFrom, setExportFrom] = useState(fromBusinessDay);
  const [exportTo, setExportTo] = useState(toBusinessDay);
  const [exportSearch, setExportSearch] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [exportSortField, setExportSortField] =
    useState<ManagerExportSortField>("businessOccurredAt");
  const [exportSortDirection, setExportSortDirection] =
    useState<ManagerExportSortDirection>("asc");
  const [phase, setPhase] = useState<ExportPhase>("loading");
  const [failedExport, setFailedExport] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<ManagerExportPreviewResponse | null>(
    null,
  );
  const [downloaded, setDownloaded] = useState({
    filename: "",
    rowCount: 0,
  });
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const auditFilterCount = Object.values(filters).filter(Boolean).length;

  const request = useMemo<ManagerExportRequest>(
    () =>
      ({
        dataType,
        filters:
          dataType === "audits"
            ? {
                ...(filters.action ? { action: filters.action } : {}),
                ...(filters.objectType
                  ? { objectType: filters.objectType }
                  : {}),
                ...(filters.personaId ? { personaId: filters.personaId } : {}),
                ...(filters.result
                  ? { result: filters.result as "allowed" | "denied" }
                  : {}),
                ...(filters.role ? { role: filters.role as PublicRole } : {}),
              }
            : {
                ...(exportSearch.trim() ? { search: exportSearch.trim() } : {}),
                ...(exportStatus.trim() ? { status: exportStatus.trim() } : {}),
              },
        fromBusinessDay: exportFrom,
        sort:
          dataType === "audits"
            ? { direction: sortDirection, field: sortField }
            : {
                direction: exportSortDirection,
                field: exportSortField,
              },
        storeId: auditData.store.storeId,
        toBusinessDay: exportTo,
      }) as ManagerExportRequest,
    [
      auditData.store.storeId,
      dataType,
      exportFrom,
      exportSearch,
      exportSortDirection,
      exportSortField,
      exportStatus,
      exportTo,
      filters,
      sortDirection,
      sortField,
    ],
  );

  const previewExport = useCallback(
    async (signal?: AbortSignal) => {
      setPhase("loading");
      setMessage("");
      setFailedExport(false);
      setPreview(null);
      try {
        const response = await fetch("/api/v1/manager/exports/preview", {
          body: JSON.stringify(request),
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          method: "POST",
          ...(signal ? { signal } : {}),
        });
        const payload = (await response.json().catch(() => null)) as
          ManagerExportPreviewResponse | ApiErrorResponse | null;
        if (!response.ok || !payload || !("estimatedRowCount" in payload)) {
          throw new ManagerAuditExportUiError(
            failureMessage(payload, "导出范围暂时无法核对，请保持筛选并重试。"),
          );
        }
        setPreview(payload);
        setPhase("ready");
      } catch (error) {
        if (signal?.aborted) return;
        setMessage(
          caughtMessage(error, "导出范围暂时无法核对；筛选保持不变，请重试。"),
        );
        setPhase("error");
      }
    },
    [csrfToken, request],
  );

  useEffect(() => {
    const controller = new AbortController();
    void previewExport(controller.signal);
    return () => controller.abort();
  }, [previewExport]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (event.key === "Escape" && phaseRef.current !== "exporting") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
        ),
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
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (document.contains(previousFocus)) previousFocus?.focus();
      else returnFocusRef.current?.focus();
    };
  }, [onClose, returnFocusRef]);

  const download = useCallback(async () => {
    setPhase("exporting");
    setMessage("");
    try {
      const response = await fetch("/api/v1/manager/exports", {
        body: JSON.stringify(request),
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        method: "POST",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new ManagerAuditExportUiError(
          failureMessage(
            payload,
            "导出生成失败；筛选已保留，请使用相同范围重试。",
          ),
        );
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename =
        disposition.match(/filename="([^"]+)"/u)?.[1] ??
        ["jingshu", dataType, exportFrom, exportTo].join("-") + ".csv";
      const rowCount = Number(
        response.headers.get("X-Export-Row-Count") ??
          preview?.estimatedRowCount ??
          0,
      );
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
      setDownloaded({ filename, rowCount });
      setPhase("success");
      onToast("已导出 " + rowCount + " 行，并写入一条导出审计。");
    } catch (error) {
      setFailedExport(true);
      setMessage(
        caughtMessage(error, "导出生成失败；筛选已保留，请使用相同范围重试。"),
      );
      setPhase("error");
    }
  }, [csrfToken, dataType, exportFrom, exportTo, onToast, preview, request]);

  return (
    <div className="manager-export-backdrop" role="presentation">
      <div
        aria-labelledby="manager-export-title"
        aria-modal="true"
        className="manager-export-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <span>
            <FileCsv weight="duotone" />
          </span>
          <div>
            <small>STORE-SCOPED CSV</small>
            <h2 id="manager-export-title">导出当前门店数据</h2>
          </div>
          <button
            aria-label="关闭导出"
            className="manager-export-close"
            disabled={phase === "exporting"}
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <X />
          </button>
        </header>
        <p className="manager-export-intro">
          文件固定为 UTF-8 CSV。范围锁定“{auditData.store.displayName}
          ”，审计导出沿用页面筛选与排序。
        </p>
        <div className="manager-export-fields">
          <label>
            数据类型
            <select
              aria-label="导出数据类型"
              disabled={phase === "exporting"}
              onChange={(event) => {
                setDataType(event.target.value as ManagerExportDataType);
                setExportSearch("");
                setExportStatus("");
                setExportSortField("businessOccurredAt");
              }}
              value={dataType}
            >
              {exportTypes.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            当前门店
            <input
              aria-label="导出门店"
              disabled
              value={auditData.store.displayName + " · 固定"}
            />
          </label>
          <label>
            起始经营日
            <select
              aria-label="导出起始经营日"
              disabled={phase === "exporting"}
              onChange={(event) => {
                const next = event.target.value;
                setExportFrom(next);
                setExportTo((current) => (current < next ? next : current));
              }}
              value={exportFrom}
            >
              {auditData.availableBusinessDays.map((day) => (
                <option key={day.key} value={day.key}>
                  {day.key}
                </option>
              ))}
            </select>
          </label>
          <label>
            截止经营日
            <select
              aria-label="导出截止经营日"
              disabled={phase === "exporting"}
              onChange={(event) => {
                const next = event.target.value;
                setExportTo(next);
                setExportFrom((current) => (current > next ? next : current));
              }}
              value={exportTo}
            >
              {auditData.availableBusinessDays.map((day) => (
                <option key={day.key} value={day.key}>
                  {day.key}
                </option>
              ))}
            </select>
          </label>
          {dataType === "audits" ? (
            <div className="manager-export-current-filter">
              <span>当前审计条件</span>
              <strong>
                {auditFilterCount === 0
                  ? "无筛选"
                  : auditFilterCount + " 项筛选"}{" "}
                ·{" "}
                {sortLabels.find(([value]) => value === sortField)?.[1] ??
                  "业务时间"}
                {sortDirection === "desc" ? "倒序" : "正序"}
              </strong>
            </div>
          ) : (
            <>
              <label>
                搜索
                <input
                  aria-label="导出搜索"
                  disabled={phase === "exporting"}
                  maxLength={200}
                  onChange={(event) => setExportSearch(event.target.value)}
                  placeholder="ID、人物或业务对象"
                  value={exportSearch}
                />
              </label>
              <label>
                状态
                <select
                  aria-label="导出状态筛选"
                  disabled={phase === "exporting"}
                  onChange={(event) => setExportStatus(event.target.value)}
                  value={exportStatus}
                >
                  <option value="">全部状态</option>
                  {MANAGER_EXPORT_STATUS_VALUES[dataType].map((status) => (
                    <option key={status} value={status}>
                      {exportStatusLabels[status] ?? status}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                排序字段
                <select
                  aria-label="导出排序字段"
                  disabled={phase === "exporting"}
                  onChange={(event) =>
                    setExportSortField(
                      event.target.value as ManagerExportSortField,
                    )
                  }
                  value={exportSortField}
                >
                  {MANAGER_EXPORT_SORT_FIELDS_BY_TYPE[dataType].map((field) => (
                    <option key={field} value={field}>
                      {exportSortLabels[field]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                排序方向
                <select
                  aria-label="导出排序方向"
                  disabled={phase === "exporting"}
                  onChange={(event) =>
                    setExportSortDirection(
                      event.target.value as ManagerExportSortDirection,
                    )
                  }
                  value={exportSortDirection}
                >
                  <option value="asc">正序</option>
                  <option value="desc">倒序</option>
                </select>
              </label>
            </>
          )}
        </div>
        <section
          className={"manager-export-state is-" + phase}
          aria-live="polite"
        >
          {phase === "loading" ? (
            <>
              <ArrowClockwise className="is-spinning" />
              <span>
                <strong>正在核对导出范围…</strong>
                <small>读取服务端行数，不会生成文件或写入审计。</small>
              </span>
            </>
          ) : phase === "exporting" ? (
            <>
              <ArrowClockwise className="is-spinning" />
              <span>
                <strong>正在生成 CSV…</strong>
                <small>完成后下载文件，并写入一条导出审计。</small>
              </span>
            </>
          ) : phase === "success" ? (
            <>
              <CheckCircle weight="fill" />
              <span>
                <strong>导出完成 · {downloaded.rowCount} 行</strong>
                <small>{downloaded.filename} · 导出审计已写入</small>
              </span>
            </>
          ) : phase === "error" ? (
            <>
              <Warning weight="fill" />
              <span>
                <strong>导出未完成</strong>
                <small>{message}</small>
              </span>
            </>
          ) : (
            <>
              <ShieldCheck weight="fill" />
              <span>
                <strong>
                  可导出 {preview?.estimatedRowCount ?? 0} 行 ·{" "}
                  {exportLabels[dataType]}
                </strong>
                <small>
                  {exportFrom} 至 {exportTo} · {auditData.store.code}
                </small>
              </span>
            </>
          )}
        </section>
        {phase === "ready" && preview ? (
          <section
            aria-label={`${exportLabels[dataType]}当前筛选预览`}
            className="manager-export-preview"
          >
            <header>
              <strong>当前所见筛选结果</strong>
              <small>{preview.estimatedRowCount} 行 · 将按此顺序导出</small>
            </header>
            <div>
              <table>
                <thead>
                  <tr>
                    {preview.columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.length > 0 ? (
                    preview.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={preview.columns[cellIndex] ?? cellIndex}>
                            {cell || "—"}
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={Math.max(1, preview.columns.length)}>
                        当前筛选没有可导出记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
        <footer>
          <button
            className="manager-export-secondary"
            disabled={phase === "exporting"}
            onClick={onClose}
            type="button"
          >
            {phase === "success" ? "完成" : "取消"}
          </button>
          {phase === "error" ? (
            <button
              className="manager-export-primary"
              onClick={() =>
                failedExport ? void download() : void previewExport()
              }
              type="button"
            >
              <ArrowClockwise />
              使用相同筛选重试
            </button>
          ) : phase === "success" ? (
            <button
              className="manager-export-primary"
              onClick={() => void download()}
              type="button"
            >
              <DownloadSimple />
              再次下载
            </button>
          ) : (
            <button
              className="manager-export-primary"
              disabled={phase !== "ready"}
              onClick={() => void download()}
              type="button"
            >
              <DownloadSimple />
              生成并下载 CSV
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

export function ManagerAuditExport({
  csrfToken,
  onToast,
  refreshKey,
}: ManagerAuditExportProps) {
  const [data, setData] = useState<ManagerAuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<AuditFilterState>(initialFilters);
  const [fromBusinessDay, setFromBusinessDay] = useState("");
  const [toBusinessDay, setToBusinessDay] = useState("");
  const [sortField, setSortField] =
    useState<ManagerExportSortField>("businessOccurredAt");
  const [sortDirection, setSortDirection] =
    useState<ManagerExportSortDirection>("desc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          auditUrl(
            filters,
            fromBusinessDay,
            toBusinessDay,
            sortField,
            sortDirection,
          ),
          { cache: "no-store", ...(signal ? { signal } : {}) },
        );
        const payload = (await response.json().catch(() => null)) as
          ManagerAuditResponse | ApiErrorResponse | null;
        if (!response.ok || !payload || !("events" in payload)) {
          throw new ManagerAuditExportUiError(
            failureMessage(
              payload,
              "审计数据暂时无法读取；页面不会展示伪造数据。",
            ),
          );
        }
        setData(payload);
        setSelectedId((current) =>
          payload.events.some((event) => event.eventId === current)
            ? current
            : (payload.events[0]?.eventId ?? null),
        );
      } catch (loadError) {
        if (signal?.aborted) return;
        setError(
          caughtMessage(
            loadError,
            "审计数据暂时无法读取；页面不会展示伪造数据。",
          ),
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [filters, fromBusinessDay, sortDirection, sortField, toBusinessDay],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  const selectedEvent = useMemo(
    () =>
      data?.events.find((event) => event.eventId === selectedId) ??
      data?.events[0] ??
      null,
    [data, selectedId],
  );
  const displayFrom = fromBusinessDay || data?.range.fromBusinessDay || "";
  const displayTo = toBusinessDay || data?.range.toBusinessDay || "";
  const filtersActive = Object.values(filters).some(Boolean);

  const updateFilter = (key: keyof AuditFilterState, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  return (
    <main className="manager-audit-main">
      <header className="manager-audit-title-row">
        <div>
          <span>WEB-M10 · STORE EVIDENCE</span>
          <h1>审计与导出</h1>
          <p>
            当前店长仅可读取和导出所属门店；业务时间与服务器记录时间并列保留。
          </p>
        </div>
        <button
          className="manager-audit-export-button"
          disabled={!data}
          onClick={() => setExportOpen(true)}
          ref={exportTriggerRef}
          type="button"
        >
          <FileCsv weight="duotone" />
          导出 CSV
        </button>
      </header>

      <section className="manager-audit-filter-panel" aria-label="审计筛选">
        <header>
          <span>
            <Funnel weight="fill" />
            审计筛选
          </span>
          <small>{data ? data.totalCount + " 条服务端记录" : "读取中"}</small>
          {filtersActive ? (
            <button onClick={() => setFilters(initialFilters)} type="button">
              清除筛选
            </button>
          ) : null}
        </header>
        <div className="manager-audit-filters">
          <label>
            起始经营日
            <select
              aria-label="审计起始经营日"
              disabled={!data}
              onChange={(event) => {
                const next = event.target.value;
                setFromBusinessDay(next);
                setToBusinessDay((current) =>
                  current ? (current < next ? next : current) : displayTo,
                );
              }}
              value={displayFrom}
            >
              {data?.availableBusinessDays.map((day) => (
                <option key={day.key} value={day.key}>
                  {day.key}
                </option>
              ))}
            </select>
          </label>
          <label>
            截止经营日
            <select
              aria-label="审计截止经营日"
              disabled={!data}
              onChange={(event) => {
                const next = event.target.value;
                setToBusinessDay(next);
                setFromBusinessDay((current) =>
                  current ? (current > next ? next : current) : displayFrom,
                );
              }}
              value={displayTo}
            >
              {data?.availableBusinessDays.map((day) => (
                <option key={day.key} value={day.key}>
                  {day.key}
                </option>
              ))}
            </select>
          </label>
          <label>
            门店
            <select
              aria-label="审计门店范围"
              disabled
              value={data?.store.storeId ?? ""}
            >
              {data ? (
                <option value={data.store.storeId}>
                  {data.store.displayName} · 固定
                </option>
              ) : (
                <option value="">当前门店</option>
              )}
            </select>
          </label>
          <label>
            人物
            <select
              aria-label="按人物筛选审计"
              disabled={!data}
              onChange={(event) =>
                updateFilter("personaId", event.target.value)
              }
              value={filters.personaId}
            >
              <option value="">全部人物</option>
              {data?.filterOptions.personas.map((persona) => (
                <option key={persona.personaId} value={persona.personaId}>
                  {persona.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            角色
            <select
              aria-label="按角色筛选审计"
              disabled={!data}
              onChange={(event) => updateFilter("role", event.target.value)}
              value={filters.role}
            >
              <option value="">全部角色</option>
              {data?.filterOptions.roles.map((role) => (
                <option key={role} value={role}>
                  {roleLabels[role]}
                </option>
              ))}
            </select>
          </label>
          <label>
            动作
            <select
              aria-label="按动作筛选审计"
              disabled={!data}
              onChange={(event) => updateFilter("action", event.target.value)}
              value={filters.action}
            >
              <option value="">全部动作</option>
              {data?.filterOptions.actions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </label>
          <label>
            对象类型
            <select
              aria-label="按对象类型筛选审计"
              disabled={!data}
              onChange={(event) =>
                updateFilter("objectType", event.target.value)
              }
              value={filters.objectType}
            >
              <option value="">全部对象</option>
              {data?.filterOptions.objectTypes.map((objectType) => (
                <option key={objectType} value={objectType}>
                  {objectType}
                </option>
              ))}
            </select>
          </label>
          <label>
            结果
            <select
              aria-label="按结果筛选审计"
              disabled={!data}
              onChange={(event) => updateFilter("result", event.target.value)}
              value={filters.result}
            >
              <option value="">全部结果</option>
              <option value="allowed">允许</option>
              <option value="denied">拒绝</option>
            </select>
          </label>
          <label>
            排序
            <span className="manager-audit-sort-control">
              <select
                aria-label="审计排序字段"
                disabled={!data}
                onChange={(event) =>
                  setSortField(event.target.value as ManagerExportSortField)
                }
                value={sortField}
              >
                {sortLabels.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                aria-label={
                  sortDirection === "desc"
                    ? "当前倒序，切换正序"
                    : "当前正序，切换倒序"
                }
                disabled={!data}
                onClick={() =>
                  setSortDirection((current) =>
                    current === "desc" ? "asc" : "desc",
                  )
                }
                type="button"
              >
                {sortDirection === "desc" ? "↓" : "↑"}
              </button>
            </span>
          </label>
        </div>
      </section>

      {error ? (
        <div className="manager-audit-inline-error" role="alert">
          <Warning weight="fill" />
          <span>{error}</span>
          <button onClick={() => void load()} type="button">
            <ArrowClockwise />
            重试
          </button>
        </div>
      ) : null}

      <section className="manager-audit-workspace">
        <div className="manager-audit-table-panel">
          <header>
            <span>
              <ClockCounterClockwise />
              时间线
            </span>
            <small>
              {data?.store.displayName ?? "当前门店"} · {displayFrom || "—"} 至{" "}
              {displayTo || "—"}
            </small>
          </header>
          <div className="manager-audit-table-scroll">
            <table aria-label="本店审计记录">
              <thead>
                <tr>
                  <th>双时间</th>
                  <th>人物 / 角色</th>
                  <th>动作</th>
                  <th>对象</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data ? (
                  Array.from({ length: 8 }, (_, index) => (
                    <tr className="manager-audit-skeleton" key={index}>
                      <td colSpan={5}>
                        <span />
                      </td>
                    </tr>
                  ))
                ) : data?.events.length ? (
                  data.events.map((event) => (
                    <tr
                      aria-selected={selectedEvent?.eventId === event.eventId}
                      className={
                        selectedEvent?.eventId === event.eventId
                          ? "is-selected"
                          : ""
                      }
                      key={event.eventId}
                      onClick={() => setSelectedId(event.eventId)}
                    >
                      <td>
                        <button
                          aria-label={
                            "查看 " +
                            event.actor.displayName +
                            " 的 " +
                            event.action +
                            " 审计详情"
                          }
                          onClick={() => setSelectedId(event.eventId)}
                          type="button"
                        >
                          <strong>
                            {formatDateTime(event.businessOccurredAt)}
                          </strong>
                          <small>录入 {formatDateTime(event.recordedAt)}</small>
                        </button>
                      </td>
                      <td>
                        <strong>{event.actor.displayName}</strong>
                        <small>{roleLabels[event.role]}</small>
                      </td>
                      <td>
                        <code>{event.action}</code>
                      </td>
                      <td>
                        <strong>{event.objectType}</strong>
                        <small>{shortId(event.objectId)}</small>
                      </td>
                      <td>
                        <span
                          className={"manager-audit-result is-" + event.result}
                        >
                          {event.result === "allowed" ? "允许" : "拒绝"}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr className="manager-audit-empty-row">
                    <td colSpan={5}>
                      <IdentificationCard />
                      <strong>当前筛选没有审计记录</strong>
                      <small>
                        调整经营日、人物、角色、动作、对象类型或结果后再试。
                      </small>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        {selectedEvent ? (
          <AuditInspector event={selectedEvent} />
        ) : (
          <aside className="manager-audit-inspector is-empty">
            <ShieldCheck />
            <strong>选择一条审计记录</strong>
            <small>这里会显示双时间、请求编号和脱敏后的前后差异。</small>
          </aside>
        )}
      </section>

      {loading && data ? (
        <div className="manager-audit-refreshing" role="status">
          <ArrowClockwise className="is-spinning" /> 更新筛选结果…
        </div>
      ) : null}

      {exportOpen && data ? (
        <ExportDialog
          auditData={data}
          csrfToken={csrfToken}
          filters={filters}
          fromBusinessDay={displayFrom}
          onClose={() => setExportOpen(false)}
          onToast={onToast}
          returnFocusRef={exportTriggerRef}
          sortDirection={sortDirection}
          sortField={sortField}
          toBusinessDay={displayTo}
        />
      ) : null}
    </main>
  );
}
