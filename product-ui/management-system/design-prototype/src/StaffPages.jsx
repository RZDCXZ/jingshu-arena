import { useMemo, useState } from "react";
import {
  Pulse,
  ArrowCounterClockwise,
  ArrowRight,
  Barcode,
  CalendarBlank,
  CaretUp,
  CheckCircle,
  Clock,
  Cube,
  Handshake,
  Headphones,
  MagnifyingGlass,
  Package,
  Receipt,
  SidebarSimple,
  SignIn,
  SignOut,
  Toolbox,
  User,
  WarningCircle,
  Wrench,
} from "@phosphor-icons/react";
import { inventory, orders, repairs, reservations } from "./data.js";
import {
  Button,
  DataTable,
  FilterBar,
  InlineNotice,
  Modal,
  SectionHeading,
  Select,
  StatusPill,
  SummaryRow,
  Surface,
  Tabs,
  Timeline,
} from "./ui.jsx";

const statusCounts = {
  arrival: 3,
  ready: 2,
  abnormal: 1,
};

function queueActionFor(status) {
  if (status === "已确认") return "办理到店";
  if (status === "已到店") return "开始使用";
  if (status === "使用中") return "提前结束";
  return "查看详情";
}

function ReservationCommandModal({ label, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const requiresReason = label === "取消预约" || label === "提前结束";
  const trimmedReason = reason.trim();
  return (
    <Modal
      title={`确认${label}`}
      eyebrow="预约现场动作"
      onClose={onClose}
      footer={
        <>
          <Button tone="secondary" onClick={onClose}>
            返回
          </Button>
          <Button
            tone="primary"
            disabled={requiresReason && !trimmedReason}
            onClick={() => onConfirm(trimmedReason)}
          >
            确认{label}
          </Button>
        </>
      }
    >
      <InlineNotice title="服务端负责最终校验" tone="info">
        提交时会重新校验当前状态、时间窗口与门店范围，并原子写入业务事件和审计记录。
      </InlineNotice>
      {requiresReason && (
        <label className="field reservation-command-reason">
          <span>办理原因</span>
          <textarea
            maxLength={200}
            onChange={(event) => setReason(event.target.value)}
            placeholder="请输入 1–200 字纯文本原因"
            value={reason}
          />
          <small>请勿填写真实个人信息 · {reason.length}/200</small>
        </label>
      )}
    </Modal>
  );
}

export function StaffWorkbench({
  reservationStatus,
  onReservationAction,
  onReservationCancel,
  navigate,
  queueFilter,
  onQueueFilter,
  readonly,
}) {
  const hero = { ...reservations[0], status: reservationStatus };
  const actionLabel = queueActionFor(hero.status);
  const [selected, setSelected] = useState(hero.id);
  const [reservationCommand, setReservationCommand] = useState(null);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const selectedReservation =
    selected === hero.id
      ? hero
      : reservations.find((item) => item.id === selected) || hero;
  const selectedActionLabel = queueActionFor(selectedReservation.status);
  const selectedIsTerminal = ["已完成", "已取消", "已过期"].includes(
    selectedReservation.status,
  );
  const normalizedFilter = queueFilter.trim().toLocaleLowerCase("zh-CN");
  const matchesFilter = (item) =>
    !normalizedFilter ||
    [item.customer, item.seat, item.status]
      .join(" ")
      .toLocaleLowerCase("zh-CN")
      .includes(normalizedFilter);
  const visibleUpcoming = reservations.slice(1, 4).filter(matchesFilter);

  return (
    <div
      className={`view-shell workbench-view ${inspectorCollapsed ? "inspector-collapsed" : "has-inspector"}`}
    >
      <main className="page-main workbench-main">
        <div className="page-title-row compact-title">
          <div>
            <h1>
              <Pulse weight="regular" />
              现场脉冲
            </h1>
            <p>经营日 08月08日 06:00–次日05:59</p>
          </div>
          <div className="workbench-title-actions">
            <label className="workbench-queue-search">
              <MagnifyingGlass aria-hidden="true" />
              <input
                aria-label="筛选当前队列"
                onChange={(event) => onQueueFilter(event.target.value)}
                placeholder="筛选当前队列"
                type="search"
                value={queueFilter}
              />
            </label>
            <span className="freshness">
              <span />
              实时更新 · 刚刚
            </span>
            {inspectorCollapsed && (
              <button
                type="button"
                className="inspector-restore"
                aria-controls="workbench-inspector"
                aria-expanded="false"
                onClick={() => setInspectorCollapsed(false)}
              >
                <SidebarSimple weight="regular" />
                展开详情
              </button>
            )}
          </div>
        </div>

        {readonly && (
          <InlineNotice tone="warning" title="当前为只读降级">
            可以查看标准种子快照，所有写操作已暂时禁用。
          </InlineNotice>
        )}

        <section
          className="queue-group queue-now"
          aria-labelledby="now-heading"
        >
          <div className="queue-label">
            <h2 id="now-heading">现在</h2>
          </div>
          {matchesFilter(hero) ? (
            <div
              className={`hero-task ${selected === hero.id ? "is-selected" : ""}`}
              role="button"
              tabIndex="0"
              onClick={() => setSelected(hero.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelected(hero.id);
                }
              }}
            >
              <span className="hero-accent" aria-hidden="true" />
              <time>19:30</time>
              <span className="person-cell">
                <User weight="fill" />
                <span>
                  <strong>{hero.customer} · 虚构人物</strong>
                  <StatusPill>{hero.status}</StatusPill>
                </span>
              </span>
              <span>
                <CalendarBlank />
                {hero.time}
                <small>到店窗口 {hero.arrival}</small>
              </span>
              <span>
                <small>竞技区</small>
                <strong>A-18</strong>
              </span>
              <span>
                <small>模拟金额</small>
                <strong>{hero.amount}</strong>
              </span>
              {actionLabel !== "查看详情" && (
                <Button
                  tone="primary"
                  icon={SignIn}
                  disabled={readonly}
                  onClick={(event) => {
                    event.stopPropagation();
                    setReservationCommand(actionLabel);
                  }}
                >
                  {actionLabel}
                </Button>
              )}
            </div>
          ) : (
            <p className="queue-empty">“现在”没有匹配结果。</p>
          )}
        </section>

        <section className="queue-group" aria-labelledby="next-heading">
          <div className="queue-label">
            <h2 id="next-heading">接下来 30 分钟</h2>
            <span>{statusCounts.arrival}</span>
          </div>
          <div className="queue-surface">
            {visibleUpcoming.map((item, index) => (
              <button
                key={item.id}
                className={`queue-row queue-row-upcoming ${selected === item.id ? "is-selected" : ""}`}
                onClick={() => setSelected(item.id)}
              >
                <time>{["19:32", "19:38", "19:45"][index]}</time>
                <span className="person-cell">
                  <User weight="fill" />
                  <strong>{item.customer} · 虚构人物</strong>
                </span>
                <span>
                  <CalendarBlank />
                  {item.time}
                  <small>到店窗口 {item.arrival}</small>
                </span>
                <span>
                  <small>竞技区</small>
                  <strong>{item.seat.split(" ").at(-1)}</strong>
                </span>
                <StatusPill>{item.status}</StatusPill>
                <strong className="queue-amount">¥30.00</strong>
                <span className="row-note">到店窗口</span>
              </button>
            ))}
            {visibleUpcoming.length === 0 && (
              <p className="queue-empty">接下来 30 分钟没有匹配结果。</p>
            )}
          </div>
        </section>

        <section className="queue-group" aria-labelledby="waiting-heading">
          <div className="queue-label">
            <h2 id="waiting-heading">等待回执</h2>
            <span>3</span>
          </div>
          <div className="queue-surface">
            <button
              className="queue-row queue-row-alert"
              onClick={() => navigate("repairs")}
            >
              <span className="row-kind danger">异常</span>
              <time>19:20</time>
              <strong className="wide-cell">
                耳机右声道无声 · 竞技区 A-18
              </strong>
              <StatusPill tone="danger">紧急</StatusPill>
              <span>待分派</span>
              <span>报修</span>
            </button>
            {reservations.slice(4, 6).map((item, index) => (
              <button
                key={item.id}
                className={`queue-row queue-row-waiting ${selected === item.id ? "is-selected" : ""}`}
                onClick={() => setSelected(item.id)}
              >
                <span className="row-kind warning">预约</span>
                <time>{["19:15", "19:07"][index]}</time>
                <strong>{item.customer} · 虚构人物</strong>
                <span>
                  <CalendarBlank />
                  {item.time}
                  <small>到店窗口 {item.arrival}</small>
                </span>
                <span>
                  <small>竞技区</small>
                  <strong>{item.seat.split(" ").at(-1)}</strong>
                </span>
                <StatusPill>{item.status}</StatusPill>
                <span>已到店待开始</span>
              </button>
            ))}
          </div>
        </section>

        <div className="workbench-summaries">
          <SummaryRow
            icon={Package}
            title="商品订单"
            onClick={() => navigate("orders")}
          >
            <span>
              已模拟支付 <b>4</b>
            </span>
            <i />
            <span>
              制作中 <b>2</b>
            </span>
            <i />
            <span>
              待取 <b>1</b>
            </span>
          </SummaryRow>
          <SummaryRow
            icon={Wrench}
            title="报修"
            onClick={() => navigate("repairs")}
            danger
          >
            <span>
              紧急 <b>1</b>
            </span>
            <i />
            <span>
              待分派 <b>2</b>
            </span>
            <i />
            <span>
              待验证 <b>1</b>
            </span>
          </SummaryRow>
        </div>
      </main>

      <aside
        id="workbench-inspector"
        className="page-inspector workbench-inspector"
        hidden={inspectorCollapsed}
      >
        <div className="inspector-header">
          <span>当前选中</span>
          <button
            type="button"
            aria-controls="workbench-inspector"
            aria-expanded="true"
            title="隐藏当前选中详情"
            onClick={() => setInspectorCollapsed(true)}
          >
            收起
          </button>
        </div>
        <Surface className="inspector-object">
          <div className="object-title">
            <User weight="fill" />
            <strong>{selectedReservation.customer} · 虚构人物</strong>
            <StatusPill>{selectedReservation.status}</StatusPill>
          </div>
          <dl className="detail-list">
            <div>
              <dt>座位</dt>
              <dd>{selectedReservation.seat}</dd>
            </div>
            <div>
              <dt>时间</dt>
              <dd>{selectedReservation.time}（2小时）</dd>
            </div>
            <div>
              <dt>到店窗口</dt>
              <dd>{selectedReservation.arrival}</dd>
            </div>
            <div>
              <dt>模拟金额</dt>
              <dd>{selectedReservation.amount}</dd>
            </div>
            <div>
              <dt>相关对象</dt>
              <dd>
                预约单、座位 {selectedReservation.seat.split(" ").at(-1)}
                、储物柜 18号
              </dd>
            </div>
          </dl>
          {selectedReservation.id === hero.id &&
            ["已确认", "已到店"].includes(hero.status) && (
              <Button
                tone="ghost"
                disabled={readonly}
                onClick={() => setReservationCommand("取消预约")}
              >
                取消预约
              </Button>
            )}
          <div className="inspector-section">
            <h3>业务事件</h3>
            <Timeline
              compact
              items={[
                { time: "19:10", title: "预约已确认", meta: "系统 · 演示数据" },
                {
                  time: "19:12",
                  title: "模拟支付成功",
                  meta: "系统 · 演示数据",
                },
                {
                  time: "19:30",
                  title: selectedIsTerminal
                    ? `预约${selectedReservation.status}`
                    : `${selectedActionLabel}（待执行）`,
                  meta: selectedIsTerminal ? "无后续业务动作" : "店员操作",
                  pending: !selectedIsTerminal,
                },
              ]}
            />
          </div>
        </Surface>
        <Surface className="shift-card">
          <h3>本人班次</h3>
          <dl className="detail-list">
            <div>
              <dt>班次时间</dt>
              <dd>18:00–02:00</dd>
            </div>
            <div>
              <dt>已模拟签到</dt>
              <dd>18:02</dd>
            </div>
            <div>
              <dt>交接状态</dt>
              <dd className="text-warning">交接待提交</dd>
            </div>
          </dl>
        </Surface>
      </aside>
      {reservationCommand && (
        <ReservationCommandModal
          label={reservationCommand}
          onClose={() => setReservationCommand(null)}
          onConfirm={(reason) => {
            if (reservationCommand === "取消预约") {
              onReservationCancel(reason);
            } else {
              onReservationAction(reason);
            }
            setReservationCommand(null);
          }}
        />
      )}
    </div>
  );
}

