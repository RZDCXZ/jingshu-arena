import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  Buildings,
  CalendarBlank,
  ChartBar,
  Clock,
  Cube,
  FileCsv,
  Gear,
  Package,
  PencilSimple,
  Plus,
  Seat,
  Storefront,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  ChartTooltip,
  Button,
  DataTable,
  Definition,
  FilterBar,
  InlineNotice,
  SectionHeading,
  Select,
  StatusPill,
  Surface,
  Tabs,
} from "./ui.jsx";
import { dailyTrend, machineProfiles, productCatalog, stores } from "./data.js";

const comparisonBars = [
  { metric: "模拟营业额", flagship: 18640, standard: 10820, newStore: 5260 },
  { metric: "预约模拟金额", flagship: 15920, standard: 9240, newStore: 4380 },
  { metric: "商品模拟金额", flagship: 2720, standard: 1580, newStore: 880 },
];

export function ChainDashboard({ navigate, onExport }) {
  return (
    <div className="view-shell">
      <main className="page-main standard-page wide-page dashboard-page hq-page">
        <div className="page-title-row">
          <div>
            <span className="eyebrow">竞枢连锁 · 总部运营视图</span>
            <h1>连锁看板</h1>
            <p>
              经营日 08月08日 06:00–次日05:59 · 三店并列比较，不生成综合排名。
            </p>
          </div>
          <div className="action-cluster">
            <Select label="经营日范围" value="当前经营日">
              <option>当前经营日</option>
              <option>最近 7 个经营日</option>
              <option>最近 14 个经营日</option>
            </Select>
            <Button tone="secondary" icon={FileCsv} onClick={onExport}>
              导出当前筛选
            </Button>
          </div>
        </div>
        <div className="chain-summary">
          <div>
            <span>固定门店</span>
            <strong>3</strong>
            <small>200 个座位</small>
          </div>
          <div>
            <span>连锁模拟营业额</span>
            <strong>¥34,720</strong>
            <small>预约 + 商品 − 模拟退款</small>
          </div>
          <div>
            <span>处理中报修</span>
            <strong>4</strong>
            <small>紧急 1</small>
          </div>
          <div>
            <span>低库存门店</span>
            <strong>2</strong>
            <small>共 5 项告警</small>
          </div>
        </div>
        <Surface className="store-comparison-surface">
          <SectionHeading
            title="三店经营脉冲"
            icon={Buildings}
            action={
              <Button tone="ghost" onClick={() => navigate("store-compare")}>
                展开比较 <ArrowRight />
              </Button>
            }
          />
          <div className="store-rows">
            <div className="store-row store-row-head">
              <span>门店</span>
              <span>模拟营业额</span>
              <span>运营座位利用率</span>
              <span>维护不可用率</span>
              <span>订单完成率</span>
              <span>经营异常</span>
              <span />
            </div>
            {stores.map((store, index) => (
              <button
                key={store.name}
                className="store-row"
                onClick={() => navigate("store-compare")}
              >
                <span>
                  <i className={`store-index store-index-${index + 1}`} />{" "}
                  <strong>{store.name}</strong>
                  <small>
                    {store.seats} 座 · {store.hours}
                  </small>
                </span>
                <b>{store.revenue}</b>
                <b>{store.utilization}</b>
                <b>{store.maintenance}</b>
                <b>{store.orders}</b>
                <span>
                  <StatusPill tone={index === 0 ? "warning" : "neutral"}>
                    {store.alert}
                  </StatusPill>
                </span>
                <ArrowRight />
              </button>
            ))}
          </div>
        </Surface>
        <div className="dashboard-grid dashboard-grid-primary">
          <Surface className="chart-surface">
            <SectionHeading
              title="最近 7 个经营日 · 运营座位利用率"
              icon={ChartBar}
              action={
                <Definition label="独立指标">
                  运营座位利用率不包含维护中座位分钟；维护不可用率在门店比较页独立展示。
                </Definition>
              }
            />
            <div className="chart-frame">
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
                minHeight={0}
                initialDimension={{ width: 720, height: 250 }}
              >
                <LineChart
                  data={dailyTrend}
                  margin={{ top: 14, right: 16, left: -18, bottom: 2 }}
                >
                  <CartesianGrid
                    stroke="#1c3040"
                    strokeDasharray="3 6"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="day"
                    stroke="#718392"
                    axisLine={false}
                    tickLine={false}
                    fontSize={11}
                  />
                  <YAxis
                    stroke="#718392"
                    axisLine={false}
                    tickLine={false}
                    domain={[0, 100]}
                    fontSize={11}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip formatter={(value) => `${value}%`} />
                    }
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="flagship"
                    name="棱镜旗舰店"
                    stroke="#b8f34a"
                    strokeWidth={2.5}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="standard"
                    name="折线标准店"
                    stroke="#59d8ff"
                    strokeWidth={2.5}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="newStore"
                    name="启点新店"
                    stroke="#b9a7ff"
                    strokeWidth={2.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Surface>
          <Surface>
            <SectionHeading
              title="跨店异常摘要"
              icon={WarningCircle}
              count={8}
            />
            <div className="issue-list">
              <button onClick={() => navigate("store-compare")}>
                <StatusPill tone="danger">紧急</StatusPill>
                <span>
                  <strong>棱镜旗舰店 · 报修待分派</strong>
                  <small>A-18 耳机右声道无声</small>
                </span>
                <ArrowRight />
              </button>
              <button onClick={() => navigate("store-compare")}>
                <StatusPill tone="warning">维护</StatusPill>
                <span>
                  <strong>启点新店 · 维护不可用率 6.2%</strong>
                  <small>1 个座位处理中</small>
                </span>
                <ArrowRight />
              </button>
              <button onClick={() => navigate("hq-people")}>
                <StatusPill tone="warning">交接</StatusPill>
                <span>
                  <strong>折线标准店 · 交接未确认</strong>
                  <small>已超过班次开始 30 分钟</small>
                </span>
                <ArrowRight />
              </button>
              <button onClick={() => navigate("store-compare")}>
                <StatusPill tone="warning">库存</StatusPill>
                <span>
                  <strong>两店共 5 项低库存</strong>
                  <small>总部只读比较，不直接修改数量</small>
                </span>
                <ArrowRight />
              </button>
            </div>
          </Surface>
        </div>
      </main>
    </div>
  );
}

