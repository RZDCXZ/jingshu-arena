import { useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  Legend,
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Archive,
  ArrowRight,
  Buildings,
  CalendarBlank,
  ChartLineUp,
  Clock,
  DownloadSimple,
  FileCsv,
  PencilSimple,
  Plus,
  Receipt,
  Seat,
  Storefront,
  UserMinus,
  UsersThree,
  WarningCircle,
  Wrench,
} from "@phosphor-icons/react";
import {
  auditEvents,
  dailyTrend,
  employees,
  pricePlans,
  revenueTrend,
  storeMetrics,
} from "./data.js";
import {
  Button,
  ChartTooltip,
  DataTable,
  Definition,
  FilterBar,
  InlineNotice,
  MetricCard,
  SectionHeading,
  Select,
  StatusPill,
  Surface,
  Tabs,
  Timeline,
} from "./ui.jsx";

export function StoreDashboard({ navigate }) {
  return (
    <div className="view-shell">
      <main className="page-main standard-page wide-page dashboard-page">
        <div className="page-title-row">
          <div>
            <span className="eyebrow">棱镜旗舰店 · 店长视图</span>
            <h1>经营看板</h1>
            <p>经营日 08月08日 06:00–次日05:59 · 上海时间</p>
          </div>
          <div className="action-cluster">
            <Select label="经营日范围" value="当前经营日">
              <option>当前经营日</option>
              <option>最近 7 个经营日</option>
              <option>自定义范围</option>
            </Select>
            <Button
              tone="secondary"
              icon={DownloadSimple}
              onClick={() => navigate("store-audit")}
            >
              导出当前视图
            </Button>
          </div>
        </div>
        <div className="metrics-grid">
          {storeMetrics.map((metric) => (
            <MetricCard
              key={metric.label}
              {...metric}
              onClick={() =>
                navigate(
                  metric.label.includes("库存")
                    ? "manager-inventory"
                    : "live-ops",
                )
              }
            />
          ))}
        </div>
        <div className="dashboard-grid dashboard-grid-primary">
          <Surface className="chart-surface">
            <SectionHeading
              title="模拟营业额构成"
              icon={ChartLineUp}
              action={
                <Definition label="指标定义">
                  已完成预约与已完成商品订单扣除模拟退款后的最终模拟金额。预约金额按未退款的半小时片段归属经营日。
                </Definition>
              }
            />
            <div className="chart-frame">
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
                minHeight={0}
                initialDimension={{ width: 560, height: 250 }}
              >
                <AreaChart
                  data={revenueTrend}
                  margin={{ top: 16, right: 12, bottom: 4, left: -14 }}
                >
                  <CartesianGrid
                    stroke="#1c3040"
                    strokeDasharray="3 6"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="time"
                    stroke="#718392"
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                  />
                  <YAxis
                    stroke="#718392"
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip formatter={(value) => `¥${value}`} />
                    }
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    type="monotone"
                    dataKey="reservation"
                    name="预约"
                    stroke="#59d8ff"
                    fill="#163548"
                    fillOpacity={0.72}
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="product"
                    name="商品订单"
                    stroke="#b8f34a"
                    fill="#243829"
                    fillOpacity={0.68}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Surface>
          <Surface className="chart-surface">
            <SectionHeading
              title="双座位指标"
              icon={Seat}
              action={
                <Button tone="ghost" onClick={() => navigate("live-ops")}>
                  查看构成记录 <ArrowRight />
                </Button>
              }
            />
            <div className="dual-metric-head">
              <div>
                <span>运营座位利用率</span>
                <strong>84.2%</strong>
                <small>使用分钟 / 正常可经营座位分钟</small>
              </div>
              <div>
                <span>维护不可用率</span>
                <strong>3.8%</strong>
                <small>维护分钟 / 营业座位分钟</small>
              </div>
            </div>
            <div className="chart-frame compact-chart">
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
                minHeight={0}
                initialDimension={{ width: 560, height: 152 }}
              >
                <LineChart
                  data={dailyTrend}
                  margin={{ top: 12, right: 12, bottom: 0, left: -20 }}
                >
                  <CartesianGrid
                    stroke="#1c3040"
                    strokeDasharray="3 6"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="day"
                    stroke="#718392"
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                  />
                  <YAxis
                    stroke="#718392"
                    tickLine={false}
                    axisLine={false}
                    domain={[0, 100]}
                    fontSize={11}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip formatter={(value) => `${value}%`} />
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="flagship"
                    name="运营利用率"
                    stroke="#b8f34a"
                    strokeWidth={2.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Surface>
        </div>
        <div className="dashboard-grid dashboard-grid-secondary">
          <Surface>
            <SectionHeading title="经营异常" icon={WarningCircle} count={7} />
            <div className="issue-list">
              <button onClick={() => navigate("live-ops")}>
                <StatusPill tone="danger">紧急</StatusPill>
                <span>
                  <strong>A-18 耳机右声道无声</strong>
                  <small>报修待分派 · 2 分钟</small>
                </span>
                <ArrowRight />
              </button>
              <button onClick={() => navigate("manager-inventory")}>
                <StatusPill tone="warning">低库存</StatusPill>
                <span>
                  <strong>3 项库存低于阈值</strong>
                  <small>替换耳机可用 2 · 阈值 3</small>
                </span>
                <ArrowRight />
              </button>
              <button onClick={() => navigate("people-schedule")}>
                <StatusPill tone="warning">交接</StatusPill>
                <span>
                  <strong>1 项交接待提交</strong>
                  <small>周宁 · 18:00–02:00</small>
                </span>
                <ArrowRight />
              </button>
            </div>
          </Surface>
          <Surface>
            <SectionHeading title="订单与报修" icon={Wrench} />
            <div className="ops-facts">
              <div>
                <span>商品订单积压</span>
                <strong>7</strong>
                <small>已模拟支付 4 · 制作中 2 · 待取 1</small>
              </div>
              <div>
                <span>订单完成率</span>
                <strong>92.6%</strong>
                <small>不含仍在处理的订单</small>
              </div>
              <div>
                <span>报修中位处理时长</span>
                <strong>18 分</strong>
                <small>已关闭报修从新建到关闭</small>
              </div>
              <div>
                <span>订单损耗</span>
                <strong>2 件</strong>
                <small>¥26.00 · 不计入模拟营业额</small>
              </div>
            </div>
          </Surface>
          <Surface className="dashboard-evidence">
            <SectionHeading
              title="最近经营证据"
              icon={Receipt}
              action={
                <Button
                  tone="ghost"
                  trailing={ArrowRight}
                  onClick={() => navigate("store-audit")}
                >
                  全部审计
                </Button>
              }
            />
            <Timeline
              compact
              items={[
                { time: "19:22", title: "报修已分派", meta: "周宁 · A-18" },
                {
                  time: "19:18",
                  title: "商品订单模拟支付",
                  meta: "林澈 · ¥16.00",
                },
                { time: "19:12", title: "预约已确认", meta: "林澈 · A-18" },
              ]}
            />
          </Surface>
        </div>
      </main>
    </div>
  );
}