export function ReservationsPage({
  reservationStatus,
  onReservationAction,
  onReservationCancel,
  onDateRange,
  readonly,
}) {
  const [selectedId, setSelectedId] = useState(reservations[0].id);
  const [statusFilter, setStatusFilter] = useState("全部状态");
  const [search, setSearch] = useState("");
  const [reservationCommand, setReservationCommand] = useState(null);
  const rows = useMemo(
    () =>
      reservations
        .map((item, index) =>
          index === 0 ? { ...item, status: reservationStatus } : item,
        )
        .filter(
          (item) => statusFilter === "全部状态" || item.status === statusFilter,
        )
        .filter((item) =>
          `${item.customer}${item.seat}${item.id}`.includes(search),
        ),
    [reservationStatus, statusFilter, search],
  );
  const selected = rows.find((item) => item.id === selectedId) ||
    rows[0] || { ...reservations[0], status: reservationStatus };
  const selectedIsTerminal = ["已完成", "已取消", "已过期"].includes(
    selected.status,
  );

  const columns = [
    { key: "time", label: "计划时间" },
    {
      key: "customer",
      label: "顾客",
      render: (row) => <strong>{row.customer} · 虚构人物</strong>,
    },
    { key: "seat", label: "座位" },
    { key: "profile", label: "机型" },
    { key: "arrival", label: "到店窗口" },
    {
      key: "status",
      label: "状态",
      render: (row) => <StatusPill>{row.status}</StatusPill>,
    },
    { key: "note", label: "提示" },
  ];

  return (
    <div className="view-shell has-inspector">
      <main className="page-main standard-page">
        <div className="page-title-row">
          <div>
            <span className="eyebrow">棱镜旗舰店</span>
            <h1>预约</h1>
            <p>当前经营日 · 08月08日 06:00–次日05:59</p>
          </div>
          <Button tone="secondary" icon={CalendarBlank} onClick={onDateRange}>
            经营日范围
          </Button>
        </div>
        <FilterBar
          search={search}
          onSearch={setSearch}
          placeholder="搜索顾客、座位或预约编号"
        >
          <Select
            label="预约状态"
            value={statusFilter}
            onChange={setStatusFilter}
          >
            {[
              "全部状态",
              "已确认",
              "已到店",
              "使用中",
              "已完成",
              "已取消",
              "已过期",
            ].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>
          <Select label="区域" value="全部区域">
            <option>全部区域</option>
            <option>竞技区</option>
            <option>旗舰区</option>
          </Select>
          <Select label="异常" value="全部记录">
            <option>全部记录</option>
            <option>仅异常</option>
          </Select>
        </FilterBar>
        <Surface className="table-surface">
          <div className="table-meta">
            <span>共 {rows.length} 条预约</span>
            <span>筛选已保存到当前演示页</span>
          </div>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey="id"
            selectedKey={selected?.id}
            onRowClick={(row) => setSelectedId(row.id)}
          />
        </Surface>
      </main>
      <aside className="page-inspector detail-inspector">
        <div className="inspector-header">
          <span>预约详情</span>
          <StatusPill>{selected.status}</StatusPill>
        </div>
        <div className="inspector-scroll">
          <div className="detail-hero">
            <span className="eyebrow">{selected.id}</span>
            <h2>{selected.customer} · 虚构人物</h2>
            <p>
              {selected.time} · {selected.seat}
            </p>
            {selected.id === reservations[0].id &&
              queueActionFor(selected.status) !== "查看详情" && (
                <Button
                  tone="primary"
                  icon={selected.status === "已确认" ? SignIn : Pulse}
                  disabled={readonly}
                  onClick={() => setReservationCommand(queueActionFor(selected.status))}
                >
                  {queueActionFor(selected.status)}
                </Button>
              )}
            {selected.id === reservations[0].id &&
              ["已确认", "已到店"].includes(selected.status) && (
                <Button
                  tone="ghost"
                  disabled={readonly}
                  onClick={() => setReservationCommand("取消预约")}
                >
                  取消预约
                </Button>
              )}
          </div>
          <section className="inspector-section">
            <h3>预约信息</h3>
            <dl className="detail-list">
              <div>
                <dt>到店窗口</dt>
                <dd>{selected.arrival}</dd>
              </div>
              <div>
                <dt>机型档案</dt>
                <dd>{selected.profile}</dd>
              </div>
              <div>
                <dt>模拟总额</dt>
                <dd>{selected.amount}</dd>
              </div>
              <div>
                <dt>体验券</dt>
                <dd>预约体验券 -¥6.00</dd>
              </div>
            </dl>
          </section>
          <section className="inspector-section">
            <h3>半小时价格快照</h3>
            <div className="price-fragments">
              {[
                "19:30–20:00 ¥7.50",
                "20:00–20:30 ¥7.50",
                "20:30–21:00 ¥7.50",
                "21:00–21:30 ¥7.50",
              ].map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </section>
          <section className="inspector-section">
            <h3>业务事件</h3>
            <Timeline
              compact
              items={[
                {
                  time: "19:10",
                  title: "创建待确认预约",
                  meta: "价格与体验券已快照",
                },
                { time: "19:12", title: "模拟支付成功", meta: "不扣款" },
                {
                  time: "19:30",
                  title:
                    selectedIsTerminal
                      ? `预约${selected.status}`
                      : queueActionFor(selected.status),
                  meta:
                    selectedIsTerminal
                      ? "无后续业务动作"
                      : "下一合法动作",
                  pending: !selectedIsTerminal,
                },
              ]}
            />
          </section>
        </div>
      </aside>
      {reservationCommand && (
        <ReservationCommandModal
          label={reservationCommand}
          onClose={() => setReservationCommand(null)}
          onConfirm={(reason) => {
            if (reservationCommand === "取消预约") {
              onReservationCancel(reason);
            } else {
              onReservationAction(reason);
            }
            setReservationCommand(null);
          }}
        />
      )}
    </div>
  );
}

export function OrdersPage({ orderStates, onAdvance, onCancel, readonly }) {
  const [tab, setTab] = useState("active");
  const [selectedId, setSelectedId] = useState(orders[0].id);
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("all");
  const fixedCommandState = new URLSearchParams(window.location.search).get(
    "orderCommandState",
  );
  const [submitting, setSubmitting] = useState(
    fixedCommandState === "processing",
  );
  const [commandError, setCommandError] = useState(
    fixedCommandState === "failure"
      ? "订单动作未能完成，原状态保持不变；可以安全重试。"
      : "",
  );
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const stateFor = (order) => orderStates[order.id] || order.status;
  const rows = orders
    .map((order) => ({ ...order, status: stateFor(order) }))
    .filter((order) => {
      if (tab === "active")
        return !["已完成", "已取消", "已过期"].includes(order.status);
      if (tab === "completed") return order.status === "已完成";
      if (tab === "exceptions")
        return ["已取消", "已过期"].includes(order.status);
      return true;
    })
    .filter((order) => stage === "all" || order.status === stage)
    .filter((order) =>
      `${order.customer}${order.id}${order.items}`.includes(search),
    );
  const selected = orders.find((order) => order.id === selectedId) || orders[0];
  const selectedStatus = stateFor(selected);
  const nextAction = {
    已模拟支付: "开始制作",
    制作中: "标记待取",
    待取: "完成订单",
  }[selectedStatus];
  const stageCounts = {
    all: orders.length,
    已模拟支付: orders.filter((order) => stateFor(order) === "已模拟支付")
      .length,
    制作中: orders.filter((order) => stateFor(order) === "制作中").length,
    待取: orders.filter((order) => stateFor(order) === "待取").length,
  };

  function submitAction(action, reason = "") {
    if (readonly || submitting) return;
    setSubmitting(true);
    setCommandError("");
    window.setTimeout(() => {
      if (fixedCommandState === "failure") {
        setCommandError("订单动作未能完成，原状态保持不变；可以安全重试。");
        setSubmitting(false);
        return;
      }
      if (action === "cancel") {
        onCancel(selected.id, reason);
        setCancelOpen(false);
        setCancelReason("");
      } else {
        onAdvance(selected.id);
      }
      setSubmitting(false);
    }, 520);
  }
  const columns = [
    { key: "time", label: "下单时间" },
    {
      key: "id",
      label: "订单",
      render: (row) => <span className="mono">{row.id}</span>,
    },
    {
      key: "customer",
      label: "顾客 / 座位",
      render: (row) => (
        <span>
          <strong>{row.customer}</strong>
          <small className="cell-sub">竞技区 {row.seat}</small>
        </span>
      ),
    },
    { key: "items", label: "商品快照" },
    { key: "total", label: "模拟金额" },
    {
      key: "status",
      label: "履约状态",
      render: (row) => <StatusPill>{row.status}</StatusPill>,
    },
  ];

  return (
    <div className="view-shell has-inspector">
      <main className="page-main standard-page">
        <div className="page-title-row">
          <div>
            <span className="eyebrow">棱镜旗舰店 · 当前经营日</span>
            <h1>商品订单</h1>
            <p>
              已完成模拟支付的订单按履约阶段推进，关联预约故障不影响已支付订单继续履约。
            </p>
          </div>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            ["active", "履约中", 4],
            ["completed", "已完成", 1],
            ["exceptions", "异常终态", 0],
          ]}
        />
        <FilterBar
          search={search}
          onSearch={setSearch}
          placeholder="搜索订单、顾客或商品"
        >
          <Select label="履约阶段" value={stage} onChange={setStage}>
            <option value="all">全部阶段（{stageCounts.all}）</option>
            <option value="已模拟支付">
              已模拟支付（{stageCounts.已模拟支付}）
            </option>
            <option value="制作中">制作中（{stageCounts.制作中}）</option>
            <option value="待取">待取（{stageCounts.待取}）</option>
          </Select>
        </FilterBar>
        {commandError && (
          <InlineNotice title="动作未完成" tone="warning">
            {commandError}
          </InlineNotice>
        )}
        <Surface className="table-surface">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey="id"
            selectedKey={selectedId}
            onRowClick={(row) => setSelectedId(row.id)}
          />
        </Surface>
      </main>
      <aside className="page-inspector detail-inspector">
        <div className="inspector-header">
          <span>订单详情</span>
          <StatusPill>{selectedStatus}</StatusPill>
        </div>
        <div className="inspector-scroll">
          <div className="detail-hero">
            <span className="eyebrow mono">{selected.id}</span>
            <h2>{selected.customer} · 虚构人物</h2>
            <p>
              竞技区 {selected.seat} · {selected.time}
            </p>
            {nextAction && (
              <Button
                tone="primary"
                icon={Receipt}
                disabled={readonly || submitting}
                loading={submitting}
                onClick={() => submitAction("advance")}
              >
                {submitting ? `正在提交${nextAction}` : nextAction}
              </Button>
            )}
          </div>
          <section className="inspector-section">
            <h3>商品快照</h3>
            <div className="line-items">
              <div>
                <span>{selected.items}</span>
                <b>{selected.total}</b>
              </div>
              <div>
                <span>商品体验券</span>
                <b>-¥6.00</b>
              </div>
              <div className="line-total">
                <span>最终模拟金额</span>
                <b>{selected.total}</b>
              </div>
            </div>
          </section>
          <section className="inspector-section">
            <h3>库存与关联</h3>
            <dl className="detail-list">
              <div>
                <dt>库存预留</dt>
                <dd>整单已预留</dd>
              </div>
              <div>
                <dt>关联预约</dt>
                <dd>RSV-…0123</dd>
              </div>
              <div>
                <dt>柜台取货</dt>
                <dd>棱镜旗舰店前台</dd>
              </div>
            </dl>
          </section>
          <section className="inspector-section">
            <h3>履约事件</h3>
            <Timeline
              compact
              items={[
                { time: "19:18", title: "整单库存已预留", meta: "原子提交" },
                { time: "19:18", title: "模拟支付成功", meta: "不扣款" },
                {
                  time: "下一步",
                  title: nextAction || "订单已进入终态",
                  meta: nextAction ? "必须按顺序推进" : "无后续状态动作",
                  pending: Boolean(nextAction),
                },
              ]}
            />
          </section>
          {nextAction && (
            <Button
              tone="ghost"
              disabled={readonly || submitting}
              onClick={() => {
                setCommandError("");
                setCancelOpen(true);
              }}
            >
              带原因取消订单
            </Button>
          )}
        </div>
      </aside>
      {cancelOpen && (
        <Modal
          title="取消商品订单"
          eyebrow="商品订单履约动作"
          initialFocusSelector="textarea"
          onClose={() => !submitting && setCancelOpen(false)}
          footer={
            <>
              <Button
                tone="secondary"
                disabled={submitting}
                onClick={() => setCancelOpen(false)}
              >
                返回
              </Button>
              <Button
                tone="primary"
                disabled={!cancelReason.trim() || submitting}
                loading={submitting}
                onClick={() => submitAction("cancel", cancelReason.trim())}
              >
                {commandError ? "重试取消" : "确认取消"}
              </Button>
            </>
          }
        >
          <InlineNotice title="服务端负责最终校验" tone="info">
            将按当前阶段原子决定库存释放或损耗、模拟退款和体验券恢复。
          </InlineNotice>
          <label className="field reservation-command-reason">
            <span>取消原因</span>
            <textarea
              autoFocus
              maxLength={200}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="请输入 1–200 字纯文本原因"
              value={cancelReason}
            />
            <small>请勿填写真实个人信息 · {cancelReason.length}/200</small>
          </label>
          {commandError && (
            <InlineNotice title="原状态保持不变" tone="warning">
              {commandError}
            </InlineNotice>
          )}
        </Modal>
      )}
    </div>
  );
}

