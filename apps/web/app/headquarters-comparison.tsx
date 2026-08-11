"use client";

import {
  ArrowRight,
  Buildings,
  CalendarBlank,
  ChartLineUp,
  CheckCircle,
  ClockCounterClockwise,
  FileCsv,
  Info,
  Package,
  Seat,
  Warning,
  WarningCircle,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Icon } from "@phosphor-icons/react";
import type {
  ApiErrorResponse,
  HeadquartersComparisonResponse,
  HeadquartersComparisonStoreResponse,
  ManagerDashboardDayResponse,
  ManagerDashboardDrilldownKind,
} from "@jingshu/contracts";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type HeadquartersPage = "chain" | "compare";
type RangePreset = "current" | "custom" | "last14" | "last7";
type ComparisonMetric =
  | "attendance"
  | "handover"
  | "inventory"
  | "maintenance"
  | "orders"
  | "repairs"
  | "revenue"
  | "utilization";

interface HeadquartersComparisonProps {
  readonly onNavigateAudit: () => void;
  readonly onNavigateCompare: () => void;
  readonly page: HeadquartersPage;
  readonly refreshKey: string;
}

const money = new Intl.NumberFormat("zh-CN", {
  currency: "CNY",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

function formatMoney(cents: number) {
  return money.format(cents / 100);
}

function formatRate(basisPoints: number) {
  return `${(basisPoints / 100).toFixed(1)}%`;
}

function dayLabel(value: string) {
  return value.slice(5).replace("-", "/");
}

function shanghaiTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function failureMessage(payload: unknown) {
  return (
    (payload as ApiErrorResponse | null)?.error?.message ??
    "连锁经营事实暂时无法读取；页面不会展示伪造数据。"
  );
}

function attendanceExceptions(
  attendance: HeadquartersComparisonStoreResponse["summary"]["attendance"],
) {
  return attendance.absent + attendance.late;
}

function anomalyCount(store: HeadquartersComparisonStoreResponse) {
  return (
    store.summary.inventory.lowStockCount +
    store.summary.repairs.openCount +
    attendanceExceptions(store.summary.attendance) +
    store.summary.handoverExceptionCount
  );
}

interface MetricDefinition {
  readonly definition: string;
  readonly drilldown: ManagerDashboardDrilldownKind;
  readonly format: (value: number) => string;
  readonly icon: Icon;
  readonly label: string;
  readonly readDay: (day: ManagerDashboardDayResponse) => number | null;
  readonly readSummary: (store: HeadquartersComparisonStoreResponse) => number;
}

const metricDefinitions: Record<ComparisonMetric, MetricDefinition> = {
  attendance: {
    definition: "按经营日统计迟到与缺勤事实；准时记录单独保留，不混入异常数。",
    drilldown: "attendance",
    format: (value) => `${value} 项`,
    icon: ClockCounterClockwise,
    label: "考勤异常",
    readDay: (day) => day.attendance.absent + day.attendance.late,
    readSummary: (store) => attendanceExceptions(store.summary.attendance),
  },
  handover: {
    definition: "分别记录逾期未提交、迟交与长期未确认；不生成现金盘点差异。",
    drilldown: "handover",
    format: (value) => `${value} 项`,
    icon: WarningCircle,
    label: "交接异常",
    readDay: (day) => day.handoverExceptionCount,
    readSummary: (store) => store.summary.handoverExceptionCount,
  },
  inventory: {
    definition:
      "数据截止时点的当前可用库存快照；没有历史快照时明确留空，不以零值回填。总部只读，不直接修改数量。",
    drilldown: "inventory",
    format: (value) => `${value} 项`,
    icon: Package,
    label: "库存告警",
    readDay: (day) => day.inventory.lowStockCount,
    readSummary: (store) => store.summary.inventory.lowStockCount,
  },
  maintenance: {
    definition:
      "维护不可用率 = 维修处理中维护分钟 / 营业座位分钟，与运营利用率使用独立分母。",
    drilldown: "seats",
    format: formatRate,
    icon: Wrench,
    label: "维护不可用率",
    readDay: (day) => day.seats.maintenanceRateBasisPoints,
    readSummary: (store) => store.summary.seats.maintenanceRateBasisPoints,
  },
  orders: {
    definition: "订单完成率只以已模拟支付且进入完成或取消终态的订单为分母。",
    drilldown: "orders",
    format: formatRate,
    icon: Package,
    label: "订单完成率",
    readDay: (day) => day.orders.completionRateBasisPoints,
    readSummary: (store) => store.summary.orders.completionRateBasisPoints,
  },
  repairs: {
    definition:
      "显示所选经营日范围结束时仍未关闭的报修数；中位处理时长不代表 SLA。",
    drilldown: "repairs",
    format: (value) => `${value} 项`,
    icon: Wrench,
    label: "未关闭报修",
    readDay: (day) => day.repairs.openCount,
    readSummary: (store) => store.summary.repairs.openCount,
  },
  revenue: {
    definition:
      "只计已完成预约与商品订单并扣除模拟退款；预约按未退款半小时片段归属经营日。",
    drilldown: "revenue",
    format: formatMoney,
    icon: ChartLineUp,
    label: "模拟营业额",
    readDay: (day) => day.revenue.totalCents,
    readSummary: (store) => store.summary.revenue.totalCents,
  },
  utilization: {
    definition:
      "运营座位利用率 = 使用分钟 / 正常可经营座位分钟；维护分钟不进入分母。",
    drilldown: "seats",
    format: formatRate,
    icon: Seat,
    label: "运营座位利用率",
    readDay: (day) => day.seats.operationalUtilizationBasisPoints,
    readSummary: (store) =>
      store.summary.seats.operationalUtilizationBasisPoints,
  },
};

const metricOrder: ReadonlyArray<ComparisonMetric> = [
  "revenue",
  "utilization",
  "maintenance",
  "orders",
  "inventory",
  "repairs",
  "attendance",
  "handover",
];

const storeColors = ["#b8f34a", "#59d8ff", "#b9a7ff"] as const;

function rangeFor(
  preset: RangePreset,
  days: HeadquartersComparisonResponse["availableBusinessDays"],
  customFrom: string,
  customTo: string,
) {
  if (preset === "current") return {};
  if (preset === "custom") {
    return customFrom && customTo ? { from: customFrom, to: customTo } : {};
  }
  const selected = preset === "last7" ? days.slice(-7) : days;
  return selected.length
    ? { from: selected[0]!.key, to: selected.at(-1)!.key }
    : {};
}

function dashboardUrl(
  range: { readonly from?: string; readonly to?: string },
  storeId?: string,
  drilldown?: ManagerDashboardDrilldownKind,
) {
  const query = new URLSearchParams();
  if (range.from) query.set("from", range.from);
  if (range.to) query.set("to", range.to);
  if (storeId) query.set("storeId", storeId);
  if (drilldown) query.set("drilldown", drilldown);
  const suffix = query.toString();
  return `/api/v1/hq/dashboard${suffix ? `?${suffix}` : ""}`;
}

function LoadingState() {
  return (
    <main className="hq-comparison-main" aria-busy="true">
      <div className="manager-dashboard-loading" role="status">
        <ClockCounterClockwise weight="duotone" />
        <span>
          <strong>正在汇总固定三店经营事实</strong>
          <small>三店使用相同公式和 06:00 上海经营日边界。</small>
        </span>
      </div>
      <div className="manager-dashboard-skeleton-grid" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </main>
  );
}

function useDialogKeyboard(onClose: () => void) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    const close = closeRef.current;
    close?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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
    dialog?.addEventListener("keydown", onKeyDown);
    return () => dialog?.removeEventListener("keydown", onKeyDown);
  }, []);

  return { closeRef, dialogRef };
}