export function StoreConfigPage({ onAction, readonly }) {
  const [tab, setTab] = useState("profile");
  const seatRows = [
    {
      id: "A-18",
      area: "竞技区",
      profile: "竞技型",
      state: "正常",
      upcoming: "2 条有效预约",
      repair: "1 条未关闭报修",
    },
    {
      id: "A-19",
      area: "竞技区",
      profile: "竞技型",
      state: "正常",
      upcoming: "1 条有效预约",
      repair: "—",
    },
    {
      id: "B-07",
      area: "竞技区",
      profile: "竞技型",
      state: "正常",
      upcoming: "3 条有效预约",
      repair: "—",
    },
    {
      id: "F-06",
      area: "旗舰区",
      profile: "旗舰型",
      state: "维护中",
      upcoming: "0",
      repair: "处理中",
    },
  ];
  const productRows = [
    {
      category: "饮品",
      code: "cloud-mineral-water",
      name: "云端矿泉水",
      price: "¥6.50",
      listed: "已下架",
      threshold: 11,
      available: 12,
    },
    {
      category: "零食",
      code: "polyline-chips",
      name: "折线薯片",
      price: "¥8.00",
      listed: "已上架",
      threshold: 10,
      available: 21,
    },
    {
      category: "外设用品",
      code: "peripheral-clean-kit",
      name: "外设清洁套装",
      price: "¥18.00",
      listed: "已上架",
      threshold: 5,
      available: 3,
    },
  ];
  const createAction =
    tab === "profile"
      ? {
          kind: "manager-business-hours",
          mode: "create",
          label: "创建未来营业规则",
        }
      : tab === "seats"
        ? {
            kind: "manager-seat",
            mode: "create",
            label: "创建座位",
          }
        : tab === "pricing"
          ? {
              kind: "manager-price",
              mode: "create",
              label: "创建价格版本",
            }
          : null;
  const createActionLabel =
    tab === "profile"
      ? "新建规则"
      : tab === "seats"
        ? "新建座位"
        : tab === "pricing"
          ? "新建版本"
          : "";

  return (
    <div className="view-shell">
      <main className="page-main standard-page wide-page">
        <div className="page-title-row">
          <div>
            <span className="eyebrow">棱镜旗舰店 · 未来业务配置</span>
            <h1>门店配置</h1>
            <p>
              被业务引用的配置只能归档或停用；保存后不追溯修改历史预约与价格快照。
            </p>
          </div>
          {createAction ? (
            <Button
              tone="primary"
              icon={Plus}
              disabled={readonly}
              onClick={() => onAction(createAction)}
            >
              {createActionLabel}
            </Button>
          ) : null}
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            ["profile", "基本资料"],
            ["seats", "区域与座位"],
            ["pricing", "价格计划"],
            ["products", "门店商品"],
          ]}
        />
        {tab === "profile" && (
          <div className="split-layout config-profile">
            <Surface>
              <SectionHeading title="门店展示资料" icon={Storefront} />
              <div className="form-grid">
                <label className="field">
                  <span>门店工作名称</span>
                  <input defaultValue="棱镜旗舰店" />
                </label>
                <label className="field">
                  <span>虚构城市</span>
                  <input defaultValue="栖光市（虚构）" />
                </label>
                <label className="field field-full">
                  <span>演示介绍</span>
                  <textarea defaultValue="96 座、24 小时运营的主演示门店，用于展示跨角色预约、订单与维修联动。" />
                </label>
              </div>
              <Button
                tone="primary"
                disabled={readonly}
                onClick={() =>
                  onAction({
                    kind: "manager-store-profile",
                    label: "保存门店资料",
                    name: "棱镜旗舰店",
                    city: "栖光市（虚构）",
                    description:
                      "96 座、24 小时运营的主演示门店，用于展示跨角色预约、订单与维修联动。",
                  })
                }
              >
                保存资料
              </Button>
            </Surface>
            <Surface>
              <SectionHeading title="营业时间" icon={Clock} />
              <div className="hours-list">
                {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map(
                  (day) => (
                    <div key={day}>
                      <span>{day}</span>
                      <strong>00:00–24:00</strong>
                      <StatusPill tone="success">营业</StatusPill>
                    </div>
                  ),
                )}
              </div>
              <InlineNotice title="经营日边界" tone="info">
                营业统计统一以 06:00 为经营日开始，不等同于自然日。
              </InlineNotice>
            </Surface>
          </div>
        )}
        {tab === "seats" && (
          <Surface className="table-surface section-gap">
            <DataTable
              columns={[
                {
                  key: "id",
                  label: "座位编号",
                  render: (row) => <strong>{row.id}</strong>,
                },
                { key: "area", label: "区域" },
                { key: "profile", label: "机型档案" },
                {
                  key: "state",
                  label: "运营状态",
                  render: (row) => <StatusPill>{row.state}</StatusPill>,
                },
                { key: "upcoming", label: "有效预约依赖" },
                { key: "repair", label: "报修依赖" },
                {
                  key: "action",
                  label: "操作",
                  render: (row) => (
                    <Button
                      tone="ghost"
                      icon={PencilSimple}
                      disabled={readonly}
                      onClick={() =>
                        onAction({
                          kind: "manager-seat",
                          mode: "edit",
                          label: `编辑座位 ${row.id}`,
                          ...row,
                        })
                      }
                    >
                      编辑
                    </Button>
                  ),
                },
              ]}
              rows={seatRows}
              rowKey="id"
            />
          </Surface>
        )}
        {tab === "pricing" && (
          <>
            <InlineNotice title="新价格使用未来版本" tone="info">
              创建新版本时将检查适用范围重叠；已有预约继续使用创建时保存的价格快照。
            </InlineNotice>
            <Surface className="table-surface">
              <DataTable
                columns={[
                  { key: "storeArea", label: "门店 / 区域" },
                  { key: "profile", label: "总部机型" },
                  { key: "time", label: "时段" },
                  { key: "weekdayPrice", label: "工作日 / 半小时" },
                  { key: "weekendPrice", label: "周末 / 半小时" },
                  { key: "effective", label: "有效期" },
                  {
                    key: "version",
                    label: "版本",
                    render: (row) => <StatusPill>{row.version}</StatusPill>,
                  },
                  {
                    key: "action",
                    label: "操作",
                    render: (row) =>
                      row.version.includes("未来") ? (
                        <Button
                          tone="ghost"
                          icon={Archive}
                          disabled={readonly}
                          onClick={() =>
                            onAction({
                              kind: "manager-price",
                              mode: "archive",
                              label: `归档 ${row.version}`,
                              ...row,
                            })
                          }
                        >
                          归档
                        </Button>
                      ) : (
                        <span className="muted-copy">只读</span>
                      ),
                  },
                ]}
                rows={pricePlans}
                rowKey="id"
              />
            </Surface>
          </>
        )}
        {tab === "products" && (
          <Surface className="table-surface">
            <DataTable
              columns={[
                  {
                    key: "name",
                    label: "商品资料",
                    render: (row) => (
                      <span>
                        <strong>{row.name}</strong>
                        <small>{row.code}</small>
                      </span>
                    ),
                  },
                { key: "category", label: "总部分类" },
                { key: "price", label: "本店售价" },
                {
                  key: "listed",
                  label: "销售状态",
                  render: (row) => <StatusPill>{row.listed}</StatusPill>,
                },
                { key: "threshold", label: "低库存阈值" },
                { key: "available", label: "当前可用" },
                {
                  key: "action",
                  label: "操作",
                  render: (row) => (
                    <Button
                      tone="ghost"
                      icon={PencilSimple}
                      disabled={readonly}
                      onClick={() =>
                        onAction({
                          kind: "manager-store-product",
                          mode: "edit",
                          label: `配置 ${row.name}`,
                          ...row,
                        })
                      }
                    >
                      配置
                    </Button>
                  ),
                },
              ]}
              rows={productRows}
              rowKey="name"
            />
          </Surface>
        )}
      </main>
    </div>
  );
}

