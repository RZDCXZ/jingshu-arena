import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowsLeftRight,
  Buildings,
  CalendarCheck,
  CaretDown,
  ChartLineUp,
  CheckCircle,
  Clock,
  Cube,
  FileText,
  Gauge,
  House,
  ListChecks,
  Package,
  Pulse,
  Receipt,
  Repeat,
  SidebarSimple,
  SlidersHorizontal,
  Storefront,
  User,
  UsersThree,
  WarningCircle,
  Wrench,
} from "@phosphor-icons/react";
import { roleMeta } from "./data.js";
import {
  AuditPage,
  PeopleSchedulePage,
  StoreConfigPage,
  StoreDashboard,
} from "./ManagerPages.jsx";
import {
  ChainConfigPage,
  ChainDashboard,
  HqPeoplePage,
  HqStoreConfigPage,
  StoreComparePage,
} from "./HqPages.jsx";
import {
  InventoryPage,
  OrdersPage,
  RepairsPage,
  ReservationsPage,
  ShiftPage,
  StaffWorkbench,
} from "./StaffPages.jsx";
import {
  CustomerHandoff,
  DataStatusModal,
  DemoChecklistDrawer,
  ExportModal,
  GenericActionModal,
  PublicEntry,
  ResetModal,
  RoleSwitchModal,
  SandboxInit,
  TimeAdvanceModal,
} from "./SharedViews.jsx";
import { Brand, Button, IconButton, StatusPill, Toast } from "./ui.jsx";

const navIcons = {
  workbench: Pulse,
  reservations: CalendarCheck,
  orders: Package,
  repairs: Wrench,
  inventory: Cube,
  shift: ArrowsLeftRight,
  "store-dashboard": Gauge,
  "live-ops": Pulse,
  "manager-inventory": Cube,
  "store-config": SlidersHorizontal,
  "people-schedule": UsersThree,
  "store-audit": FileText,
  "chain-dashboard": Buildings,
  "store-compare": ChartLineUp,
  "chain-config": SlidersHorizontal,
  "hq-store-config": Storefront,
  "hq-people": UsersThree,
  "hq-audit": FileText,
};

const freshnessMeta = {
  live: ["实时更新", "success"],
  polling: ["轮询更新", "info"],
  manual: ["需手动刷新", "warning"],
  readonly: ["只读降级", "warning"],
  stale: ["旧标签失效", "danger"],
  expired: ["沙箱已到期", "danger"],
  rate: ["限流恢复 00:18", "warning"],
};