export function RepairsPage({
  repairStates,
  repairSpareStates = {},
  verificationEvidence = {},
  onAdvance,
  onClaimSpare,
  onCreate,
  onReturnSpare,
  readonly,
  role = "staff",
}) {
  const [tab, setTab] = useState("open");
  const [selectedId, setSelectedId] = useState(repairs[0].id);
  const [search, setSearch] = useState("");
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [resolutionNote, setResolutionNote] = useState(
    "已更换无品牌备用耳机，并完成左右声道与麦克风测试。",
  );
  const stateFor = (repair) => repairStates[repair.id] || repair.status;
  const rows = repairs
    .map((repair) => ({ ...repair, status: stateFor(repair) }))
    .filter((repair) =>
      tab === "closed"
        ? repair.status === "已关闭"
        : repair.status !== "已关闭",
    )
    .filter((repair) =>
      `${repair.issue}${repair.seat}${repair.id}`.includes(search),
    );
  const selected =
    repairs.find((repair) => repair.id === selectedId) || repairs[0];
  const selectedStatus = stateFor(selected);
  const claimedQuantity = repairSpareStates[selected.id]?.claimed || 0;
  const returnedQuantity = repairSpareStates[selected.id]?.returned || 0;
  const consumedQuantity = Math.max(0, claimedQuantity - returnedQuantity);
  const actionMap = {
    待分派: "分派给我",
    已分派: "开始处理",
    处理中: "提交解决说明",
    待验证: "验证成功",
  };
  const nextAction = actionMap[selectedStatus];
  const columns = [
    {
      key: "priority",
      label: "优先级",
      render: (row) => (
        <StatusPill
          tone={
            row.priority === "紧急"
              ? "danger"
              : row.priority === "较高"
                ? "warning"
                : "neutral"
          }
        >
          {row.priority}
        </StatusPill>
      ),
    },
    { key: "opened", label: "创建时间" },
    {
      key: "issue",
      label: "问题",
      render: (row) => <strong>{row.issue}</strong>,
    },
    { key: "seat", label: "座位" },
    { key: "assignee", label: "处理人" },
    {
      key: "status",
      label: "状态",
      render: (row) => <StatusPill>{row.status}</StatusPill>,
    },
  ];

  return (
    <div className="view-shell has-inspector">
      <main className="page-main standard-page">
        <div className="page-title-row">
          <div>
            <span className="eyebrow">棱镜旗舰店 · 现场运营</span>
            <h1>报修</h1>
            <p>
              开始处理后，座位维护、受影响预约、模拟退款与备件流水在同一业务动作中联动。
            </p>
          </div>
          <Button
            tone="secondary"
            icon={Toolbox}
            disabled={readonly || role === "hq"}
            onClick={onCreate}
          >
            创建座位报修
          </Button>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            ["open", "处理中队列", rows.length],
            ["closed", "已关闭", 0],
          ]}
        />
        <FilterBar
          search={search}
          onSearch={setSearch}
          placeholder="搜索问题、座位或报修编号"
        >
          <Select label="优先级" value="全部优先级">
            <option>全部优先级</option>
            <option>紧急</option>
            <option>较高</option>
            <option>普通</option>
          </Select>
          <Select label="处理人" value="全部处理人">
            <option>全部处理人</option>
            <option>未分派</option>
            <option>周宁</option>
          </Select>
        </FilterBar>
        <Surface className="table-surface">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey="id"
            selectedKey={selectedId}
            onRowClick={(row) => setSelectedId(row.id)}
          />
        </Surface>
      </main>
      <aside className="page-inspector detail-inspector repair-inspector">
        <div className="inspector-header">
          <span>报修详情</span>
          <StatusPill>{selectedStatus}</StatusPill>
        </div>
        <div className="inspector-scroll">
          <div className="detail-hero">
            <div className="detail-icon danger">
              <Headphones weight="duotone" />
            </div>
            <span className="eyebrow mono">{selected.id}</span>
            <h2>{selected.issue}</h2>
            <p>
              {selected.seat} · {selected.profile}
            </p>
            <div className="repair-legal-actions">
              {["待分派", "已分派"].includes(selectedStatus) && nextAction && (
                <Button
                  tone="primary"
                  icon={Wrench}
                  disabled={readonly || role === "hq"}
                  onClick={() => onAdvance(selected.id)}
                >
                  {nextAction}
                </Button>
              )}
              {selectedStatus === "处理中" && (
                <>
                  <Button
                    tone="secondary"
                    icon={Package}
                    disabled={readonly || role === "hq" || claimedQuantity >= 2}
                    onClick={() => onClaimSpare?.(selected.id)}
                  >
                    领用备件
                  </Button>
                  <Button
                    tone="secondary"
                    icon={ArrowCounterClockwise}
                    disabled={readonly || role === "hq" || consumedQuantity < 1}
                    onClick={() => onReturnSpare?.(selected.id)}
                  >
                    退回未用
                  </Button>
                  <Button
                    tone="primary"
                    icon={CheckCircle}
                    disabled={readonly || role === "hq"}
                    onClick={() => setResolutionOpen(true)}
                  >
                    提交解决说明
                  </Button>
                </>
              )}
              {selectedStatus === "待验证" && role === "manager" && (
                <>
                  <Button
                    tone="primary"
                    icon={CheckCircle}
                    disabled={readonly || role === "hq"}
                    onClick={() => {
                      onAdvance(selected.id, "success");
                    }}
                  >
                    验证成功并关闭
                  </Button>
                  <Button
                    tone="ghost"
                    icon={WarningCircle}
                    disabled={readonly || role === "hq"}
                    onClick={() => {
                      onAdvance(selected.id, "failure");
                    }}
                  >
                    验证失败并退回
                  </Button>
                </>
              )}
            </div>
          </div>
          {selectedStatus === "处理中" && (
            <InlineNotice tone="warning" title="座位维护联动已生效">
              A-18 已进入维护中，使用中预约已提前完成，未来完整价格片段形成
              ¥15.00 模拟退款。
            </InlineNotice>
          )}
          <section className="inspector-section">
            <h3>摘要</h3>
            <dl className="detail-list">
              <div>
                <dt>优先级</dt>
                <dd>
                  <StatusPill
                    tone={selected.priority === "紧急" ? "danger" : "warning"}
                  >
                    {selected.priority}
                  </StatusPill>
                </dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd>{selected.source}</dd>
              </div>
              <div>
                <dt>处理人</dt>
                <dd>
                  {selectedStatus === "待分派" ? "未分派" : selected.assignee}
                </dd>
              </div>
              <div>
                <dt>顾客可见说明</dt>
                <dd>{selected.publicNote}</dd>
              </div>
            </dl>
          </section>
          <section className="inspector-section">
            <h3>座位与预约影响</h3>
            <div className="impact-grid">
              <div>
                <span>座位运营状态</span>
                <b>
                  {["处理中", "待验证"].includes(selectedStatus)
                    ? "维护中"
                    : "正常"}
                </b>
              </div>
              <div>
                <span>使用中预约</span>
                <b>{selectedStatus === "处理中" ? "提前完成 1" : "待评估"}</b>
              </div>
              <div>
                <span>未来预约</span>
                <b>{selectedStatus === "处理中" ? "取消 2" : "待评估"}</b>
              </div>
              <div>
                <span>模拟退款</span>
                <b>{selectedStatus === "处理中" ? "¥15.00" : "待计算"}</b>
              </div>
            </div>
          </section>
          <section className="inspector-section">
            <h3>备件</h3>
            <div className="parts-row">
              <Cube />
              <span>
                <strong>无品牌替换耳机</strong>
                <small>
                  可用 {2 - claimedQuantity + returnedQuantity} · 已领用
                  {claimedQuantity} · 已退回 {returnedQuantity} · 已消耗
                  {consumedQuantity}
                </small>
              </span>
              <StatusPill tone={consumedQuantity > 0 ? "warning" : "neutral"}>
                {consumedQuantity > 0 ? "已关联流水" : "未领用"}
              </StatusPill>
            </div>
            {claimedQuantity > 0 && (
              <p className="repair-ledger-proof mono">
                MOV-RPR-0017 · 业务发生 19:49 · 入库记录 19:49:02 · 报修与库存同事务
              </p>
            )}
          </section>
          {selectedStatus === "待验证" && (
            <section className="inspector-section repair-resolution-proof">
              <h3>解决说明</h3>
              <CheckCircle weight="fill" />
              <p>{resolutionNote}</p>
              <small>
                {selected.assignee}提交 · 业务发生 19:57 · 等待独立验证
              </small>
            </section>
          )}
          {verificationEvidence[selected.id] && (
            <InlineNotice
              tone={
                verificationEvidence[selected.id] === "success"
                  ? "success"
                  : "warning"
              }
              title={
                verificationEvidence[selected.id] === "success"
                  ? "独立验证成功"
                  : "独立验证失败，已退回处理中"
              }
            >
              {verificationEvidence[selected.id] === "success"
                ? "店长林琪复测通过；报修关闭，座位在同一事务恢复正常。"
                : "店长林琪复测仍有右声道异常；座位保持维护，可重新处理。"}
            </InlineNotice>
          )}
          <section className="inspector-section">
            <h3>报修与审计证据</h3>
            <Timeline
              compact
              items={[
                {
                  time: "19:20",
                  title: "顾客提交报修",
                  meta: "耳机右声道无声",
                },
                {
                  time: "19:22",
                  title:
                    selectedStatus === "待分派" ? "等待分派" : "已分派给周宁",
                  meta: "门店范围",
                  pending: selectedStatus === "待分派",
                },
                {
                  time: "下一步",
                  title: nextAction || "报修已关闭",
                  meta: nextAction ? "合法状态动作" : "座位已恢复正常",
                  pending: Boolean(nextAction),
                },
              ]}
            />
          </section>
        </div>
      </aside>
      {resolutionOpen && (
        <Modal
          eyebrow="REPAIR RESOLUTION"
          title="提交解决说明"
          onClose={() => setResolutionOpen(false)}
          footer={
            <>
              <Button tone="ghost" onClick={() => setResolutionOpen(false)}>
                取消
              </Button>
              <Button
                tone="primary"
                icon={CheckCircle}
                disabled={!resolutionNote.trim()}
                onClick={() => {
                  setResolutionOpen(false);
                  onAdvance(selected.id);
                }}
              >
                提交并进入待验证
              </Button>
            </>
          }
        >
          <InlineNotice tone="info" title="处理人与验证人必须独立">
            提交后座位继续保持维护；须由同店另一位店员或店长复测。
          </InlineNotice>
          <label className="field repair-resolution-field">
            <span>解决说明</span>
            <textarea
              autoFocus
              maxLength={500}
              onChange={(event) => setResolutionNote(event.target.value)}
              value={resolutionNote}
            />
            <small>{resolutionNote.length}/500 · 请勿填写真实个人信息</small>
          </label>
        </Modal>
      )}
    </div>
  );
}