function DrilldownPanel({
  data,
  metric,
  onClose,
}: {
  readonly data: HeadquartersComparisonStoreResponse;
  readonly metric: ComparisonMetric;
  readonly onClose: () => void;
}) {
  const rows = data.drilldown?.rows ?? [];
  const { closeRef, dialogRef } = useDialogKeyboard(onClose);
  return (
    <aside
      aria-labelledby="hq-drilldown-title"
      aria-modal="true"
      className="manager-dashboard-drilldown hq-drilldown"
      ref={dialogRef}
      role="dialog"
    >
      <header>
        <div>
          <small>{data.store.displayName} · 总部只读下钻</small>
          <h2 id="hq-drilldown-title">{metricDefinitions[metric].label}构成</h2>
        </div>
        <button
          aria-label="关闭总部只读下钻"
          onClick={onClose}
          ref={closeRef}
          type="button"
        >
          <X />
        </button>
      </header>
      <div className="manager-dashboard-drilldown-body">
        {rows.length ? (
          <ol>
            {rows.map((row) => (
              <li key={`${row.objectType}-${row.objectId}-${row.occurredAt}`}>
                <time>{shanghaiTime(row.occurredAt)}</time>
                <span>
                  <strong>{row.title}</strong>
                  <small>{row.detail}</small>
                  <em>
                    {row.businessDayKey} · {row.status}
                    {row.amountCents === null
                      ? ""
                      : ` · ${formatMoney(row.amountCents)}`}
                  </em>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <section className="manager-dashboard-empty">
            <CheckCircle weight="duotone" />
            <strong>当前范围没有对应记录</strong>
            <p>可调整经营日范围后再次下钻。</p>
          </section>
        )}
      </div>
      <footer>
        <span>总部下钻始终只读；一线处理请切换对应门店角色。</span>
      </footer>
    </aside>
  );
}

function AnomalyPanel({
  onClose,
  onOpenMetric,
  store,
}: {
  readonly onClose: () => void;
  readonly onOpenMetric: (metric: ComparisonMetric) => void;
  readonly store: HeadquartersComparisonStoreResponse;
}) {
  const { closeRef, dialogRef } = useDialogKeyboard(onClose);
  const categories: ReadonlyArray<{
    readonly count: number;
    readonly label: string;
    readonly metric: ComparisonMetric;
  }> = [
    {
      count: store.summary.inventory.lowStockCount,
      label: "库存告警",
      metric: "inventory",
    },
    {
      count: store.summary.repairs.openCount,
      label: "未关闭报修",
      metric: "repairs",
    },
    {
      count: attendanceExceptions(store.summary.attendance),
      label: "考勤异常",
      metric: "attendance",
    },
    {
      count: store.summary.handoverExceptionCount,
      label: "交接异常",
      metric: "handover",
    },
  ];
  return (
    <aside
      aria-labelledby="hq-anomaly-title"
      aria-modal="true"
      className="manager-dashboard-drilldown hq-drilldown hq-anomaly-dialog"
      ref={dialogRef}
      role="dialog"
    >
      <header>
        <div>
          <small>{store.store.displayName} · 总部只读下钻</small>
          <h2 id="hq-anomaly-title">经营异常构成</h2>
        </div>
        <button
          aria-label="关闭经营异常构成"
          onClick={onClose}
          ref={closeRef}
          type="button"
        >
          <X />
        </button>
      </header>
      <div className="manager-dashboard-drilldown-body">
        <ol>
          {categories.map((category) => (
            <li key={category.metric}>
              <span>
                <strong>{category.label}</strong>
                <small>{category.count} 项</small>
              </span>
              <button
                disabled={category.count === 0}
                onClick={() => onOpenMetric(category.metric)}
                type="button"
              >
                查看构成 <ArrowRight />
              </button>
            </li>
          ))}
        </ol>
      </div>
      <footer>
        <span>
          合计 {anomalyCount(store)} 项；各类异常分别进入对应事实下钻。
        </span>
      </footer>
    </aside>
  );
}

export function HeadquartersComparison({
  onNavigateAudit,
  onNavigateCompare,
  page,
  refreshKey,
}: HeadquartersComparisonProps) {
  const [data, setData] = useState<HeadquartersComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preset, setPreset] = useState<RangePreset>("current");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [metric, setMetric] = useState<ComparisonMetric>(
    page === "chain" ? "utilization" : "revenue",
  );
  const [storeFilter, setStoreFilter] = useState("");
  const [drilldown, setDrilldown] = useState<{
    readonly metric: ComparisonMetric;
    readonly store: HeadquartersComparisonStoreResponse;
  } | null>(null);
  const [anomalyStore, setAnomalyStore] =
    useState<HeadquartersComparisonStoreResponse | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(
    async (
      nextPreset: RangePreset,
      customRange?: { readonly from: string; readonly to: string },
      refreshRollingRange = false,
    ) => {
      setLoading(true);
      setError("");
      try {
        let availableBusinessDays = data?.availableBusinessDays ?? [];
        if (
          refreshRollingRange &&
          (nextPreset === "last7" || nextPreset === "last14")
        ) {
          const freshResponse = await fetch(dashboardUrl({}), {
            cache: "no-store",
            credentials: "same-origin",
          });
          const freshPayload: unknown = await freshResponse
            .json()
            .catch(() => null);
          if (!freshResponse.ok) {
            throw new Error(failureMessage(freshPayload));
          }
          availableBusinessDays = (
            freshPayload as HeadquartersComparisonResponse
          ).availableBusinessDays;
        }
        const range = rangeFor(
          nextPreset,
          availableBusinessDays,
          customRange?.from ?? customFrom,
          customRange?.to ?? customTo,
        );
        const response = await fetch(dashboardUrl(range), {
          cache: "no-store",
          credentials: "same-origin",
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(failureMessage(payload));
        const next = payload as HeadquartersComparisonResponse;
        setData(next);
        if (!customFrom || !customTo) {
          const lastSeven = next.availableBusinessDays.slice(-7);
          setCustomFrom(lastSeven[0]?.key ?? "");
          setCustomTo(lastSeven.at(-1)?.key ?? "");
        }
        setPreset(nextPreset);
      } catch (reason) {
        setError(
          reason instanceof Error && reason.name !== "TypeError"
            ? reason.message
            : "连锁经营事实暂时无法读取；请检查连接后重试当前范围。",
        );
      } finally {
        setLoading(false);
      }
    },
    [customFrom, customTo, data?.availableBusinessDays],
  );

  useEffect(() => {
    void load(preset, undefined, true);
  }, [refreshKey]);

  useEffect(() => {
    setMetric(page === "chain" ? "utilization" : "revenue");
    setStoreFilter("");
    setDrilldown(null);
    setAnomalyStore(null);
  }, [page]);

  function closeOverlay() {
    setDrilldown(null);
    setAnomalyStore(null);
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }

  async function openDrilldown(
    store: HeadquartersComparisonStoreResponse,
    selectedMetric: ComparisonMetric,
  ) {
    setError("");
    try {
      const range =
        selectedMetric === "inventory"
          ? {}
          : rangeFor(
              preset,
              data?.availableBusinessDays ?? [],
              customFrom,
              customTo,
            );
      const response = await fetch(
        dashboardUrl(
          range,
          store.store.storeId,
          metricDefinitions[selectedMetric].drilldown,
        ),
        { cache: "no-store", credentials: "same-origin" },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(failureMessage(payload));
      const result = payload as HeadquartersComparisonResponse;
      const selectedStore = result.stores[0];
      if (!selectedStore) throw new Error("没有找到当前固定门店下钻结果。");
      setDrilldown({ metric: selectedMetric, store: selectedStore });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "只读下钻暂时无法读取。",
      );
    }
  }

  const visibleStores = useMemo(
    () =>
      storeFilter
        ? (data?.stores.filter(
            (store) => store.store.storeId === storeFilter,
          ) ?? [])
        : (data?.stores ?? []),
    [data?.stores, storeFilter],
  );
  const definition = metricDefinitions[metric];
  const MetricIcon = definition.icon;
  const chartDays =
    preset === "current"
      ? (visibleStores[0]?.trend ?? [])
      : (visibleStores[0]?.days ?? []);
  const chartData = chartDays.map((day) => {
    const row: Record<string, number | string | null> = {
      day: dayLabel(day.key),
      key: day.key,
    };
    for (const store of visibleStores) {
      const storeDay = (preset === "current" ? store.trend : store.days).find(
        (candidate) => candidate.key === day.key,
      );
      row[store.store.code] = storeDay ? definition.readDay(storeDay) : null;
    }
    return row;
  });

  if (loading && !data) return <LoadingState />;
  if (!data) {
    return (
      <main className="hq-comparison-main">
        <section className="manager-dashboard-error" role="alert">
          <Warning weight="duotone" />
          <div>
            <span>三店经营事实读取失败</span>
            <h1>当前页面没有用预置数字替代服务端结果。</h1>
            <p>{error}</p>
            <button onClick={() => void load("current")} type="button">
              重新读取连锁看板
            </button>
          </div>
        </section>
      </main>
    );
  }

  const totalRevenue = data.stores.reduce(
    (total, store) => total + store.summary.revenue.totalCents,
    0,
  );
  const totalRepairs = data.stores.reduce(
    (total, store) => total + store.summary.repairs.openCount,
    0,
  );
  const totalLowStock = data.stores.reduce(
    (total, store) => total + store.summary.inventory.lowStockCount,
    0,
  );
  const lowStockStores = data.stores.filter(
    (store) => store.summary.inventory.lowStockCount > 0,
  ).length;
  const selectedRangeLabel =
    data.range.fromBusinessDay === data.range.toBusinessDay
      ? `${data.range.fromBusinessDay} 06:00–次日 05:59`
      : `${data.range.fromBusinessDay} 至 ${data.range.toBusinessDay}`;
  const customValid =
    customFrom.length > 0 && customTo.length > 0 && customFrom <= customTo;

  return (
    <main className="hq-comparison-main">
      <header className="manager-dashboard-title-row hq-comparison-title">
        <div>
          <span>竞枢连锁 · 总部运营只读经营视图</span>
          <h1>{page === "chain" ? "连锁看板" : "门店比较"}</h1>
          <p>
            经营日 {selectedRangeLabel} · 上海时间 · 数据截至{" "}
            {shanghaiTime(data.currentTime)} · 三店中性并列
          </p>
        </div>
        <div className="manager-dashboard-range" aria-label="总部经营日范围">
          <button
            className={preset === "current" ? "is-active" : ""}
            disabled={loading}
            onClick={() => void load("current")}
            type="button"
          >
            当前经营日
          </button>
          <button
            className={preset === "last7" ? "is-active" : ""}
            disabled={loading}
            onClick={() => void load("last7", undefined, true)}
            type="button"
          >
            最近 7 日
          </button>
          <button
            className={preset === "last14" ? "is-active" : ""}
            disabled={loading}
            onClick={() => void load("last14", undefined, true)}
            type="button"
          >
            最近 14 日
          </button>
          <details open={preset === "custom"}>
            <summary>
              <CalendarBlank /> 自定义
            </summary>
            <div>
              <label>
                起始经营日
                <select
                  onChange={(event) => setCustomFrom(event.target.value)}
                  value={customFrom}
                >
                  {data.availableBusinessDays.map((day) => (
                    <option key={day.key} value={day.key}>
                      {day.key}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                结束经营日
                <select
                  onChange={(event) => setCustomTo(event.target.value)}
                  value={customTo}
                >
                  {data.availableBusinessDays.map((day) => (
                    <option key={day.key} value={day.key}>
                      {day.key}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={!customValid || loading}
                onClick={() =>
                  void load("custom", { from: customFrom, to: customTo })
                }
                type="button"
              >
                应用范围
              </button>
            </div>
          </details>
        </div>
      </header>

      {error ? (
        <div className="manager-dashboard-inline-error" role="alert">
          <Warning />
          <span>{error}</span>
          <button onClick={() => void load(preset)} type="button">
            重试当前范围
          </button>
        </div>
      ) : null}

      {page === "chain" ? (
        <>
          <section className="hq-chain-summary" aria-label="连锁摘要">
            <article>
              <small>固定门店</small>
              <strong>{data.stores.length}</strong>
              <span>当前沙箱全部范围</span>
            </article>
            <article>
              <small>连锁模拟营业额</small>
              <strong>{formatMoney(totalRevenue)}</strong>
              <span>预约 + 商品 − 模拟退款</span>
            </article>
            <article className={totalRepairs > 0 ? "is-danger" : ""}>
              <small>未关闭报修</small>
              <strong>{totalRepairs}</strong>
              <span>总部只读下钻</span>
            </article>
            <article className={totalLowStock > 0 ? "is-warning" : ""}>
              <small>低库存门店</small>
              <strong>{lowStockStores}</strong>
              <span>共 {totalLowStock} 项告警</span>
            </article>
          </section>

          <section className="hq-store-pulse manager-dashboard-panel">
            <header>
              <span>
                <Buildings weight="duotone" />
              </span>
              <div>
                <small>固定顺序 · 无综合分</small>
                <h2>三店经营脉冲</h2>
              </div>
              <button onClick={onNavigateCompare} type="button">
                展开比较 <ArrowRight />
              </button>
            </header>
            <div className="hq-store-table-wrap">
              <table aria-label="三店核心经营指标">
                <thead>
                  <tr>
                    <th>门店</th>
                    <th>模拟营业额</th>
                    <th>运营座位利用率</th>
                    <th>维护不可用率</th>
                    <th>订单完成率</th>
                    <th>经营异常</th>
                    <th>只读下钻</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stores.map((store, index) => (
                    <tr key={store.store.storeId}>
                      <td>
                        <i
                          aria-hidden="true"
                          className={`hq-store-marker is-${index + 1}`}
                        />
                        <span>
                          <strong>{store.store.displayName}</strong>
                          <small>{store.store.code}</small>
                        </span>
                      </td>
                      <td>{formatMoney(store.summary.revenue.totalCents)}</td>
                      <td>
                        {formatRate(
                          store.summary.seats.operationalUtilizationBasisPoints,
                        )}
                      </td>
                      <td>
                        {formatRate(
                          store.summary.seats.maintenanceRateBasisPoints,
                        )}
                      </td>
                      <td>
                        {formatRate(
                          store.summary.orders.completionRateBasisPoints,
                        )}
                      </td>
                      <td>
                        <span
                          className={`hq-exception-pill${anomalyCount(store) > 0 ? " is-warning" : ""}`}
                        >
                          {anomalyCount(store)} 项
                        </span>
                      </td>
                      <td>
                        <button
                          aria-label={`查看 ${store.store.displayName} 经营异常`}
                          onClick={(event) => {
                            returnFocusRef.current = event.currentTarget;
                            setAnomalyStore(store);
                          }}
                          type="button"
                        >
                          查看 <ArrowRight />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="hq-compare-filter" aria-label="门店比较筛选">
          <label>
            指标
            <select
              aria-label="比较指标"
              onChange={(event) =>
                setMetric(event.target.value as ComparisonMetric)
              }
              value={metric}
            >
              {metricOrder.map((value) => (
                <option key={value} value={value}>
                  {metricDefinitions[value].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            门店
            <select
              aria-label="比较门店"
              onChange={(event) => setStoreFilter(event.target.value)}
              value={storeFilter}
            >
              <option value="">全部三店</option>
              {data.stores.map((store) => (
                <option key={store.store.storeId} value={store.store.storeId}>
                  {store.store.displayName}
                </option>
              ))}
            </select>
          </label>
          <div>
            <Info />
            <span>
              <strong>{definition.label}</strong>
              <small>{definition.definition}</small>
            </span>
          </div>
        </section>
      )}

      <section className="hq-comparison-grid">
        <article className="manager-dashboard-panel manager-dashboard-chart-panel">
          <header>
            <span>
              <MetricIcon weight="duotone" />
            </span>
            <div>
              <small>
                {metric === "inventory"
                  ? "当前快照 · 不回填历史"
                  : preset === "current"
                    ? "最近 7 个经营日趋势"
                    : "当前筛选范围"}
              </small>
              <h2>{definition.label}</h2>
            </div>
          </header>
          <p className="hq-chart-summary">
            文本摘要：
            {visibleStores
              .map(
                (store) =>
                  `${store.store.displayName} ${definition.format(definition.readSummary(store))}`,
              )
              .join("；")}
            。门店同时由名称、代码和图例标记区分。
          </p>
          <div className="manager-dashboard-chart hq-comparison-chart">
            <ResponsiveContainer
              height="100%"
              initialDimension={{ height: 260, width: 720 }}
              minHeight={0}
              minWidth={0}
              width="100%"
            >
              <LineChart
                data={chartData}
                margin={{ bottom: 0, left: -16, right: 12, top: 12 }}
              >
                <CartesianGrid
                  stroke="#1c3040"
                  strokeDasharray="3 6"
                  vertical={false}
                />
                <XAxis
                  axisLine={false}
                  dataKey="day"
                  fontSize={9}
                  stroke="#718392"
                  tickLine={false}
                />
                <YAxis
                  axisLine={false}
                  fontSize={9}
                  stroke="#718392"
                  tickFormatter={(value: number) => definition.format(value)}
                  tickLine={false}
                  width={68}
                />
                <Tooltip
                  formatter={(value) =>
                    value === null || value === undefined
                      ? "未生成历史快照"
                      : definition.format(Number(value))
                  }
                  labelFormatter={(label) => `经营日 ${label}`}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 10 }} />
                {visibleStores.map((store) => {
                  const sourceIndex = data.stores.findIndex(
                    (candidate) =>
                      candidate.store.storeId === store.store.storeId,
                  );
                  return (
                    <Line
                      dataKey={store.store.code}
                      connectNulls={false}
                      dot={{ r: 2 }}
                      key={store.store.storeId}
                      name={`${store.store.displayName} · ${store.store.code}`}
                      stroke={storeColors[sourceIndex] ?? "#9ab0bd"}
                      strokeWidth={2.4}
                      type="monotone"
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="manager-dashboard-panel hq-metric-summary">
          <header>
            <span>
              <Buildings weight="duotone" />
            </span>
            <div>
              <small>中性并列 · 固定顺序</small>
              <h2>指标摘要</h2>
            </div>
          </header>
          <div>
            {visibleStores.map((store, index) => (
              <button
                key={store.store.storeId}
                onClick={(event) => {
                  returnFocusRef.current = event.currentTarget;
                  void openDrilldown(store, metric);
                }}
                type="button"
              >
                <span>
                  <i
                    aria-hidden="true"
                    className={`hq-store-marker is-${data.stores.findIndex((candidate) => candidate.store.storeId === store.store.storeId) + 1}`}
                  />
                  <strong>{store.store.displayName}</strong>
                  <small>
                    {store.store.code} · 门店 {index + 1}
                  </small>
                </span>
                <b>{definition.format(definition.readSummary(store))}</b>
                <ArrowRight />
              </button>
            ))}
          </div>
          <p>
            <Info /> 不生成综合分、最佳门店、冠军色、利润或伪造 SLA。
          </p>
          {page === "chain" ? (
            <button
              className="hq-audit-entry"
              onClick={onNavigateAudit}
              type="button"
            >
              <FileCsv /> 全沙箱审计与导出 <ArrowRight />
            </button>
          ) : null}
        </article>
      </section>

      <section className="manager-dashboard-panel hq-accessible-table">
        <header>
          <span>
            <ChartLineUp weight="duotone" />
          </span>
          <div>
            <small>图表等价数据表</small>
            <h2>{definition.label}经营日明细</h2>
          </div>
        </header>
        <div>
          <table aria-label={`${definition.label}三店经营日数据`}>
            <thead>
              <tr>
                <th>经营日</th>
                {visibleStores.map((store) => (
                  <th key={store.store.storeId}>
                    {store.store.displayName}
                    <small>{store.store.code}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chartData.map((row) => (
                <tr key={String(row.key)}>
                  <th>{String(row.key)}</th>
                  {visibleStores.map((store) => (
                    <td key={store.store.storeId}>
                      {row[store.store.code] === null ||
                      row[store.store.code] === undefined
                        ? "未生成历史快照"
                        : definition.format(Number(row[store.store.code]))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {loading ? (
        <div className="manager-dashboard-refreshing" role="status">
          <ClockCounterClockwise /> 正在更新三店经营事实…
        </div>
      ) : null}
      {drilldown ? (
        <DrilldownPanel
          data={drilldown.store}
          metric={drilldown.metric}
          onClose={closeOverlay}
        />
      ) : null}
      {anomalyStore ? (
        <AnomalyPanel
          onClose={closeOverlay}
          onOpenMetric={(selectedMetric) => {
            setAnomalyStore(null);
            void openDrilldown(anomalyStore, selectedMetric);
          }}
          store={anomalyStore}
        />
      ) : null}
    </main>
  );
}
