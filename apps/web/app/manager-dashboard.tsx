"use client";

import {
  ArrowRight,
  CalendarBlank,
  ChartLineUp,
  CheckCircle,
  ClockCounterClockwise,
  Info,
  Package,
  Receipt,
  Seat,
  Warning,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Icon } from "@phosphor-icons/react";
import type {
  ApiErrorResponse,
  ManagerDashboardDrilldownKind,
  ManagerDashboardResponse,
} from "@jingshu/contracts";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type DashboardRangePreset = "current" | "custom" | "last7";

interface DashboardQuery {
  readonly from?: string;
  readonly to?: string;
}

interface ManagerDashboardProps {
  readonly onNavigateAudit: () => void;
  readonly onNavigateInventory: () => void;
  readonly onNavigatePeople: () => void;
  readonly onNavigateRepairs: () => void;
  readonly onNavigateReservations: () => void;
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

function formatMinutes(value: number | null) {
  if (value === null) return "暂无";
  if (value < 60) return `${value} 分`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分`;
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

function dayLabel(value: string) {
  return value.slice(5).replace("-", "/");
}

function failureMessage(payload: unknown) {
  const failure = payload as ApiErrorResponse | null;
  return (
    failure?.error?.message ??
    "经营看板暂时无法读取；请稍后重试，页面不会展示伪造数据。"
  );
}

function rangeQuery(
  preset: DashboardRangePreset,
  availableDays: ManagerDashboardResponse["availableBusinessDays"],
  customFrom: string,
  customTo: string,
): DashboardQuery {
  if (preset === "current") return {};
  if (preset === "last7") {
    const lastSeven = availableDays.slice(-7);
    const from = lastSeven[0]?.key;
    const to = lastSeven.at(-1)?.key;
    if (!from || !to) return {};
    return {
      from,
      to,
    };
  }
  return { from: customFrom, to: customTo };
}

function dashboardUrl(
  query: DashboardQuery,
  drilldown?: ManagerDashboardDrilldownKind,
) {
  const search = new URLSearchParams();
  if (query.from) search.set("from", query.from);
  if (query.to) search.set("to", query.to);
  if (drilldown) search.set("drilldown", drilldown);
  const suffix = search.toString();
  return `/api/v1/manager/dashboard${suffix ? `?${suffix}` : ""}`;
}

function Definition({ children }: { readonly children: string }) {
  return (
    <details className="manager-dashboard-definition">
      <summary>
        <Info /> 指标口径
      </summary>
      <p>{children}</p>
    </details>
  );
}

function MetricCard({
  definition,
  detail,
  icon: IconComponent,
  label,
  onOpen,
  tone = "default",
  value,
}: {
  readonly definition: string;
  readonly detail: string;
  readonly icon: Icon;
  readonly label: string;
  readonly onOpen: () => void;
  readonly tone?: "danger" | "default" | "good" | "warning";
  readonly value: string;
}) {
  return (
    <article className={`manager-dashboard-metric is-${tone}`}>
      <button onClick={onOpen} type="button">
        <span className="manager-dashboard-metric-icon">
          <IconComponent weight="duotone" />
        </span>
        <span>
          <small>{label}</small>
          <strong>{value}</strong>
          <em>{detail}</em>
        </span>
        <ArrowRight />
      </button>
      <Definition>{definition}</Definition>
    </article>
  );
}

function ChartTooltip({
  active,
  label,
  payload,
  unit,
}: {
  readonly active?: boolean;
  readonly label?: string;
  readonly payload?: ReadonlyArray<{
    readonly color?: string;
    readonly name?: string;
    readonly value?: number;
  }>;
  readonly unit: "money" | "percent";
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="manager-dashboard-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <span key={item.name}>
          <i style={{ backgroundColor: item.color }} />
          {item.name}：
          {unit === "money"
            ? formatMoney(item.value ?? 0)
            : `${Number(item.value ?? 0).toFixed(1)}%`}
        </span>
      ))}
    </div>
  );
}

function LoadingState() {
  return (
    <main className="manager-dashboard-main" aria-busy="true">
      <div className="manager-dashboard-loading" role="status">
        <ClockCounterClockwise weight="duotone" />
        <span>
          <strong>正在汇总当前门店经营事实</strong>
          <small>预约、订单、维修、考勤与交接仍按同一经营日读取。</small>
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

function ErrorState({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <main className="manager-dashboard-main">
      <section className="manager-dashboard-error" role="alert">
        <Warning weight="duotone" />
        <div>
          <span>经营事实读取失败</span>
          <h1>当前页面没有用预置数字替代服务端结果。</h1>
          <p>{message}</p>
          <button onClick={onRetry} type="button">
            重新读取经营看板
          </button>
        </div>
      </section>
    </main>
  );
}

function DrilldownPanel({
  data,
  kind,
  onClose,
  onNavigate,
}: {
  readonly data: ManagerDashboardResponse;
  readonly kind: ManagerDashboardDrilldownKind;
  readonly onClose: () => void;
  readonly onNavigate: () => void;
}) {
  const labels: Record<ManagerDashboardDrilldownKind, string> = {
    attendance: "考勤事实",
    evidence: "经营证据",
    handover: "交接异常",
    inventory: "低库存项目",
    orders: "商品订单",
    repairs: "报修记录",
    revenue: "模拟营业额构成",
    seats: "座位使用与维护记录",
  };
  const rows = data.drilldown?.rows ?? [];
  return (
    <aside
      aria-labelledby="manager-dashboard-drilldown-title"
      className="manager-dashboard-drilldown"
      role="dialog"
    >
      <header>
        <div>
          <small>
            {data.store.displayName} · {data.range.fromBusinessDay} 至{" "}
            {data.range.toBusinessDay}
          </small>
          <h2 id="manager-dashboard-drilldown-title">{labels[kind]}</h2>
        </div>
        <button aria-label="关闭指标下钻" onClick={onClose} type="button">
          <X />
        </button>
      </header>
      <div className="manager-dashboard-drilldown-body">
        {rows.length === 0 ? (
          <section className="manager-dashboard-empty">
            <CheckCircle weight="duotone" />
            <strong>当前范围没有对应记录</strong>
            <p>可调整经营日范围，或前往业务页面查看仍在处理的对象。</p>
          </section>
        ) : (
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
        )}
      </div>
      <footer>
        <span>下钻沿用当前门店与经营日范围。</span>
        <button onClick={onNavigate} type="button">
          前往业务页面 <ArrowRight />
        </button>
      </footer>
    </aside>
  );
}

export function ManagerDashboard({
  onNavigateAudit,
  onNavigateInventory,
  onNavigatePeople,
  onNavigateRepairs,
  onNavigateReservations,
  refreshKey,
}: ManagerDashboardProps) {
  const [data, setData] = useState<ManagerDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preset, setPreset] = useState<DashboardRangePreset>("current");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [drilldown, setDrilldown] =
    useState<ManagerDashboardDrilldownKind | null>(null);

  const load = useCallback(
    async (
      nextPreset: DashboardRangePreset,
      nextDrilldown?: ManagerDashboardDrilldownKind,
      customRange?: { readonly from: string; readonly to: string },
    ) => {
      setLoading(true);
      setError("");
      const available = data?.availableBusinessDays ?? [];
      const query = rangeQuery(
        nextPreset,
        available,
        customRange?.from ?? customFrom,
        customRange?.to ?? customTo,
      );
      try {
        const response = await fetch(dashboardUrl(query, nextDrilldown), {
          cache: "no-store",
          credentials: "same-origin",
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(failureMessage(payload));
        const next = payload as ManagerDashboardResponse;
        setData(next);
        if (!customFrom || !customTo) {
          const lastSeven = next.availableBusinessDays.slice(-7);
          setCustomFrom(lastSeven[0]?.key ?? "");
          setCustomTo(lastSeven.at(-1)?.key ?? "");
        }
        setPreset(nextPreset);
        setDrilldown(nextDrilldown ?? null);
      } catch (reason) {
        setError(
          reason instanceof Error && reason.name !== "TypeError"
            ? reason.message
            : "经营看板暂时无法读取；请检查连接后重试当前范围。",
        );
      } finally {
        setLoading(false);
      }
    },
    [customFrom, customTo, data?.availableBusinessDays],
  );

  useEffect(() => {
    void load(preset, drilldown ?? undefined);
  }, [refreshKey]);

  const chartDays = useMemo(
    () => (preset === "current" ? (data?.trend ?? []) : (data?.days ?? [])),
    [data, preset],
  );
  const chartData = chartDays.map((day) => ({
    day: dayLabel(day.key),
    maintenance: day.seats.maintenanceRateBasisPoints / 100,
    orders: day.revenue.orderCents / 100,
    reservation: day.revenue.reservationCents / 100,
    utilization: day.seats.operationalUtilizationBasisPoints / 100,
  }));

  if (loading && !data) return <LoadingState />;
  if (!data) {
    return <ErrorState message={error} onRetry={() => void load("current")} />;
  }

  const summary = data.summary;
  const attendanceExceptions =
    summary.attendance.absent + summary.attendance.late;
  const selectedRangeLabel =
    data.range.fromBusinessDay === data.range.toBusinessDay
      ? `${data.range.fromBusinessDay} 06:00–次日 05:59`
      : `${data.range.fromBusinessDay} 至 ${data.range.toBusinessDay}`;
  const customValid =
    customFrom.length > 0 && customTo.length > 0 && customFrom <= customTo;
  const navigateByKind: Record<ManagerDashboardDrilldownKind, () => void> = {
    attendance: onNavigatePeople,
    evidence: onNavigateAudit,
    handover: onNavigatePeople,
    inventory: onNavigateInventory,
    orders: onNavigateReservations,
    repairs: onNavigateRepairs,
    revenue: onNavigateReservations,
    seats: onNavigateReservations,
  };

  return (
    <main className="manager-dashboard-main">
      <header className="manager-dashboard-title-row">
        <div>
          <span>{data.store.displayName} · 店长视图</span>
          <h1>经营看板</h1>
          <p>
            经营日 {selectedRangeLabel} · 上海时间 · 数据截至{" "}
            {shanghaiTime(data.currentTime)}
          </p>
        </div>
        <div className="manager-dashboard-range" aria-label="经营日范围">
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
            onClick={() => void load("last7")}
            type="button"
          >
            最近 7 日
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
                  void load("custom", undefined, {
                    from: customFrom,
                    to: customTo,
                  })
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

      <section className="manager-dashboard-metrics" aria-label="核心经营指标">
        <MetricCard
          definition="仅计已完成预约与已完成商品订单，扣除模拟退款。预约最终金额按未退款半小时片段归属经营日；商品订单全部归属完成经营日。"
          detail={`预约 ${formatMoney(summary.revenue.reservationCents)} · 商品 ${formatMoney(summary.revenue.orderCents)}`}
          icon={ChartLineUp}
          label="模拟营业额"
          onOpen={() => void load(preset, "revenue")}
          tone="good"
          value={formatMoney(summary.revenue.totalCents)}
        />
        <MetricCard
          definition="运营座位利用率 = 使用分钟 / 正常可经营座位分钟；维护中的座位分钟不进入这个分母。"
          detail={`${summary.seats.usedMinutes.toLocaleString("zh-CN")} / ${summary.seats.normalSeatMinutes.toLocaleString("zh-CN")} 座位分钟`}
          icon={Seat}
          label="运营座位利用率"
          onOpen={() => void load(preset, "seats")}
          value={formatRate(summary.seats.operationalUtilizationBasisPoints)}
        />
        <MetricCard
          definition="维护不可用率 = 维修处理中维护分钟 / 营业座位分钟；它与运营利用率使用独立分母。"
          detail={`${formatMinutes(summary.seats.maintenanceMinutes)} / ${summary.seats.businessSeatMinutes.toLocaleString("zh-CN")} 座位分钟`}
          icon={Wrench}
          label="维护不可用率"
          onOpen={() => void load(preset, "seats")}
          tone={summary.seats.maintenanceMinutes > 0 ? "warning" : "good"}
          value={formatRate(summary.seats.maintenanceRateBasisPoints)}
        />
        <MetricCard
          definition="订单完成率只以已模拟支付且已进入完成或取消终态的订单为分母；未支付过期和仍在处理的订单均排除。"
          detail={`${summary.orders.completedCount} / ${summary.orders.eligibleTerminalCount} 个符合分母订单`}
          icon={Package}
          label="订单完成率"
          onOpen={() => void load(preset, "orders")}
          value={formatRate(summary.orders.completionRateBasisPoints)}
        />
      </section>

      <section className="manager-dashboard-primary-grid">
        <article className="manager-dashboard-panel manager-dashboard-chart-panel">
          <header>
            <span>
              <ChartLineUp weight="duotone" />
            </span>
            <div>
              <small>
                {preset === "current" ? "最近 7 个经营日趋势" : "当前筛选范围"}
              </small>
              <h2>模拟营业额构成</h2>
            </div>
            <Definition>
              图表与卡片使用同一最终模拟金额口径；当前经营日模式保留最近 7
              日趋势作为上下文。
            </Definition>
          </header>
          <div
            className="manager-dashboard-chart"
            aria-label="模拟营业额构成图"
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={0}
              initialDimension={{ width: 1, height: 1 }}
            >
              <AreaChart
                data={chartData}
                margin={{ bottom: 0, left: -18, right: 10, top: 12 }}
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
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltip unit="money" />} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 10 }} />
                <Area
                  dataKey="reservation"
                  fill="#163548"
                  fillOpacity={0.72}
                  name="预约"
                  stroke="#59d8ff"
                  strokeWidth={2}
                  type="monotone"
                />
                <Area
                  dataKey="orders"
                  fill="#243829"
                  fillOpacity={0.68}
                  name="商品订单"
                  stroke="#b8f34a"
                  strokeWidth={2}
                  type="monotone"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="manager-dashboard-panel manager-dashboard-chart-panel">
          <header>
            <span>
              <Seat weight="duotone" />
            </span>
            <div>
              <small>独立分母 · 不合并评分</small>
              <h2>双座位指标</h2>
            </div>
            <button onClick={() => void load(preset, "seats")} type="button">
              查看构成 <ArrowRight />
            </button>
          </header>
          <div className="manager-dashboard-dual-head">
            <div>
              <span>运营利用率</span>
              <strong>
                {formatRate(summary.seats.operationalUtilizationBasisPoints)}
              </strong>
              <small>使用 / 正常可经营</small>
            </div>
            <div>
              <span>维护不可用率</span>
              <strong>
                {formatRate(summary.seats.maintenanceRateBasisPoints)}
              </strong>
              <small>维护 / 营业座位</small>
            </div>
          </div>
          <div
            className="manager-dashboard-chart is-compact"
            aria-label="双座位指标趋势图"
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={0}
              initialDimension={{ width: 1, height: 1 }}
            >
              <LineChart
                data={chartData}
                margin={{ bottom: 0, left: -20, right: 10, top: 10 }}
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
                  domain={[0, 100]}
                  fontSize={9}
                  stroke="#718392"
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltip unit="percent" />} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 10 }} />
                <Line
                  dataKey="utilization"
                  dot={false}
                  name="运营利用率"
                  stroke="#b8f34a"
                  strokeWidth={2.2}
                  type="monotone"
                />
                <Line
                  dataKey="maintenance"
                  dot={false}
                  name="维护不可用率"
                  stroke="#f2a62b"
                  strokeWidth={2.2}
                  type="monotone"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="manager-dashboard-secondary-grid">
        <article className="manager-dashboard-panel">
          <header>
            <span>
              <Package weight="duotone" />
            </span>
            <div>
              <small>分开呈现处理与损耗</small>
              <h2>订单与维修</h2>
            </div>
          </header>
          <dl className="manager-dashboard-facts">
            <div>
              <dt>订单积压</dt>
              <dd>
                {summary.orders.backlogCount}
                <small>仍在处理，不进入完成率分母</small>
              </dd>
            </div>
            <div>
              <dt>订单损耗</dt>
              <dd>
                {summary.orders.wasteQuantity} 件
                <small>
                  {formatMoney(summary.orders.wasteCents)} · 不计营业额
                </small>
              </dd>
            </div>
            <div>
              <dt>维修中位处理时长</dt>
              <dd>
                {formatMinutes(summary.repairs.medianResolutionMinutes)}
                <small>已关闭报修：新建到关闭</small>
              </dd>
            </div>
            <div>
              <dt>维护分钟</dt>
              <dd>
                {formatMinutes(summary.repairs.maintenanceMinutes)}
                <small>维修进入处理至关闭或当前时点</small>
              </dd>
            </div>
            <div>
              <dt>未关闭报修</dt>
              <dd>
                {summary.repairs.openCount} 单
                <small>
                  紧急 {summary.repairs.openByPriority.urgent} · 高{" "}
                  {summary.repairs.openByPriority.high} · 普通{" "}
                  {summary.repairs.openByPriority.normal}
                </small>
              </dd>
            </div>
            <div>
              <dt>考勤事实</dt>
              <dd>
                {attendanceExceptions} 人次异常
                <small>
                  准时 {summary.attendance.onTime} · 迟到{" "}
                  {summary.attendance.late} · 缺勤 {summary.attendance.absent}
                </small>
              </dd>
            </div>
          </dl>
        </article>

        <article className="manager-dashboard-panel">
          <header>
            <span>
              <Warning weight="duotone" />
            </span>
            <div>
              <small>直接业务事实</small>
              <h2>人员与库存异常</h2>
            </div>
          </header>
          <div className="manager-dashboard-issues">
            <button onClick={() => void load(preset, "handover")} type="button">
              <span
                className={
                  summary.handoverExceptionCount > 0 ? "is-warning" : "is-good"
                }
              >
                交接
              </span>
              <strong>{summary.handoverExceptionCount} 项异常</strong>
              <ArrowRight />
            </button>
            <button
              onClick={() => void load(preset, "inventory")}
              type="button"
            >
              <span
                className={
                  summary.inventory.lowStockCount > 0 ? "is-danger" : "is-good"
                }
              >
                库存
              </span>
              <strong>{summary.inventory.lowStockCount} 项低于阈值</strong>
              <ArrowRight />
            </button>
            <button
              onClick={() => void load(preset, "attendance")}
              type="button"
            >
              <span
                className={attendanceExceptions > 0 ? "is-warning" : "is-good"}
              >
                考勤
              </span>
              <strong>{attendanceExceptions} 人次迟到或缺勤</strong>
              <ArrowRight />
            </button>
            <button onClick={() => void load(preset, "repairs")} type="button">
              <span
                className={
                  summary.repairs.openCount > 0 ? "is-danger" : "is-good"
                }
              >
                报修
              </span>
              <strong>{summary.repairs.openCount} 单未关闭报修</strong>
              <ArrowRight />
            </button>
          </div>
        </article>

        <article className="manager-dashboard-panel">
          <header>
            <span>
              <Receipt weight="duotone" />
            </span>
            <div>
              <small>同一经营日证据</small>
              <h2>最近经营记录</h2>
            </div>
            <button onClick={() => void load(preset, "evidence")} type="button">
              全部 <ArrowRight />
            </button>
          </header>
          {data.recentEvidence.length === 0 ? (
            <div className="manager-dashboard-compact-empty">
              <span>当前范围暂无经营事件。</span>
              <button
                onClick={() => {
                  const nextPreset = preset === "current" ? preset : "current";
                  setPreset(nextPreset);
                  void load(nextPreset);
                }}
                type="button"
              >
                {preset === "current" ? "重新读取" : "返回当前经营日"}
              </button>
            </div>
          ) : (
            <ol className="manager-dashboard-evidence">
              {data.recentEvidence.slice(0, 4).map((item) => (
                <li key={`${item.objectType}-${item.objectId}`}>
                  <time>{shanghaiTime(item.occurredAt)}</time>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </article>
      </section>

      {drilldown && data.drilldown ? (
        <DrilldownPanel
          data={data}
          kind={drilldown}
          onClose={() => setDrilldown(null)}
          onNavigate={navigateByKind[drilldown]}
        />
      ) : null}
    </main>
  );
}