export function StoreComparePage() {
  const [metric, setMetric] = useState("模拟营业额");
  return (
    <div className="view-shell">
      <main className="page-main standard-page wide-page dashboard-page">
        <div className="page-title-row">
          <div>
            <span className="eyebrow">全部三店 · 同口径比较</span>
            <h1>门店比较</h1>
            <p>
              所有按日数据使用 06:00
              经营日边界，指标可以下钻到授权范围内的构成记录。
            </p>
          </div>
        </div>
        <FilterBar placeholder="搜索门店或异常">
          <Select label="指标" value={metric} onChange={setMetric}>
            <option>模拟营业额</option>
            <option>运营座位利用率</option>
            <option>维护不可用率</option>
            <option>订单完成率</option>
            <option>库存告警</option>
          </Select>
          <Select label="门店" value="全部三店">
            <option>全部三店</option>
            <option>棱镜旗舰店</option>
            <option>折线标准店</option>
            <option>启点新店</option>
          </Select>
          <Select label="经营日范围" value="最近 7 个经营日">
            <option>当前经营日</option>
            <option>最近 7 个经营日</option>
            <option>最近 14 个经营日</option>
          </Select>
        </FilterBar>
        <div className="compare-definition">
          <strong>{metric}</strong>
          <span>
            {metric === "模拟营业额"
              ? "已完成预约与已完成商品订单扣除模拟退款后的最终模拟金额"
              : "指标定义与分母持续可见，避免不同口径混用"}
          </span>
        </div>
        <div className="dashboard-grid dashboard-grid-primary compare-grid">
          <Surface className="chart-surface">
            <SectionHeading title="三店横向比较" icon={ChartBar} />
            <div className="chart-frame tall-chart">
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
                minHeight={0}
                initialDimension={{ width: 720, height: 250 }}
              >
                <BarChart
                  data={comparisonBars}
                  margin={{ top: 16, right: 12, left: -4, bottom: 8 }}
                >
                  <CartesianGrid
                    stroke="#1c3040"
                    strokeDasharray="3 6"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="metric"
                    stroke="#718392"
                    axisLine={false}
                    tickLine={false}
                    fontSize={11}
                  />
                  <YAxis
                    stroke="#718392"
                    axisLine={false}
                    tickLine={false}
                    fontSize={11}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        formatter={(value) => `¥${value.toLocaleString()}`}
                      />
                    }
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="flagship"
                    name="棱镜旗舰店"
                    fill="#b8f34a"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="standard"
                    name="折线标准店"
                    fill="#59d8ff"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="newStore"
                    name="启点新店"
                    fill="#b9a7ff"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Surface>
          <Surface>
            <SectionHeading title="指标摘要" icon={Buildings} />
            <div className="compare-summary">
              {stores.map((store, index) => (
                <button key={store.name}>
                  <span>
                    <i className={`store-index store-index-${index + 1}`} />
                    <strong>{store.name}</strong>
                  </span>
                  <b>{store.revenue}</b>
                  <small>
                    利用率 {store.utilization} · 维护 {store.maintenance}
                  </small>
                  <ArrowRight />
                </button>
              ))}
            </div>
            <InlineNotice title="没有综合排名" tone="info">
              总部视图保持三店并列，不生成综合分、最佳门店或默认冠军色。
            </InlineNotice>
          </Surface>
        </div>
        <Surface className="table-surface">
          <SectionHeading title="完整经营对照" icon={Storefront} />
          <DataTable
            columns={[
              {
                key: "name",
                label: "门店",
                render: (row) => <strong>{row.name}</strong>,
              },
              { key: "revenue", label: "模拟营业额" },
              { key: "utilization", label: "运营座位利用率" },
              { key: "maintenance", label: "维护不可用率" },
              { key: "orders", label: "订单完成率" },
              {
                key: "alert",
                label: "异常摘要",
                render: (row) => (
                  <StatusPill tone="warning">{row.alert}</StatusPill>
                ),
              },
            ]}
            rows={stores}
            rowKey="name"
          />
        </Surface>
      </main>
    </div>
  );
}