export function InventoryPage({
  manager = false,
  onInventoryAction,
  readonly,
}) {
  const [type, setType] = useState("全部类别");
  const [state, setState] = useState("全部状态");
  const [ledgerExpanded, setLedgerExpanded] = useState(false);
  const rows = inventory
    .filter((item) => type === "全部类别" || item.type === type)
    .filter((item) => state === "全部状态" || item.state === state);
  const columns = [
    {
      key: "name",
      label: "库存项目",
      render: (row) => (
        <span>
          <strong>{row.name}</strong>
          <small className="cell-sub">{row.type}</small>
        </span>
      ),
    },
    {
      key: "book",
      label: "账面库存",
      render: (row) => <b className="tabular">{row.book}</b>,
    },
    {
      key: "reserved",
      label: "预留库存",
      render: (row) => <b className="tabular">{row.reserved}</b>,
    },
    {
      key: "available",
      label: "可用库存",
      render: (row) => <b className="tabular">{row.available}</b>,
    },
    { key: "threshold", label: "低库存阈值" },
    {
      key: "state",
      label: "告警",
      render: (row) => <StatusPill>{row.state}</StatusPill>,
    },
    { key: "updated", label: "最近流水" },
  ];
  const ledgerRows = [
    ["19:18", "订单预留", "info", "能量饮料", "预留 +1", "ORD-…0038"],
    ["18:58", "备件领用", "warning", "鼠标滚轮组件", "账面 -1", "RPR-…0012"],
    ["18:42", "备件领用", "warning", "显示线", "账面 -1", "RPR-…0009"],
    ["18:30", "订单释放", "success", "气泡水", "预留 -1", "ORD-…0031"],
    ["18:12", "盘点更正", "info", "外设清洁套装", "账面 +2", "STK-…0086"],
    ["17:50", "维修预留", "warning", "替换耳机", "预留 +1", "RPR-…0007"],
  ];

  return (
    <div className="view-shell">
      <main className="page-main standard-page wide-page">
        <div className="page-title-row">
          <div>
            <span className="eyebrow">棱镜旗舰店 · 统一库存账本</span>
            <h1>库存</h1>
            <p>
              可用库存 = 账面库存 − 预留库存；商品与维修备件共用不可变库存流水。
            </p>
          </div>
          {manager && (
            <div className="action-cluster">
              <Button
                tone="secondary"
                icon={Barcode}
                disabled={readonly}
                onClick={() =>
                  onInventoryAction({
                    kind: "inventory-count",
                    label: "创建库存盘点",
                    item: "外设清洁套装",
                    book: 9,
                    actual: 11,
                  })
                }
              >
                盘点
              </Button>
              <Button
                tone="secondary"
                icon={ArrowCounterClockwise}
                disabled={readonly}
                onClick={() =>
                  onInventoryAction({
                    kind: "inventory-compensation",
                    label: "创建补偿流水",
                    item: "替换耳机",
                    delta: -1,
                    original: "RCV-260808-0007",
                  })
                }
              >
                补偿流水
              </Button>
              <Button
                tone="primary"
                icon={Cube}
                disabled={readonly}
                onClick={() =>
                  onInventoryAction({
                    kind: "inventory-receipt",
                    label: "创建手工入库",
                    item: "替换耳机",
                    quantity: 6,
                  })
                }
              >
                手工入库
              </Button>
            </div>
          )}
        </div>
        {!manager && (
          <InlineNotice title="余额只读" tone="info">
            店员只能通过商品订单或报修中的业务动作产生库存变化，不能直接修改余额。
          </InlineNotice>
        )}
        <div className="inventory-summary">
          <div>
            <span>库存项目</span>
            <strong>20</strong>
          </div>
          <div>
            <span>商品</span>
            <strong>12</strong>
          </div>
          <div>
            <span>维修备件</span>
            <strong>8</strong>
          </div>
          <div className="is-alert">
            <span>低库存</span>
            <strong>3</strong>
          </div>
        </div>
        <FilterBar placeholder="搜索库存项目">
          <Select label="类别" value={type} onChange={setType}>
            <option>全部类别</option>
            <option>商品</option>
            <option>备件</option>
          </Select>
          <Select label="库存状态" value={state} onChange={setState}>
            <option>全部状态</option>
            <option>正常</option>
            <option>低库存</option>
          </Select>
        </FilterBar>
        <Surface className="table-surface">
          <DataTable columns={columns} rows={rows} rowKey="name" />
        </Surface>
        <Surface className="ledger-preview">
          <SectionHeading
            title="最近库存流水"
            icon={Receipt}
            action={
              <Button
                tone="ghost"
                trailing={ledgerExpanded ? CaretUp : ArrowRight}
                aria-expanded={ledgerExpanded}
                aria-controls="inventory-ledger-rows"
                onClick={() => setLedgerExpanded((value) => !value)}
              >
                {ledgerExpanded ? "收起流水" : "查看全部流水"}
              </Button>
            }
          />
          <div id="inventory-ledger-rows" className="ledger-rows">
            {ledgerRows
              .slice(0, ledgerExpanded ? ledgerRows.length : 3)
              .map(([time, label, tone, name, delta, id]) => (
                <div key={`${time}-${id}`}>
                  <time>{time}</time>
                  <StatusPill tone={tone}>{label}</StatusPill>
                  <strong>{name}</strong>
                  <span>{delta}</span>
                  <small>{id}</small>
                </div>
              ))}
          </div>
        </Surface>
      </main>
    </div>
  );
}