export function App() {
  const [role, setRole] = useState("staff");
  const [page, setPage] = useState("workbench");
  const [publicView, setPublicView] = useState(false);
  const [customerHandoff, setCustomerHandoff] = useState(false);
  const [initializingRole, setInitializingRole] = useState(null);
  const [overlay, setOverlay] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [reservationStatus, setReservationStatus] = useState("已确认");
  const [orderStates, setOrderStates] = useState({});
  const [repairStates, setRepairStates] = useState({});
  const [handoverSubmitted, setHandoverSubmitted] = useState(false);
  const [demoStep, setDemoStep] = useState(3);
  const [businessTime, setBusinessTime] = useState(
    new URLSearchParams(window.location.search).get("businessTime") || "19:30",
  );
  const [dataMode, setDataMode] = useState("live");
  const [toast, setToast] = useState(null);
  const [timeLoading, setTimeLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [timeResult, setTimeResult] = useState(null);
  const [resetResult, setResetResult] = useState(false);
  const [actionModal, setActionModal] = useState(null);
  const [exportModal, setExportModal] = useState(null);
  const [liveOpsTab, setLiveOpsTab] = useState("reservations");
  const [queueFilter, setQueueFilter] = useState("");
  const blockingReturnFocusRef = useRef(null);

  const meta = roleMeta[role];
  const readonly = dataMode === "readonly";
  const blocking = dataMode === "stale" || dataMode === "expired";
  const [freshnessLabel, freshnessTone] = freshnessMeta[dataMode];
  const blockedBackgroundProps = blocking
    ? { "aria-hidden": true, inert: true }
    : {};

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function navigate(nextPage) {
    setPage(nextPage);
  }

  function createSandbox(nextRole) {
    setPublicView(false);
    setCustomerHandoff(false);
    setInitializingRole(nextRole);
    window.setTimeout(() => {
      setInitializingRole(null);
      if (nextRole === "customer") {
        setCustomerHandoff(true);
        return;
      }
      setRole(nextRole);
      setPage(roleMeta[nextRole].defaultPage);
      setToast({
        tone: "success",
        text: `${roleMeta[nextRole].label}视图已准备完成`,
      });
    }, 900);
  }

  function switchRole(nextRole) {
    setOverlay(null);
    setQueueFilter("");
    if (nextRole === "customer") {
      setCustomerHandoff(true);
      return;
    }
    setRole(nextRole);
    setPage(roleMeta[nextRole].defaultPage);
    setToast({
      tone: "info",
      text: `已切换为${roleMeta[nextRole].persona} · ${roleMeta[nextRole].label}`,
    });
  }

  function handleReservationAction() {
    if (readonly) return;
    const next = { 已确认: "已到店", 已到店: "使用中", 使用中: "已完成" }[
      reservationStatus
    ];
    if (!next) return;
    setReservationStatus(next);
    setDemoStep((step) =>
      Math.max(step, next === "已到店" ? 4 : next === "使用中" ? 5 : step),
    );
    setToast({
      tone: "success",
      text:
        next === "已到店"
          ? "到店已办理，业务事件已记录"
          : next === "使用中"
            ? "预约已进入使用中"
            : "预约已提前结束",
    });
  }

  function handleReservationCancel(reason) {
    if (readonly) return;
    setReservationStatus("已取消");
    setToast({
      tone: "success",
      text: `预约已取消并记录原因：${reason}`,
    });
  }

  function handleOrderAdvance(id) {
    if (readonly) return;
    const current = orderStates[id] || "已模拟支付";
    const next = { 已模拟支付: "制作中", 制作中: "待取", 待取: "已完成" }[
      current
    ];
    if (!next) return;
    setOrderStates((states) => ({ ...states, [id]: next }));
    setDemoStep((step) => Math.max(step, next === "已完成" ? 7 : 6));
    setToast({ tone: "success", text: `订单已推进为“${next}”` });
  }

  function handleOrderCancel(id, reason) {
    if (readonly) return;
    const current = orderStates[id] || "已模拟支付";
    setOrderStates((states) => ({ ...states, [id]: "已取消" }));
    setToast({
      tone: "success",
      text: `${current === "制作中" || current === "待取" ? "库存记为损耗" : "库存预留已释放"} · 已全额模拟退款 · ${reason}`,
    });
  }

  function handleRepairAdvance(id) {
    if (readonly) return;
    const original =
      id === "RPR-260808-0017"
        ? "待分派"
        : id === "RPR-260808-0015"
          ? "已分派"
          : id === "RPR-260808-0012"
            ? "待验证"
            : "处理中";
    const current = repairStates[id] || original;
    const next = {
      待分派: "已分派",
      已分派: "处理中",
      处理中: "待验证",
      待验证: "已关闭",
    }[current];
    if (!next) return;
    setRepairStates((states) => ({ ...states, [id]: next }));
    if (id === "RPR-260808-0017")
      setDemoStep((step) =>
        Math.max(step, next === "已关闭" ? 11 : next === "待验证" ? 10 : 9),
      );
    setToast({
      tone: next === "处理中" ? "warning" : "success",
      text:
        next === "处理中"
          ? "座位已进入维护，预约与库存联动已原子提交"
          : `报修已推进为“${next}”`,
    });
  }

  function handleDemoStep(step) {
    setOverlay(null);
    const targets = {
      3: ["staff", "workbench"],
      4: ["staff", "reservations"],
      6: ["staff", "orders"],
      7: [role, page],
      9: ["staff", "repairs"],
      10: ["manager", "live-ops"],
      11: ["hq", "chain-dashboard"],
      12: [role, page],
    };
    const [targetRole, targetPage] = targets[step] || [role, page];
    setRole(targetRole);
    setPage(targetPage);
    if (step === 7) {
      setTimeResult(null);
      setOverlay("time");
    }
    if (step === 12) {
      setResetResult(false);
      setOverlay("reset");
    }
  }

  function advanceTime(mode, impacts, after) {
    const before = businessTime;
    setTimeLoading(true);
    window.setTimeout(() => {
      setBusinessTime(after);
      setDemoStep((step) => Math.max(step, 8));
      setTimeLoading(false);
      setTimeResult({ after, before, impacts, mode });
      setToast({
        tone: "success",
        text: "业务时间已推进，跨越期限的状态变化已完成",
      });
    }, 850);
  }

  function resetSandbox() {
    setResetLoading(true);
    window.setTimeout(() => {
      setReservationStatus("已确认");
      setOrderStates({});
      setRepairStates({});
      setHandoverSubmitted(false);
      setDemoStep(3);
      setBusinessTime("19:30");
      setDataMode("live");
      setResetLoading(false);
      setResetResult(true);
    }, 900);
  }

  function selectDataMode(mode) {
    setDataMode(mode);
    setOverlay(null);
    if (mode === "rate")
      setToast({
        tone: "warning",
        text: "请求过于频繁，请在 18 秒后重试 · req_7f…a2",
      });
    else
      setToast({
        tone: mode === "stale" || mode === "expired" ? "danger" : "info",
        text: `已切换到“${freshnessMeta[mode][0]}”状态预览`,
      });
  }

  const renderedPage = useMemo(() => {
    if (role === "staff") {
      if (page === "workbench")
        return (
          <StaffWorkbench
            reservationStatus={reservationStatus}
            onReservationAction={handleReservationAction}
            onReservationCancel={handleReservationCancel}
            navigate={navigate}
            queueFilter={queueFilter}
            onQueueFilter={setQueueFilter}
            readonly={readonly}
          />
        );
      if (page === "reservations")
        return (
          <ReservationsPage
            reservationStatus={reservationStatus}
            onReservationAction={handleReservationAction}
            onReservationCancel={handleReservationCancel}
            onDateRange={() => setActionModal("经营日范围")}
            readonly={readonly}
          />
        );
      if (page === "orders")
        return (
          <OrdersPage
            orderStates={orderStates}
            onAdvance={handleOrderAdvance}
            onCancel={handleOrderCancel}
            readonly={readonly}
          />
        );
      if (page === "repairs")
        return (
          <RepairsPage
            repairStates={repairStates}
            onAdvance={handleRepairAdvance}
            onCreate={() => setActionModal("创建座位报修")}
            readonly={readonly}
            role={role}
          />
        );
      if (page === "inventory") return <InventoryPage readonly={readonly} />;
      if (page === "shift")
        return (
          <ShiftPage
            readonly={readonly}
            handoverSubmitted={handoverSubmitted}
            onHandover={() => {
              setHandoverSubmitted(true);
              setToast({ tone: "success", text: "不可编辑交接快照已提交" });
            }}
          />
        );
    }
    if (role === "manager") {
      if (page === "store-dashboard")
        return <StoreDashboard navigate={navigate} />;
      if (page === "live-ops")
        return (
          <ManagerLiveOps
            tab={liveOpsTab}
            onTab={setLiveOpsTab}
            reservationStatus={reservationStatus}
            onReservationAction={handleReservationAction}
            onReservationCancel={handleReservationCancel}
            onOpenAction={setActionModal}
            orderStates={orderStates}
            onOrderAdvance={handleOrderAdvance}
            onOrderCancel={handleOrderCancel}
            repairStates={repairStates}
            onRepairAdvance={handleRepairAdvance}
            readonly={readonly}
          />
        );
      if (page === "manager-inventory")
        return (
          <InventoryPage
            manager
            readonly={readonly}
            onInventoryAction={setActionModal}
          />
        );
      if (page === "store-config")
        return (
          <StoreConfigPage readonly={readonly} onAction={setActionModal} />
        );
      if (page === "people-schedule")
        return (
          <PeopleSchedulePage readonly={readonly} onAction={setActionModal} />
        );
      if (page === "store-audit")
        return (
          <AuditPage
            onExport={() => setExportModal({ hq: false, done: false })}
          />
        );
    }
    if (role === "hq") {
      if (page === "chain-dashboard")
        return (
          <ChainDashboard
            navigate={navigate}
            onExport={() => setExportModal({ hq: true, done: false })}
          />
        );
      if (page === "store-compare") return <StoreComparePage />;
      if (page === "chain-config")
        return (
          <ChainConfigPage readonly={readonly} onAction={setActionModal} />
        );
      if (page === "hq-store-config")
        return (
          <HqStoreConfigPage readonly={readonly} onAction={setActionModal} />
        );
      if (page === "hq-people") return <HqPeoplePage />;
      if (page === "hq-audit")
        return (
          <AuditPage
            hq
            onExport={() => setExportModal({ hq: true, done: false })}
          />
        );
    }
    return null;
  }, [
    role,
    page,
    liveOpsTab,
    reservationStatus,
    orderStates,
    repairStates,
    readonly,
    handoverSubmitted,
    queueFilter,
  ]);

  if (initializingRole) return <SandboxInit role={initializingRole} />;
  if (customerHandoff)
    return (
      <CustomerHandoff
        onBack={() => {
          setCustomerHandoff(false);
          setPublicView(true);
        }}
        onStaff={() => createSandbox("staff")}
      />
    );
  if (publicView)
    return (
      <PublicEntry
        onCreate={createSandbox}
        onExplore={() => {
          setPublicView(false);
          setDataMode("readonly");
          setRole("staff");
          setPage("workbench");
        }}
      />
    );

  return (
    <div
      className={`app-shell role-${role} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${readonly ? "is-readonly" : ""}`}
    >
      <header className="app-topbar" {...blockedBackgroundProps}>
        <div className="topbar-brand">
          <Brand onClick={() => setPublicView(true)} />
          <span className="demo-chip">演示数据</span>
          <span className="business-day">
            经营日&nbsp; 08月08日 06:00–次日05:59
          </span>
        </div>
        <nav className="topbar-tools" aria-label="共享演示工具">
          <button
            aria-label={`主演示 ${Math.max(3, demoStep)}/12`}
            data-tooltip="主演示"
            onClick={() => setOverlay("checklist")}
          >
            <ListChecks />
            <span>主演示</span>
            <strong>{Math.max(3, demoStep)}/12</strong>
          </button>
          <button
            aria-label={`业务时间 ${businessTime}`}
            data-tooltip="业务时间"
            onClick={() => {
              setTimeResult(null);
              setOverlay("time");
            }}
          >
            <Clock />
            <span>业务时间</span>
            <strong>{businessTime}</strong>
          </button>
          <button
            aria-label="切换角色"
            data-tooltip="切换角色"
            onClick={() => setOverlay("role")}
          >
            <Repeat />
            <span>切换角色</span>
          </button>
          <button
            aria-label="重置演示数据"
            data-tooltip="重置演示数据"
            onClick={() => {
              setResetResult(false);
              setOverlay("reset");
            }}
          >
            <Repeat />
            <span>重置演示数据</span>
          </button>
          <button
            className="freshness-button"
            aria-label={freshnessLabel}
            data-tooltip={freshnessLabel}
            onClick={(event) => {
              blockingReturnFocusRef.current = event.currentTarget;
              setOverlay("data");
            }}
          >
            <span className={`freshness-dot tone-${freshnessTone}`} />
            <span>{freshnessLabel}</span>
          </button>
        </nav>
        <button className="profile-menu" onClick={() => setOverlay("role")}>
          <span className="profile-avatar">
            <User weight="fill" />
          </span>
          <span>
            <strong>{meta.persona} · 虚构人物</strong>
            <small>
              {meta.label}｜{meta.store}
            </small>
          </span>
          <CaretDown />
        </button>
      </header>

      {dataMode === "polling" && (
        <div
          className="system-banner banner-info"
          {...blockedBackgroundProps}
        >
          <Pulse />
          实时连接不可用，当前使用轮询更新；业务数据仍以服务端为准。
        </div>
      )}
      {dataMode === "manual" && (
        <div
          className="system-banner banner-warning"
          {...blockedBackgroundProps}
        >
          <WarningCircle />
          自动更新暂不可用。
          <button
            onClick={() => {
              setDataMode("live");
              setToast({ tone: "success", text: "数据已手动刷新" });
            }}
          >
            立即刷新
          </button>
        </div>
      )}
      {dataMode === "readonly" && (
        <div
          className="system-banner banner-warning"
          {...blockedBackgroundProps}
        >
          <WarningCircle />
          当前为只读标准快照，所有写操作均已禁用。
          <button onClick={() => setDataMode("live")}>重试创建可写沙箱</button>
        </div>
      )}

      <div className="app-body" {...blockedBackgroundProps}>
        <aside id="primary-sidebar" className="sidebar">
          <div className="sidebar-context">
            <span className="sidebar-avatar">
              <User weight="fill" />
            </span>
            <span
              className="sidebar-context-copy"
              aria-hidden={sidebarCollapsed}
            >
              <strong>{meta.store}</strong>
              <small>{meta.label}</small>
            </span>
          </div>
          <nav aria-label={`${meta.label}导航`}>
            {meta.nav.map(([id, label]) => {
              const Icon = navIcons[id] || House;
              return (
                <button
                  key={id}
                  className={page === id ? "is-active" : ""}
                  onClick={() => setPage(id)}
                  data-tooltip={label}
                >
                  <Icon weight="regular" />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>
          <div className="sidebar-footer">
            <button
              className="sandbox-life"
              onClick={(event) => {
                blockingReturnFocusRef.current = event.currentTarget;
                setOverlay("data");
              }}
            >
              <Clock />
              <span>
                <small>沙箱剩余</small>
                <strong>23小时18分</strong>
              </span>
            </button>
            <IconButton
              label={sidebarCollapsed ? "展开导航" : "折叠导航"}
              icon={SidebarSimple}
              aria-controls="primary-sidebar"
              aria-expanded={!sidebarCollapsed}
              onClick={() => setSidebarCollapsed((value) => !value)}
            />
          </div>
        </aside>
        <section className="workspace">{renderedPage}</section>
      </div>

      <button
        className="global-statusbar"
        {...blockedBackgroundProps}
        onClick={() =>
          role === "hq"
            ? setPage("store-compare")
            : setPage(role === "manager" ? "manager-inventory" : "inventory")
        }
      >
        <span>
          <Cube />
          <strong>{role === "hq" ? "跨店库存告警" : "库存预警"}</strong>
        </span>
        <StatusPill tone="warning">
          {role === "hq" ? "两店 · 5 项低库存" : "3 项低库存"}
        </StatusPill>
        <ArrowRight />
      </button>

      {overlay === "role" && (
        <RoleSwitchModal
          currentRole={role}
          onClose={() => setOverlay(null)}
          onSwitch={switchRole}
          unsaved={queueFilter.length > 0}
        />
      )}
      {overlay === "checklist" && (
        <DemoChecklistDrawer
          currentStep={demoStep}
          onClose={() => setOverlay(null)}
          onGoToStep={handleDemoStep}
        />
      )}
      {overlay === "time" && (
        <TimeAdvanceModal
          businessTime={businessTime}
          loading={timeLoading}
          result={timeResult}
          scenario={
            new URLSearchParams(window.location.search).get("timeState") ||
            "ready"
          }
          onClose={() => setOverlay(null)}
          onAdvance={advanceTime}
        />
      )}
      {overlay === "reset" && (
        <ResetModal
          error={
            new URLSearchParams(window.location.search).get("resetState") ===
            "error"
          }
          loading={resetLoading}
          result={resetResult}
          onClose={() => {
            setOverlay(null);
            if (resetResult) setPublicView(true);
          }}
          onReset={resetSandbox}
        />
      )}
      {overlay === "data" && (
        <DataStatusModal
          current={dataMode}
          onClose={() => setOverlay(null)}
          onChange={selectDataMode}
        />
      )}
      {actionModal && (
        <GenericActionModal
          action={actionModal}
          onClose={() => setActionModal(null)}
          onConfirm={() => {
            const actionLabel =
              typeof actionModal === "string"
                ? actionModal
                : actionModal.label || "业务操作";
            setToast({
              tone: "success",
              text: `${actionLabel}已保存，服务端结果已确认`,
            });
            setActionModal(null);
          }}
        />
      )}
      {exportModal && (
        <ExportModal
          hq={exportModal.hq}
          done={exportModal.done}
          onClose={() => setExportModal(null)}
          onConfirm={() => {
            setExportModal((value) => ({ ...value, done: true }));
            setDemoStep((step) => Math.max(step, 12));
          }}
        />
      )}
      {dataMode === "stale" && (
        <BlockingState
          title="当前标签的角色上下文已失效"
          body="另一个标签已经切换演示角色。旧角色写操作已停止并记录审计，不能使用缓存继续提交。"
          action="刷新到当前角色"
          onAction={() => setDataMode("live")}
          returnFocusRef={blockingReturnFocusRef}
        />
      )}
      {dataMode === "expired" && (
        <BlockingState
          title="当前沙箱已到期"
          body="沙箱自创建起保留 24 小时。旧沙箱已停止读取和写入，需要创建新的标准种子沙箱。"
          action="创建新沙箱"
          onAction={() => {
            setDataMode("live");
            setPublicView(true);
          }}
          returnFocusRef={blockingReturnFocusRef}
        />
      )}
      {toast && !blocking && (
        <Toast tone={toast.tone} onClose={() => setToast(null)}>
          {toast.text}
        </Toast>
      )}
    </div>
  );
}

function ManagerLiveOps({
  tab,
  onTab,
  reservationStatus,
  onReservationAction,
  onReservationCancel,
  onOpenAction,
  orderStates,
  onOrderAdvance,
  onOrderCancel,
  repairStates,
  onRepairAdvance,
  readonly,
}) {
  return (
    <div className="nested-page">
      <div className="role-subnav">
        <span>现场运营</span>
        <div>
          <button
            className={tab === "reservations" ? "is-active" : ""}
            onClick={() => onTab("reservations")}
          >
            预约
          </button>
          <button
            className={tab === "orders" ? "is-active" : ""}
            onClick={() => onTab("orders")}
          >
            商品订单
          </button>
          <button
            className={tab === "repairs" ? "is-active" : ""}
            onClick={() => onTab("repairs")}
          >
            报修
          </button>
        </div>
        <StatusPill tone="info">店长 · 本店获授权动作</StatusPill>
      </div>
      <div className="nested-page-content">
        {tab === "reservations" && (
          <ReservationsPage
            reservationStatus={reservationStatus}
            onReservationAction={onReservationAction}
            onReservationCancel={onReservationCancel}
            onDateRange={() => onOpenAction("经营日范围")}
            readonly={readonly}
          />
        )}
        {tab === "orders" && (
          <OrdersPage
            orderStates={orderStates}
            onAdvance={onOrderAdvance}
            onCancel={onOrderCancel}
            readonly={readonly}
          />
        )}
        {tab === "repairs" && (
          <RepairsPage
            repairStates={repairStates}
            onAdvance={onRepairAdvance}
            onCreate={() => onOpenAction("创建座位报修")}
            readonly={readonly}
            role="manager"
          />
        )}
      </div>
    </div>
  );
}

function BlockingState({ title, body, action, onAction, returnFocusRef }) {
  const dialogRef = useRef(null);
  const actionRef = useRef(null);

  useEffect(() => {
    const returnTarget = returnFocusRef?.current ?? document.activeElement;
    const dialog = dialogRef.current;
    actionRef.current?.focus();

    function keepFocusInside(event) {
      if (event.key === "Tab" || event.key === "Escape") {
        event.preventDefault();
        actionRef.current?.focus();
      }
    }

    dialog?.addEventListener("keydown", keepFocusInside);
    return () => {
      dialog?.removeEventListener("keydown", keepFocusInside);
      window.setTimeout(() => returnTarget?.focus(), 0);
    };
  }, []);

  return (
    <div
      aria-describedby="blocking-state-description"
      aria-labelledby="blocking-state-title"
      aria-modal="true"
      className="blocking-state"
      ref={dialogRef}
      role="alertdialog"
    >
      <div>
        <WarningCircle weight="duotone" />
        <span className="eyebrow">安全阻断</span>
        <h2 id="blocking-state-title">{title}</h2>
        <p id="blocking-state-description">{body}</p>
        <button
          autoFocus
          className="button button-primary"
          onClick={onAction}
          ref={actionRef}
          type="button"
        >
          <Repeat weight="bold" />
          <span>{action}</span>
        </button>
        <small>
          未提交的表单内容仍保留在当前标签，刷新前请确认是否需要暂存。
        </small>
      </div>
    </div>
  );
}