export function ChainConfigPage({ onAction, readonly }) {
  const [tab, setTab] = useState("products");
  const productRows = productCatalog.map(([name, category, scope, state]) => ({
    name,
    category,
    scope,
    state,
  }));
  const machineRows = machineProfiles.map(
    ([name, spec, description, seats]) => ({
      name,
      spec,
      description,
      seats,
      state: "使用中",
    }),
  );
  return (
    <div className="view-shell">
      <main className="page-main standard-page wide-page">
        <div className="page-title-row">
          <div>
            <span className="eyebrow">竞枢连锁 · 总部资料</span>
            <h1>连锁配置</h1>
            <p>
              总部维护连锁级商品资料与机型档案；门店售价、上架范围与库存数量仍按门店管理。
            </p>
          </div>
          <Button
            tone="primary"
            icon={Plus}
            disabled={readonly}
            onClick={() =>
              onAction(
                tab === "products"
                  ? {
                      kind: "catalog-product",
                      mode: "create",
                      label: "创建商品资料",
                    }
                  : {
                      kind: "machine-profile",
                      mode: "create",
                      label: "创建机型档案",
                    },
              )
            }
          >
            新建{tab === "products" ? "商品" : "机型"}
          </Button>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            ["products", "商品资料", 12],
            ["machines", "机型档案", 3],
          ]}
        />
        {tab === "products" ? (
          <Surface className="table-surface section-gap">
            <DataTable
              columns={[
                {
                  key: "name",
                  label: "商品",
                  render: (row) => (
                    <span>
                      <Package />
                      <strong>{row.name}</strong>
                    </span>
                  ),
                },
                { key: "category", label: "分类" },
                { key: "scope", label: "当前门店范围" },
                {
                  key: "state",
                  label: "资料状态",
                  render: (row) => (
                    <StatusPill tone="success">{row.state}</StatusPill>
                  ),
                },
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
                          kind: "catalog-product",
                          mode: "edit",
                          label: `编辑 ${row.name}`,
                          ...row,
                        })
                      }
                    >
                      编辑
                    </Button>
                  ),
                },
              ]}
              rows={productRows}
              rowKey="name"
            />
          </Surface>
        ) : (
          <Surface className="table-surface section-gap">
            <DataTable
              columns={[
                {
                  key: "name",
                  label: "机型档案",
                  render: (row) => (
                    <span>
                      <Cube />
                      <strong>{row.name}</strong>
                    </span>
                  ),
                },
                { key: "spec", label: "体验规格" },
                { key: "description", label: "体验描述" },
                { key: "seats", label: "已分配座位" },
                {
                  key: "state",
                  label: "状态",
                  render: (row) => <StatusPill>{row.state}</StatusPill>,
                },
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
                          kind: "machine-profile",
                          mode: "edit",
                          label: `编辑 ${row.name}`,
                          ...row,
                        })
                      }
                    >
                      编辑
                    </Button>
                  ),
                },
              ]}
              rows={machineRows}
              rowKey="name"
            />
          </Surface>
        )}
      </main>
    </div>
  );
}