export function ShiftPage({ onHandover, handoverSubmitted, readonly }) {
  const [tab, setTab] = useState("shift");
  return (
    <div className="view-shell">
      <main className="page-main standard-page wide-page">
        <div className="page-title-row">
          <div>
            <span className="eyebrow">周宁 · 虚构人物</span>
            <h1>班次与交接</h1>
            <p>模拟签到与手动签退只用于演示，不接入定位、人脸或真实门禁。</p>
          </div>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            ["shift", "本人班次"],
            ["handover", "交接班", handoverSubmitted ? 0 : 1],
          ]}
        />
        {tab === "shift" ? (
          <div className="split-layout">
            <Surface className="shift-focus">
              <SectionHeading title="当前班次" icon={Clock} />
              <div className="shift-time">
                <span>08月08日</span>
                <strong>18:00</strong>
                <i />
                <strong>次日 02:00</strong>
              </div>
              <div className="shift-facts">
                <div>
                  <CheckCircle weight="fill" />
                  <span>
                    已模拟签到<strong>18:02 · 准时</strong>
                  </span>
                </div>
                <div>
                  <SignOut />
                  <span>
                    签退状态<strong>待本班次结束前手动签退</strong>
                  </span>
                </div>
              </div>
              <Button tone="secondary" icon={SignOut} disabled={readonly}>
                手动签退
              </Button>
            </Surface>
            <Surface>
              <SectionHeading title="未来班次" icon={CalendarBlank} />
              <div className="future-shifts">
                <div>
                  <time>08月09日</time>
                  <strong>18:00–02:00</strong>
                  <span>店员 · 前台与现场</span>
                </div>
                <div>
                  <time>08月10日</time>
                  <strong>14:00–22:00</strong>
                  <span>店员 · 现场支援</span>
                </div>
              </div>
            </Surface>
          </div>
        ) : (
          <div className="split-layout handover-layout">
            <Surface>
              <SectionHeading title="本班次交接快照" icon={Handshake} />
              <p className="surface-intro">
                提交时保存未完成业务快照，提交后不可编辑，也不会随实时业务变化。
              </p>
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
              <label className="field">
                <span>
                  补充说明 <small>最多 500 字</small>
                </span>
                <textarea
                  defaultValue="A-18 耳机报修待分派；晚高峰到店窗口较集中，请优先关注。"
                  disabled={handoverSubmitted}
                />
              </label>
              <Button
                tone="primary"
                icon={Handshake}
                disabled={readonly || handoverSubmitted}
                onClick={onHandover}
              >
                {handoverSubmitted ? "交接已提交" : "提交不可编辑交接"}
              </Button>
            </Surface>
            <Surface>
              <SectionHeading title="接班确认" icon={User} />
              <InlineNotice
                tone={handoverSubmitted ? "warning" : "info"}
                title={handoverSubmitted ? "等待接班人确认" : "交接尚未提交"}
              >
                {handoverSubmitted
                  ? "赵一航将在 21:30 进入确认窗口。"
                  : "提交后接班人可查看冻结快照并确认承接。"}
              </InlineNotice>
              <dl className="detail-list">
                <div>
                  <dt>接班人</dt>
                  <dd>赵一航 · 虚构人物</dd>
                </div>
                <div>
                  <dt>计划班次</dt>
                  <dd>22:00–次日06:00</dd>
                </div>
                <div>
                  <dt>最晚确认</dt>
                  <dd>班次开始后 30 分钟</dd>
                </div>
              </dl>
            </Surface>
          </div>
        )}
      </main>
    </div>
  );
}