export function PeopleSchedulePage({ onAction, readonly }) {
  const [tab, setTab] = useState("employees");
  const handoverExceptions = [
    {
      id: "submission-overdue",
      label: "逾期未提交",
      tone: "danger",
      employee: "背景员工 07",
      summary: "02:30 仍未提交 · 班次 18:00–02:00",
      snapshot: false,
    },
    {
      id: "late-submission",
      label: "迟交",
      tone: "warning",
      employee: "周宁 · 虚构人物",
      summary: "02:32 提交 · 晚于计划结束 32 分钟",
      snapshot: true,
    },
    {
      id: "confirmation-overdue",
      label: "长期未确认",
      tone: "warning",
      employee: "苏雨",
      summary: "02:30 仍未确认 · 与考勤分别解释",
      snapshot: true,
    },
  ];
  const [selectedHandoverException, setSelectedHandoverException] = useState(
    handoverExceptions[1],
  );
  const employeeColumns = [
    {
      key: "name",
      label: "工作名 / 员工编号",
      render: (row) => (
        <span className="employee-identity">
          <strong>{row.name} · 虚构人物</strong>
          <small>{row.code}</small>
        </span>
      ),
    },
    {
      key: "role",
      label: "角色",
      render: (row) => <StatusPill tone="neutral">{row.role}</StatusPill>,
    },
    {
      key: "status",
      label: "任职状态",
      render: (row) => <StatusPill tone="success">{row.status}</StatusPill>,
    },
    { key: "store", label: "所属门店" },
    {
      key: "protected",
      label: "人物保护",
      render: (row) =>
        row.protected ? (
          <span className="protected-label">受保护演示人物</span>
        ) : (
          "背景员工"
        ),
    },
    {
      key: "actions",
      label: "操作",
      render: (row) => (
        <div className="table-actions">
          <Button
            tone="ghost"
            icon={PencilSimple}
            disabled={readonly || row.protected}
            onClick={() =>
              onAction({
                kind: "manager-employee",
                mode: "edit",
                label: `编辑 ${row.name}`,
                ...row,
              })
            }
          >
            编辑
          </Button>
          <Button
            tone="ghost"
            icon={UserMinus}
            disabled={readonly || row.protected}
            onClick={() =>
              onAction({
                kind: "manager-employee",
                mode: "deactivate",
                label: `停用 ${row.name}`,
                ...row,
                dependencies:
                  row.name === "陈昊"
                    ? "未来班次 1 · 未关闭报修分派 1"
                    : "无当前/未来班次或未关闭报修分派",
              })
            }
          >
            停用
          </Button>
        </div>
      ),
    },
  ];
  const primaryAction =
    tab === "employees"
      ? {
          kind: "manager-employee",
          mode: "create",
          label: "创建背景员工",
        }
      : tab === "schedule"
        ? {
            kind: "manager-shift",
            mode: "create",
            label: "创建未来班次",
          }
        : {
            kind: "attendance-correction",
            mode: "create",
            label: "追加考勤更正",
          };
  const primaryActionLabel =
    tab === "employees"
      ? "新建员工"
      : tab === "schedule"
        ? "新建班次"
        : "追加考勤更正";

  return (
    <div className="view-shell">
      <main className="page-main standard-page wide-page">
        <div className="page-title-row">
          <div>
            <span className="eyebrow">棱镜旗舰店 · 固定所属门店</span>
            <h1>员工与排班</h1>
            <p>员工不跨店任职；覆盖不足可以保存，但会形成明确经营告警。</p>
          </div>
          <Button
            tone="primary"
            icon={Plus}
            disabled={readonly}
            onClick={() => onAction(primaryAction)}
          >
            {primaryActionLabel}
          </Button>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            ["employees", "员工", 16],
            ["schedule", "排班"],
            ["attendance", "考勤与交接异常", 5],
          ]}
        />
        {tab === "employees" && (
          <Surface className="table-surface section-gap">
            <DataTable
              columns={employeeColumns}
              rows={employees}
              rowKey="name"
            />
          </Surface>
        )}
        {tab === "schedule" && (
          <>
            <InlineNotice
              className="schedule-coverage-notice"
              tone="warning"
              title="08月09日 00:00–02:00 覆盖不足"
            >
              当前只有 2 名店员，建议至少 3 名；这是一项可保存的经营告警。
            </InlineNotice>
            <Surface className="schedule-surface">
              <SectionHeading
                title="半小时排班网格"
                icon={CalendarBlank}
                action={
                  <Select label="日期" value="08月08日（周六）">
                    <option>08月08日（周六）</option>
                    <option>08月09日（周日）</option>
                  </Select>
                }
              />
              <div className="schedule-grid">
                <div className="schedule-axis">
                  <span>员工</span>
                  {[
                    "14:00",
                    "16:00",
                    "18:00",
                    "20:00",
                    "22:00",
                    "次日00:00",
                    "02:00",
                  ].map((time) => (
                    <time key={time}>{time}</time>
                  ))}
                </div>
                {employees.slice(0, 5).map((employee, index) => (
                  <div className="schedule-row" key={employee.name}>
                    <strong>
                      {employee.name}
                      <small>{employee.role}</small>
                    </strong>
                    <div className="schedule-track">
                      <button
                        type="button"
                        className={`shift-block shift-${index + 1}`}
                        title={employee.shift}
                        disabled={readonly || index === 0}
                        onClick={() =>
                          onAction({
                            kind: "manager-shift",
                            mode: "edit",
                            label: `编辑 ${employee.name} 的未来班次`,
                            employee: employee.name,
                            window: employee.shift,
                          })
                        }
                      >
                        {employee.shift}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Surface>
          </>
        )}
        {tab === "attendance" && (
          <div className="split-layout">
            <Surface>
              <SectionHeading title="考勤异常" icon={WarningCircle} count={2} />
              <div className="issue-list">
                <button
                  onClick={() =>
                    onAction({
                      kind: "attendance-correction",
                      label: "更正苏雨的迟到记录",
                      employee: "苏雨",
                      original: "2026-08-08 16:12 签到 · 原班次 16:00",
                    })
                  }
                >
                  <StatusPill tone="warning">迟到</StatusPill>
                  <span>
                    <strong>苏雨 · 迟到 12 分钟</strong>
                    <small>原始签到 16:12 · 班次 16:00</small>
                  </span>
                  <ArrowRight />
                </button>
                <button
                  onClick={() =>
                    onAction({
                      kind: "absence-record",
                      label: "查看缺勤记录",
                      employee: "背景员工 07",
                    })
                  }
                >
                  <StatusPill tone="danger">缺勤</StatusPill>
                  <span>
                    <strong>背景员工 07 · 未模拟签到</strong>
                    <small>班次开始后已超过签到窗口</small>
                  </span>
                  <ArrowRight />
                </button>
              </div>
            </Surface>
            <Surface className="manager-handover-prototype">
              <SectionHeading title="交接异常" icon={UsersThree} count={3} />
              <p className="surface-intro">
                仅本店只读；交接异常独立于考勤，不生成综合评分。
              </p>
              <div className="issue-list manager-handover-prototype-list">
                {handoverExceptions.map((exception) => (
                  <button
                    className={
                      selectedHandoverException.id === exception.id
                        ? "is-selected"
                        : ""
                    }
                    key={exception.id}
                    onClick={() => setSelectedHandoverException(exception)}
                  >
                    <StatusPill tone={exception.tone}>
                      {exception.label}
                    </StatusPill>
                    <span>
                      <strong>{exception.employee}</strong>
                      <small>{exception.summary}</small>
                    </span>
                    <ArrowRight />
                  </button>
                ))}
              </div>
              <div className="manager-handover-prototype-detail">
                <span className="eyebrow">只读原始证据</span>
                <h3>
                  {selectedHandoverException.employee} · {" "}
                  {selectedHandoverException.label}
                </h3>
                {selectedHandoverException.snapshot ? (
                  <>
                    <div className="snapshot-grid">
                      <div>
                        <span>未完成预约</span>
                        <strong>5</strong>
                      </div>
                      <div>
                        <span>商品订单</span>
                        <strong>4</strong>
                      </div>
                      <div>
                        <span>报修</span>
                        <strong>3</strong>
                      </div>
                      <div>
                        <span>库存告警</span>
                        <strong>3</strong>
                      </div>
                    </div>
                    <dl className="detail-list">
                      <div>
                        <dt>交班提交</dt>
                        <dd>业务时间 02:32 · 周宁</dd>
                      </div>
                      <div>
                        <dt>真实服务器记录</dt>
                        <dd>02:32:02 · 原始事实不可编辑</dd>
                      </div>
                    </dl>
                    <InlineNotice tone="info" title="冻结补充说明">
                      A-18 报修待分派；晚高峰到店窗口集中。
                    </InlineNotice>
                    <Button
                      tone="ghost"
                      onClick={() =>
                        onAction({
                          kind: "handover-snapshot",
                          label: `查看 ${selectedHandoverException.employee} 的交接快照`,
                        })
                      }
                    >
                      查看专用快照弹窗
                    </Button>
                  </>
                ) : (
                  <InlineNotice tone="warning" title="逾期时尚未形成快照">
                    若随后迟交，将以独立的迟交异常保留冻结快照。
                  </InlineNotice>
                )}
              </div>
              <InlineNotice title="事实只追加" tone="info">
                交接提交与确认保持只读；本页不提供更正或审批动作。
              </InlineNotice>
            </Surface>
          </div>
        )}
      </main>
    </div>
  );
}

export function AuditPage({ hq = false, onExport }) {
  const [selected, setSelected] = useState(auditEvents[0]);
  const [result, setResult] = useState("全部结果");
  const rows = auditEvents.filter(
    (event) => result === "全部结果" || event.result === result,
  );
  const columns = [
    { key: "time", label: "业务时间" },
    {
      key: "persona",
      label: "演示人物",
      render: (row) => <strong>{row.persona}</strong>,
    },
    { key: "role", label: "角色" },
    { key: "store", label: "门店" },
    { key: "action", label: "动作" },
    {
      key: "object",
      label: "对象",
      render: (row) => <span className="mono">{row.object}</span>,
    },
    {
      key: "result",
      label: "结果",
      render: (row) => <StatusPill>{row.result}</StatusPill>,
    },
  ];

  return (
    <div className="view-shell has-inspector">
      <main className="page-main standard-page">
        <div className="page-title-row">
          <div>
            <span className="eyebrow">
              {hq ? "当前沙箱 · 全部三店" : "棱镜旗舰店 · 本店范围"}
            </span>
            <h1>审计与导出</h1>
            <p>
              审计事件只追加，保留业务发生时间、服务器记录时间与安全过滤后的差异。
            </p>
          </div>
          <Button tone="primary" icon={FileCsv} onClick={onExport}>
            导出 CSV
          </Button>
        </div>
        <FilterBar placeholder="搜索动作、人物、对象或请求关联 ID">
          <Select label="结果" value={result} onChange={setResult}>
            <option>全部结果</option>
            <option>允许</option>
            <option>拒绝</option>
          </Select>
          <Select label="角色" value="全部角色">
            <option>全部角色</option>
            <option>店员</option>
            <option>店长</option>
            <option>总部运营</option>
          </Select>
          <Select label="门店" value={hq ? "全部三店" : "棱镜旗舰店"}>
            <option>{hq ? "全部三店" : "棱镜旗舰店"}</option>
          </Select>
        </FilterBar>
        <Surface className="table-surface">
          <div className="table-meta">
            <span>当前筛选共 {rows.length} 条审计事件</span>
            <span>服务器记录时间与业务时间可能不同</span>
          </div>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => `${row.time}-${row.object}`}
            selectedKey={`${selected.time}-${selected.object}`}
            onRowClick={setSelected}
          />
        </Surface>
      </main>
      <aside className="page-inspector detail-inspector">
        <div className="inspector-header">
          <span>审计事件详情</span>
          <StatusPill>{selected.result}</StatusPill>
        </div>
        <div className="inspector-scroll">
          <div className="detail-hero">
            <span className="eyebrow">
              {selected.role} · {selected.store}
            </span>
            <h2>{selected.action}</h2>
            <p className="mono">{selected.object}</p>
          </div>
          <section className="inspector-section">
            <h3>上下文</h3>
            <dl className="detail-list">
              <div>
                <dt>业务发生时间</dt>
                <dd>2026-08-08 {selected.time}</dd>
              </div>
              <div>
                <dt>服务器记录时间</dt>
                <dd>2026-08-08 {selected.time}</dd>
              </div>
              <div>
                <dt>演示人物</dt>
                <dd>{selected.persona}</dd>
              </div>
              <div>
                <dt>请求关联 ID</dt>
                <dd className="mono">{selected.correlation}</dd>
              </div>
            </dl>
          </section>
          <section className="inspector-section">
            <h3>前后差异</h3>
            <div className="diff-block">
              <div>
                <span>before</span>
                <code>{`{ status: "待分派" }`}</code>
              </div>
              <div>
                <span>after</span>
                <code>{`{ status: "已分派", assignee: "周宁" }`}</code>
              </div>
            </div>
          </section>
          <section className="inspector-section">
            <h3>结果说明</h3>
            <p>
              {selected.result === "允许"
                ? "对象级授权、角色范围与状态跳转检查均通过。"
                : "旧角色上下文已经失效，操作被安全拒绝，未暴露对象细节。"}
            </p>
          </section>
        </div>
      </aside>
    </div>
  );
}