export function HqStoreConfigPage({ onAction, readonly }) {
  const [store, setStore] = useState("棱镜旗舰店");
  const [tab, setTab] = useState("overview");
  const scopeLabel =
    tab === "areas" ? "区域与座位" : tab === "pricing" ? "价格计划" : "商品范围";
  const configItems =
    tab === "areas"
      ? [
          { name: "竞技区 A", detail: "22 个座位" },
          { name: "竞技区 B", detail: "26 个座位" },
          { name: "竞技区 C", detail: "30 个座位" },
          { name: "竞技区 D", detail: "34 个座位", attention: true },
        ]
      : tab === "pricing"
        ? [
            { name: "价格版本 v4", detail: "未来业务生效 · 历史快照不变" },
            { name: "价格版本 v3", detail: "未来业务生效 · 历史快照不变" },
            { name: "价格版本 v2", detail: "未来业务生效 · 历史快照不变" },
            {
              name: "价格版本 v1",
              detail: "未来业务生效 · 历史快照不变",
              attention: true,
            },
          ]
        : [
            { name: "脉冲能量饮料", detail: "三店可用" },
            { name: "折线薯片", detail: "三店可用" },
            { name: "零点气泡水", detail: "三店可用" },
            {
              name: "外设清洁套装",
              detail: "仅旗舰店、新店",
              attention: true,
            },
          ];
  return (
    <div className="view-shell">
      <main className="page-main standard-page wide-page">
        <div className="page-title-row">
          <div>
            <span className="eyebrow">固定三店 · 不支持新增或删除门店</span>
            <h1>门店配置</h1>
            <p>
              总部可跨店配置资料、区域、座位、价格与商品范围，但不执行到店、制作、维修或库存调整。
            </p>
          </div>
          <Select label="当前门店" value={store} onChange={setStore}>
            {stores.map((item) => (
              <option key={item.name}>{item.name}</option>
            ))}
          </Select>
        </div>
        <div className="store-context-strip">
          <Storefront />
          <span>
            <strong>{store}</strong>
            <small>
              {stores.find((item) => item.name === store)?.seats} 座 ·{" "}
              {stores.find((item) => item.name === store)?.hours}
            </small>
          </span>
          <StatusPill tone="success">配置可编辑</StatusPill>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            ["overview", "展示与营业时间"],
            ["areas", "区域与座位"],
            ["pricing", "价格"],
            ["products", "商品范围"],
          ]}
        />
        {tab === "overview" && (
          <div className="split-layout">
            <Surface>
              <SectionHeading title="门店展示资料" icon={Storefront} />
              <div className="form-grid">
                <label className="field">
                  <span>门店名称</span>
                  <input defaultValue={store} />
                </label>
                <label className="field">
                  <span>虚构城市</span>
                  <input defaultValue="澄江市（虚构）" />
                </label>
                <label className="field field-full">
                  <span>公开演示说明</span>
                  <textarea defaultValue="所有门店、人物、金额和经营数据均为合成数据，不提供真实门店服务。" />
                </label>
              </div>
              <Button
                tone="primary"
                className="config-save-button"
                disabled={readonly}
                onClick={() =>
                  onAction({
                    kind: "store-profile",
                    store,
                    label: `保存 ${store} 展示资料`,
                  })
                }
              >
                保存未来配置
              </Button>
            </Surface>
            <Surface>
              <SectionHeading title="营业时间" icon={Clock} />
              <div className="big-fact">
                <span>当前营业规则</span>
                <strong>
                  {stores.find((item) => item.name === store)?.hours}
                </strong>
                <small>经营日边界 06:00</small>
              </div>
              <InlineNotice title="历史不追溯" tone="info">
                营业时间调整只影响未来业务，不改变既有预约或经营日归属。
              </InlineNotice>
            </Surface>
          </div>
        )}
        {tab !== "overview" && (
          <Surface className="config-placeholder">
            <div className="config-placeholder-head">
              {tab === "areas" ? (
                <Seat />
              ) : tab === "pricing" ? (
                <ChartBar />
              ) : (
                <Package />
              )}
              <div>
                <h2>
                  {tab === "areas"
                    ? "区域与座位"
                    : tab === "pricing"
                      ? "价格计划"
                      : "商品范围"}
                </h2>
                <p>
                  正在编辑 {store}
                  ；权限来自当前总部运营上下文，而不是前端下拉框。
                </p>
              </div>
              <Button
                tone="primary"
                icon={Plus}
                disabled={readonly}
                onClick={() =>
                  onAction({
                    kind: "store-future-config",
                    mode: "create",
                    scope: tab,
                    scopeLabel,
                    store,
                    label: `创建${scopeLabel}未来配置`,
                  })
                }
              >
                创建未来配置
              </Button>
            </div>
            <div className="config-row-list">
              {configItems.map((item) => (
                <div key={item.name}>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <StatusPill tone={item.attention ? "warning" : "success"}>
                    {item.attention ? "需关注" : "生效中"}
                  </StatusPill>
                  <Button
                    tone="ghost"
                    icon={PencilSimple}
                    disabled={readonly}
                    onClick={() =>
                      onAction({
                        kind: "store-future-config",
                        mode: "edit",
                        scope: tab,
                        scopeLabel,
                        store,
                        item,
                        label: `编辑 ${item.name}`,
                      })
                    }
                  >
                    编辑
                  </Button>
                </div>
              ))}
            </div>
          </Surface>
        )}
      </main>
    </div>
  );
}

export function HqPeoplePage() {
  const summaries = [
    {
      store: "棱镜旗舰店",
      staff: 14,
      managers: 2,
      current: 8,
      coverage: "覆盖充足",
      alert: "交接待提交 1",
    },
    {
      store: "折线标准店",
      staff: 9,
      managers: 1,
      current: 5,
      coverage: "覆盖充足",
      alert: "交接未确认 1",
    },
    {
      store: "启点新店",
      staff: 6,
      managers: 1,
      current: 3,
      coverage: "00:00 前覆盖不足",
      alert: "缺勤 1",
    },
  ];
  return (
    <div className="view-shell">
      <main className="page-main standard-page wide-page">
        <div className="page-title-row">
          <div>
            <span className="eyebrow">全部三店 · 只读汇总</span>
            <h1>人员与排班</h1>
            <p>
              总部可以比较人员与排班覆盖，但不能替门店创建班次、签到、签退或确认交接。
            </p>
          </div>
        </div>
        <InlineNotice title="总部只读" tone="info">
          需要调整排班时，请切换到对应门店的店长角色；总部权限不继承一线动作。
        </InlineNotice>
        <Surface className="table-surface section-gap">
          <DataTable
            columns={[
              {
                key: "store",
                label: "门店",
                render: (row) => <strong>{row.store}</strong>,
              },
              { key: "staff", label: "店员" },
              { key: "managers", label: "店长" },
              { key: "current", label: "当前在班" },
              {
                key: "coverage",
                label: "未来覆盖",
                render: (row) => (
                  <StatusPill
                    tone={row.coverage.includes("不足") ? "warning" : "success"}
                  >
                    {row.coverage}
                  </StatusPill>
                ),
              },
              { key: "alert", label: "异常" },
            ]}
            rows={summaries}
            rowKey="store"
          />
        </Surface>
        <div className="dashboard-grid dashboard-grid-secondary">
          <Surface>
            <SectionHeading title="角色结构" icon={UsersThree} />
            <div className="big-facts-row">
              <div>
                <strong>29</strong>
                <span>店员</span>
              </div>
              <div>
                <strong>4</strong>
                <span>店长</span>
              </div>
              <div>
                <strong>3</strong>
                <span>总部运营</span>
              </div>
            </div>
          </Surface>
          <Surface>
            <SectionHeading title="未来 24 小时覆盖" icon={CalendarBlank} />
            <div className="coverage-list">
              <div>
                <span>棱镜旗舰店</span>
                <progress value="92" max="100" />
                <b>92%</b>
              </div>
              <div>
                <span>折线标准店</span>
                <progress value="86" max="100" />
                <b>86%</b>
              </div>
              <div>
                <span>启点新店</span>
                <progress value="68" max="100" />
                <b>68%</b>
              </div>
            </div>
          </Surface>
          <Surface>
            <SectionHeading title="异常构成" icon={WarningCircle} />
            <div className="ops-facts">
              <div>
                <span>迟到</span>
                <strong>1</strong>
              </div>
              <div>
                <span>缺勤</span>
                <strong>1</strong>
              </div>
              <div>
                <span>交接异常</span>
                <strong>2</strong>
              </div>
            </div>
          </Surface>
        </div>
      </main>
    </div>
  );
}
