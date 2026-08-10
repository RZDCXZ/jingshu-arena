import { useState } from "react";
import {
  ArrowRight,
  Buildings,
  Check,
  ClockClockwise,
  CloudArrowDown,
  Database,
  DeviceMobile,
  FileCsv,
  Hourglass,
  IdentificationCard,
  Info,
  LockKey,
  Monitor,
  Play,
  ShieldCheck,
  Storefront,
  User,
  UsersThree,
  Warning,
} from "@phosphor-icons/react";
import { demoSteps, roleMeta } from "./data.js";
import {
  Brand,
  Button,
  Drawer,
  InlineNotice,
  Modal,
  StatusPill,
} from "./ui.jsx";

function shiftClockTime(value, minutes) {
  const [hours, currentMinutes] = value.split(":").map(Number);
  const shifted = (hours * 60 + currentMinutes + minutes) % (24 * 60);
  return `${String(Math.floor(shifted / 60)).padStart(2, "0")}:${String(shifted % 60).padStart(2, "0")}`;
}

export function PublicEntry({ onCreate, onExplore }) {
  const roles = [
    {
      id: "customer",
      label: "顾客",
      persona: "林澈",
      scope: "浏览三店 · 只管理自己的记录",
      description: "从两小时立即预约开始，体验模拟支付、商品订单与座位报修。",
      icon: DeviceMobile,
      recommended: true,
    },
    {
      id: "staff",
      label: "店员",
      persona: "周宁",
      scope: "棱镜旗舰店",
      description: "办理到店、推进商品履约、处理报修与备件、完成交接。",
      icon: IdentificationCard,
    },
    {
      id: "manager",
      label: "店长",
      persona: "许知远",
      scope: "棱镜旗舰店",
      description: "验证维修、查看单店经营、管理库存、员工排班与配置。",
      icon: Storefront,
    },
    {
      id: "hq",
      label: "总部运营",
      persona: "沈微",
      scope: "固定三店",
      description: "横向比较经营结果、维护连锁配置并导出当前筛选数据。",
      icon: Buildings,
    },
  ];
  return (
    <main className="public-entry">
      <header className="public-header">
        <Brand />
        <div>
          <span className="demo-chip">公开演示</span>
          <button onClick={onExplore}>只读了解</button>
        </div>
      </header>
      <section className="public-hero">
        <div className="public-hero-copy">
          <span className="eyebrow">电竞场馆预约与运营协同演示</span>
          <h1>从一次预约，看见四个角色如何共同经营。</h1>
          <p>
            竞枢把顾客预约、门店履约、设备维修、库存流水与连锁经营证据放进同一个隔离沙箱。无需注册，不发生真实支付。
          </p>
          <div className="public-proof">
            <span>
              <ShieldCheck />
              虚构数据
            </span>
            <span>
              <LockKey />
              无需真实身份
            </span>
            <span>
              <Database />
              每位访客独立沙箱
            </span>
          </div>
        </div>
        <div className="public-story">
          <div className="story-orbit">
            <span>顾客</span>
            <span>店员</span>
            <span>店长</span>
            <span>总部</span>
            <strong>
              同一业务对象
              <br />
              跨角色流转
            </strong>
          </div>
        </div>
      </section>
      <section className="public-role-section">
        <div className="public-section-heading">
          <div>
            <span className="eyebrow">选择一个入口</span>
            <h2>推荐从顾客开始，也可以直接查看管理端。</h2>
          </div>
          <span>选择后才创建可写沙箱</span>
        </div>
        <div className="role-card-grid">
          {roles.map((role) => {
            const Icon = role.icon;
            return (
              <button
                key={role.id}
                className={`public-role-card ${role.recommended ? "is-recommended" : ""}`}
                onClick={() => onCreate(role.id)}
              >
                {role.recommended && (
                  <span className="recommended-label">推荐起点</span>
                )}
                <Icon weight="duotone" />
                <span className="role-number">0{roles.indexOf(role) + 1}</span>
                <h3>{role.label}</h3>
                <p>{role.description}</p>
                <dl>
                  <div>
                    <dt>演示人物</dt>
                    <dd>{role.persona} · 虚构人物</dd>
                  </div>
                  <div>
                    <dt>数据范围</dt>
                    <dd>{role.scope}</dd>
                  </div>
                </dl>
                <span className="role-enter">
                  进入{role.label}演示 <ArrowRight />
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <section className="public-boundary">
        <div>
          <Info weight="fill" />
          <span>
            <strong>这是产品能力演示，不提供真实门店服务。</strong>
            所有门店、人物、订单、金额和经营数据均为合成数据；模拟支付不会扣款，也不连接真实设备。
          </span>
        </div>
        <div>
          <ClockClockwise />
          <span>
            <strong>沙箱保留 24 小时。</strong>
            复制公开地址不会分享当前可写状态，其他访客会获得自己的沙箱。
          </span>
        </div>
      </section>
      <footer className="public-footer">
        <span>竞枢 JINGSHU ARENA · 基础 RC</span>
        <span>人民币 · Asia/Shanghai · 经营日 06:00 开始</span>
      </footer>
    </main>
  );
}

export function SandboxInit({ role, stage = "creating" }) {
  const meta =
    role === "customer"
      ? { label: "顾客", persona: "林澈", store: "可浏览三店" }
      : roleMeta[role];
  return (
    <div className="sandbox-init" role="status" aria-live="polite">
      <Brand />
      <div className="init-spinner">
        <Hourglass weight="duotone" />
      </div>
      <span className="eyebrow">正在创建独立演示世界</span>
      <h1>
        {stage === "ready" ? "沙箱已准备完成" : `正在准备${meta?.label}视图`}
      </h1>
      <p>
        {meta?.persona} · 虚构人物｜{meta?.store}
      </p>
      <ol>
        <li className="is-done">
          <Check />
          创建固定三店与合成业务
        </li>
        <li className={stage === "ready" ? "is-done" : "is-active"}>
          <Check />
          签发角色与门店范围
        </li>
        <li className={stage === "ready" ? "is-done" : ""}>
          <Check />
          载入主演示业务事件
        </li>
      </ol>
      <small>
        页面打开本身不会创建可写数据；只有你刚才的角色选择触发了此操作。
      </small>
    </div>
  );
}

export function RoleSwitchModal({
  currentRole,
  onClose,
  onSwitch,
  unsaved = false,
}) {
  const [pendingRole, setPendingRole] = useState(null);
  const [returnRole, setReturnRole] = useState(null);
  const roles = [
    ["customer", "顾客", "林澈", "可浏览三店，只管理自己的记录", DeviceMobile],
    ["staff", "店员", "周宁", "棱镜旗舰店", IdentificationCard],
    ["manager", "店长", "许知远", "棱镜旗舰店", Storefront],
    ["hq", "总部运营", "沈微", "全部三店", Buildings],
  ];
  const pending = roles.find(([id]) => id === pendingRole);

  function closeOrReturn() {
    if (pendingRole) {
      setReturnRole(pendingRole);
      setPendingRole(null);
      return;
    }
    onClose();
  }

  if (pending) {
    const [id, label, persona, scope, Icon] = pending;
    return (
      <Modal
        title="放弃未提交输入并切换？"
        eyebrow="未提交表单保护"
        onClose={closeOrReturn}
        footer={
          <>
            <Button autoFocus onClick={closeOrReturn}>
              返回继续编辑
            </Button>
            <Button tone="primary" onClick={() => onSwitch(id)}>
              放弃输入并切换到{label}
            </Button>
          </>
        }
      >
        <p className="modal-intro">
          继续切换会放弃“筛选当前队列”中的输入，但不会撤销已经提交的业务数据。
        </p>
        <InlineNotice tone="warning" title={`${label} · ${persona} · 虚构人物`}>
          <Icon weight="duotone" aria-hidden="true" />
          目标范围：{scope}
        </InlineNotice>
      </Modal>
    );
  }

  return (
    <Modal
      title="切换演示角色"
      eyebrow="共享演示壳"
      onClose={closeOrReturn}
      size="large"
    >
      <p className="modal-intro">
        角色由服务端映射到固定演示人物并签发范围；切换后进入新角色首页，已提交的业务数据继续保留。
      </p>
      {unsaved && (
        <InlineNotice tone="warning" title="当前页面有未提交输入">
          继续切换会放弃当前输入，但不会撤销已经提交的业务数据。
        </InlineNotice>
      )}
      <div className="role-switch-grid">
        {roles.map(([id, label, persona, scope, Icon]) => (
          <button
            key={id}
            className={currentRole === id ? "is-current" : ""}
            autoFocus={returnRole === id}
            disabled={currentRole === id}
            onClick={() => {
              if (unsaved) {
                setPendingRole(id);
                return;
              }
              onSwitch(id);
            }}
          >
            <Icon weight="duotone" />
            <span>
              <strong>{label}</strong>
              <small>{persona} · 虚构人物</small>
              <small>{scope}</small>
            </span>
            {currentRole === id ? (
              <StatusPill tone="success">当前角色</StatusPill>
            ) : (
              <ArrowRight />
            )}
          </button>
        ))}
      </div>
      <InlineNotice title="其他标签中的旧角色写操作会立即失效" tone="info">
        旧标签将显示阻断层并要求刷新，不能继续提交。
      </InlineNotice>
    </Modal>
  );
}

export function DemoChecklistDrawer({ currentStep, onClose, onGoToStep }) {
  return (
    <Drawer
      title="主演示清单"
      onClose={onClose}
      width="wide"
      footer={
        <div className="drawer-progress">
          <span>已完成 {Math.max(2, currentStep)} / 12</span>
          <progress value={Math.max(2, currentStep)} max="12" />
        </div>
      }
    >
      <p className="drawer-intro">
        清单状态由业务事件、库存流水和导出/重置证据推导，不支持手工勾选。
      </p>
      <ol className="demo-steps">
        {demoSteps.map(([role, action, evidence], index) => {
          const number = index + 1;
          const done = number < currentStep;
          const current = number === currentStep;
          return (
            <li
              key={number}
              className={done ? "is-done" : current ? "is-current" : ""}
            >
              <span className="step-number">{done ? <Check /> : number}</span>
              <div>
                <span>{role}</span>
                <strong>{action}</strong>
                <small>
                  {done
                    ? evidence
                    : current
                      ? "当前需要完成"
                      : "等待前序业务事件"}
                </small>
              </div>
              {current && (
                <Button
                  tone="primary"
                  icon={Play}
                  onClick={() => onGoToStep(number)}
                >
                  前往当前动作
                </Button>
              )}
            </li>
          );
        })}
      </ol>
    </Drawer>
  );
}

export function TimeAdvanceModal({
  businessTime,
  onClose,
  onAdvance,
  loading = false,
  result = null,
  scenario = "ready",
}) {
  const [mode, setMode] = useState("next-event");
  const [confirming, setConfirming] = useState(false);
  const afterTime =
    mode === "next-event"
      ? shiftClockTime(businessTime, 15)
      : shiftClockTime(businessTime, 30);
  const impacts =
    mode === "next-event"
      ? ["1 条预约进入爽约处理", "1 个到店窗口关闭"]
      : ["2 个待支付订单过期", "1 条预约进入自动完成检查"];

  if (result) {
    return (
      <Modal
        title="业务时间已完整推进"
        eyebrow="事务成功 · 双时间审计已写入"
        onClose={onClose}
        size="time"
        footer={
          <Button tone="primary" onClick={onClose}>
            返回当前角色
          </Button>
        }
      >
        <InlineNotice tone="success" title="时钟与到期对象已一起提交">
          系统按固定顺序完成到期处理；真实 TTL 与安全截止时间保持不变。
        </InlineNotice>
        <div className="time-preview">
          <div>
            <span>推进前</span>
            <strong>{result.before}</strong>
            <small>上海业务时间</small>
          </div>
          <ArrowRight />
          <div>
            <span>推进后</span>
            <strong>{result.after}</strong>
            <small>累计最多推进 24 小时</small>
          </div>
        </div>
        <div className="impact-list">
          <strong>已处理到期对象</strong>
          {result.impacts.map((impact) => (
            <span key={impact}>
              <Check />
              {impact}
            </span>
          ))}
        </div>
      </Modal>
    );
  }

  if (scenario === "limit") {
    return (
      <Modal
        title="已达到本沙箱的推进上限"
        eyebrow="上海业务时钟 · 24 小时累计上限"
        onClose={onClose}
        size="time"
        footer={
          <Button tone="primary" onClick={onClose}>
            知道了
          </Button>
        }
      >
        <InlineNotice tone="warning" title="业务时间与对象保持不变">
          如需从标准故事起点重新演示，请关闭后使用顶栏“重置演示数据”。
        </InlineNotice>
      </Modal>
    );
  }

  return (
    <Modal
      title={confirming ? "确认业务时间与到期影响" : "选择业务时间推进方式"}
      eyebrow="上海业务时钟 · 不属于任何业务角色"
      onClose={onClose}
      size="time"
      footer={
        confirming ? (
          <>
            <Button tone="secondary" onClick={() => setConfirming(false)}>
              返回修改
            </Button>
            <Button
              tone="primary"
              icon={ClockClockwise}
              loading={loading}
              onClick={() => onAdvance(mode, impacts, afterTime)}
            >
              {loading
                ? "正在原子推进…"
                : scenario === "error"
                  ? "使用同一请求安全重试"
                  : "确认并原子推进"}
            </Button>
          </>
        ) : (
          <>
            <Button tone="secondary" onClick={onClose}>
              取消
            </Button>
            <Button
              tone="primary"
              trailing={ArrowRight}
              onClick={() => setConfirming(true)}
            >
              查看推进影响
            </Button>
          </>
        )
      }
    >
      {!confirming && (
        <>
          <p className="time-modal-intro">
            先预览前后时间和到期对象，再进入确认。真实服务器时间、TTL、验证码与安全截止时间不会跟随推进。
          </p>
          <div className="time-current-strip">
            <ClockClockwise />
            <span>
              <small>当前业务时间</small>
              <strong>{businessTime}</strong>
            </span>
            <span>已推进 0 分钟 · 剩余 24 小时</span>
          </div>
          <div className="time-mode-grid">
            <button
              className={mode === "next-event" ? "is-selected" : ""}
              aria-pressed={mode === "next-event"}
              onClick={() => setMode("next-event")}
            >
              <strong>推进到下一事件</strong>
              <small>{businessTime} → {shiftClockTime(businessTime, 15)}</small>
              <span>1 条预约进入爽约处理</span>
            </button>
            <button
              className={mode === "half-hour" ? "is-selected" : ""}
              aria-pressed={mode === "half-hour"}
              onClick={() => setMode("half-hour")}
            >
              <strong>向前推进 30 分钟</strong>
              <small>{businessTime} → {shiftClockTime(businessTime, 30)}</small>
              <span>2 个待支付订单过期</span>
            </button>
          </div>
        </>
      )}
      {confirming && (
        <>
          <div className="time-preview">
            <div>
              <span>推进前</span>
              <strong>{businessTime}</strong>
              <small>2026-08-08 · 上海时间</small>
            </div>
            <ArrowRight />
            <div>
              <span>推进后</span>
              <strong>{afterTime}</strong>
              <small>累计最多推进 24 小时</small>
            </div>
          </div>
          {scenario === "error" ? (
            <InlineNotice tone="danger" title="上次事务已完整回滚">
              业务时间和到期对象均未改变；本次重试会复用同一幂等请求。
            </InlineNotice>
          ) : (
            <InlineNotice tone="warning" title="将处理跨越的业务期限">
              预约/订单超时、爽约、自动完成、考勤缺勤与交接异常会按固定顺序在同一事务中处理；任一步失败则整次推进失败。
            </InlineNotice>
          )}
          <div className="impact-list">
            <strong>本次到期对象</strong>
            {impacts.map((impact) => (
              <span key={impact}>
                <ClockClockwise />
                {impact}
              </span>
            ))}
          </div>
          <p className="modal-footnote">
            业务时间推进不会改变沙箱 24 小时寿命、会话安全、限流或文件清理时间。
          </p>
        </>
      )}
    </Modal>
  );
}

export function ResetModal({
  onClose,
  onReset,
  loading = false,
  result = false,
  error = false,
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (result) {
    return (
      <Modal
        title="全新标准沙箱已就绪"
        eyebrow="重置成功 · 旧沙箱已失效"
        onClose={onClose}
        size="time"
        footer={
          <Button tone="primary" onClick={onClose}>
            回到顾客主演示起点
          </Button>
        }
      >
        <InlineNotice tone="success" title="新沙箱已完整创建并切换">
          当前角色已回到顾客，业务时间累计值和四角色故事均从标准种子重新开始。
        </InlineNotice>
      </Modal>
    );
  }

  return (
    <Modal
      title={
        confirming
          ? "最后确认：创建并切换到全新沙箱"
          : "重置会替换四个角色的整条演示故事"
      }
      eyebrow="不可撤销的演示操作"
      onClose={onClose}
      size="time"
      footer={
        confirming ? (
          <>
            <Button tone="secondary" onClick={() => setConfirming(false)}>
              返回查看影响
            </Button>
            <Button
              tone="danger"
              icon={Warning}
              loading={loading}
              disabled={!confirmed}
              onClick={onReset}
            >
              {loading
                ? "正在创建并校验…"
                : error
                  ? "安全重试创建新沙箱"
                  : "创建新沙箱并使旧沙箱失效"}
            </Button>
          </>
        ) : (
          <>
            <Button tone="secondary" onClick={onClose}>
              保留当前沙箱
            </Button>
            <Button tone="primary" trailing={ArrowRight} onClick={() => setConfirming(true)}>
              继续二次确认
            </Button>
          </>
        )
      }
    >
      {error && confirming ? (
        <InlineNotice tone="danger" title="新沙箱创建失败，当前沙箱已保留">
          重试会复用同一幂等请求；页面不会丢弃当前四角色故事，也不会创建多个替代沙箱。
        </InlineNotice>
      ) : (
        <InlineNotice tone="danger" title="四个角色的当前业务都会失效">
          系统会创建一个全新的标准种子沙箱并切换当前会话；旧沙箱立即封锁并进入异步清理。
        </InlineNotice>
      )}
      {!confirming ? (
        <div className="reset-impact">
          <span><strong>顾客</strong>预约、订单、会员与个人故事进度</span>
          <span><strong>店员</strong>当班队列、考勤与交接故事进度</span>
          <span><strong>店长</strong>门店配置、库存与人员管理故事进度</span>
          <span><strong>总部运营</strong>跨店对比、连锁配置与审计故事进度</span>
        </div>
      ) : (
        <label className="check-row">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>我了解顾客、店员、店长与总部运营的当前数据和故事进度都会被全新标准种子替换。</span>
        </label>
      )}
    </Modal>
  );
}

export function DataStatusModal({ current, onClose, onChange }) {
  const options = [
    [
      "live",
      "实时更新",
      "SSE 正常，收到失效通知后重新获取相关资源。",
      "success",
    ],
    ["polling", "轮询更新", "实时连接不可用，使用短轮询作为正式降级。", "info"],
    ["manual", "需手动刷新", "自动更新暂不可用，保留手动刷新入口。", "warning"],
    ["readonly", "只读降级", "标准种子快照可读，所有写操作禁用。", "warning"],
    ["stale", "旧标签失效", "其他标签已切换角色，阻断当前标签写入。", "danger"],
    ["expired", "沙箱已到期", "旧沙箱立即停止读写，需要创建新沙箱。", "danger"],
    [
      "rate",
      "限流恢复",
      "显示稳定中文信息、请求关联 ID 与可重试倒计时。",
      "warning",
    ],
  ];
  return (
    <Modal
      title="请求与刷新状态预览"
      eyebrow="共享演示壳 · 系统状态"
      onClose={onClose}
      size="large"
    >
      <p className="modal-intro">
        这些状态用于检查异常恢复设计；选择后会应用到当前原型。
      </p>
      <div className="state-option-list">
        {options.map(([id, label, description, tone]) => (
          <button
            key={id}
            className={current === id ? "is-current" : ""}
            onClick={() => onChange(id)}
          >
            <span className={`state-signal signal-${tone}`} />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
            {current === id ? (
              <StatusPill tone="success">当前</StatusPill>
            ) : (
              <ArrowRight />
            )}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function resolveActionModal(action) {
  const actionLabel =
    typeof action === "string" ? action : action?.label || "业务操作";

  if (actionLabel === "经营日范围") {
    return {
      eyebrow: "经营日筛选",
      title: actionLabel,
      noticeTitle: "经营日口径",
      noticeBody:
        "经营日从每日 06:00 开始，范围变化只影响当前列表与导出，不改变业务数据。",
      confirmLabel: "应用范围",
      fields: [
        { label: "开始经营日", value: "2026-08-08", type: "date" },
        { label: "结束经营日", value: "2026-08-08", type: "date" },
        {
          label: "时间边界",
          value: "每日 06:00–次日 05:59；当前选择包含 1 个经营日。",
          multiline: true,
          full: true,
          readOnly: true,
        },
      ],
    };
  }

  if (actionLabel === "创建座位报修") {
    return {
      eyebrow: "现场报修",
      title: actionLabel,
      noticeTitle: "座位影响范围",
      noticeBody:
        "创建后会关联当前座位、受影响预约与可能使用的维修备件，并进入待分派队列。",
      confirmLabel: "创建报修",
      fields: [
        {
          label: "座位",
          value: "竞技区 A-18",
          options: ["竞技区 A-18", "竞技区 A-19", "竞技区 B-07"],
        },
        {
          label: "优先级",
          value: "紧急",
          options: ["普通", "较高", "紧急"],
        },
        {
          label: "问题说明（必填，最多 500 字）",
          value: "耳机右声道无声，已影响当前座位体验。",
          multiline: true,
          full: true,
        },
      ],
    };
  }

  if (action?.kind === "inventory-count") {
    return {
      eyebrow: "统一库存账本",
      title: actionLabel,
      noticeTitle: "盘点只追加更正流水",
      noticeBody:
        "请录入现场实际数量；提交前会预览账面差额，提交后保留原账面事实并新增一条盘点更正流水。",
      confirmLabel: "提交盘点",
      fields: [
        {
          label: "库存项目",
          value: action.item || "外设清洁套装",
          options: ["外设清洁套装", "替换耳机", "鼠标滚轮组件"],
        },
        {
          label: "当前账面库存",
          value: `${action.book ?? 9}`,
          readOnly: true,
        },
        {
          label: "实际数量",
          value: `${action.actual ?? 11}`,
          type: "number",
        },
        {
          label: "差额与流水预览",
          value: `账面 ${action.book ?? 9} → 实际 ${action.actual ?? 11}；将追加账面 +2。`,
          readOnly: true,
        },
        {
          label: "盘点原因（必填，最多 200 字）",
          value: "闭店前例行盘点，已由店长复核现场数量。",
          multiline: true,
          full: true,
        },
      ],
    };
  }

  if (action?.kind === "inventory-receipt") {
    return {
      eyebrow: "统一库存账本",
      title: actionLabel,
      noticeTitle: "手工入库范围",
      noticeBody:
        "本次动作只增加所选库存项目的账面库存，不创建供应商或采购订单；提交后会生成不可编辑的入库流水。",
      confirmLabel: "确认入库",
      fields: [
        {
          label: "库存项目",
          value: action.item || "替换耳机",
          options: ["替换耳机", "显示线", "鼠标滚轮组件", "外设清洁套装"],
        },
        { label: "入库数量", value: `${action.quantity ?? 6}`, type: "number" },
        {
          label: "入库依据",
          value: "线下到货登记",
          options: ["线下到货登记", "门店补货", "演示种子补充"],
        },
        {
          label: "关联单号",
          value: "RCV-260808-0007",
        },
        {
          label: "入库说明（最多 200 字）",
          value: "晚班收到维修备件，数量与到货清单一致。",
          multiline: true,
          full: true,
        },
      ],
    };
  }

  if (action?.kind === "inventory-compensation") {
    return {
      eyebrow: "统一库存账本",
      title: actionLabel,
      noticeTitle: "错误操作只通过新流水修正",
      noticeBody:
        "本次补偿不会编辑或删除原流水；可以关联原操作，也可以在业务原因中清楚说明原操作。",
      confirmLabel: "创建补偿",
      fields: [
        {
          label: "库存项目",
          value: action.item || "替换耳机",
          options: ["替换耳机", "显示线", "维修鼠标", "外设清洁套装"],
        },
        {
          label: "当前账面库存",
          value: "7",
          readOnly: true,
        },
        {
          label: "补偿差额",
          value: `${action.delta ?? -1}`,
          type: "number",
        },
        {
          label: "关联原流水（可选）",
          value: action.original || "不关联，在原因中说明原操作",
          options: [
            action.original || "RCV-260808-0007",
            "STK-260808-0086",
            "不关联，在原因中说明原操作",
          ],
        },
        {
          label: "补偿原因（必填，最多 200 字）",
          value: "原入库多计一件，关联原入库流水进行补偿。",
          multiline: true,
          full: true,
        },
      ],
    };
  }

  if (action?.kind === "manager-store-profile") {
    return {
      eyebrow: "门店基本资料",
      title: actionLabel,
      noticeTitle: "资料变更范围",
      noticeBody:
        "本次保存只更新棱镜旗舰店的展示名称、虚构城市与公开演示介绍，不影响营业时间、预约或历史审计。",
      confirmLabel: "保存门店资料",
      fields: [
        { label: "门店工作名称", value: action.name || "棱镜旗舰店" },
        { label: "虚构城市", value: action.city || "栖光市（虚构）" },
        {
          label: "演示介绍（最多 500 字）",
          value:
            action.description ||
            "96 座、24 小时运营的主演示门店，用于展示跨角色预约、订单与维修联动。",
          multiline: true,
          full: true,
        },
      ],
    };
  }

  if (action?.kind === "manager-business-hours") {
    return {
      eyebrow: "门店营业规则",
      title: actionLabel,
      noticeTitle: "仅影响未来业务",
      noticeBody:
        "新营业规则从所选经营日开始生效；既有预约、经营日归属与历史价格快照保持不变。",
      confirmLabel: "创建营业规则",
      fields: [
        {
          label: "适用日期",
          value: "周一至周日",
          options: ["周一至周日", "工作日", "周末"],
        },
        { label: "开始营业", value: "00:00", type: "time" },
        { label: "结束营业", value: "23:59", type: "time" },
        { label: "生效经营日", value: "2026-08-09", type: "date" },
        {
          label: "规则说明",
          value: "24 小时营业；经营日边界仍为每日 06:00。",
          multiline: true,
          full: true,
        },
      ],
    };
  }

  if (action?.kind === "manager-seat") {
    const editing = action.mode === "edit";
    return {
      eyebrow: "区域与座位",
      title: actionLabel,
      noticeTitle: editing ? "依赖检查" : "门店内唯一编号",
      noticeBody: editing
        ? `座位 ${action.id} 当前关联 ${action.upcoming || "0 条有效预约"}，报修依赖为 ${action.repair || "—"}；停用前必须先处理依赖。`
        : "创建前会检查座位编号在棱镜旗舰店内唯一；机型规格来自总部机型档案。",
      confirmLabel: editing ? "保存座位" : "创建座位",
      fields: [
        {
          label: "所属区域",
          value: action.area || "竞技区",
          options: ["竞技区", "旗舰区", "训练区"],
        },
        { label: "座位编号", value: action.id || "C-08" },
        {
          label: "机型档案",
          value: action.profile || "竞技型",
          options: ["竞技型", "旗舰型", "标准型"],
        },
        {
          label: "运营状态",
          value: action.state || "正常",
          options: ["正常", "维护中", "停用"],
        },
        ...(editing
          ? [
              {
                label: "当前业务依赖",
                value: `${action.upcoming || "0 条有效预约"}；报修 ${action.repair || "—"}`,
                readOnly: true,
                full: true,
              },
            ]
          : []),
      ],
    };
  }

  if (action?.kind === "manager-price") {
    return {
      eyebrow: "价格计划",
      title: actionLabel,
      noticeTitle: "价格快照不会追溯",
      noticeBody:
        "新版本只用于生效后的新预约；已有预约继续使用创建时保存的半小时价格快照。",
      confirmLabel: "创建价格版本",
      fields: [
        { label: "版本名称", value: action.name || "晚高峰价格 v5" },
        {
          label: "适用范围",
          value: "竞技区",
          options: ["全部运营座位", "竞技区", "旗舰区"],
        },
        {
          label: "适用日期",
          value: "周五至周日",
          options: ["每天", "工作日", "周五至周日"],
        },
        { label: "适用时段", value: "18:00–23:00" },
        { label: "半小时价格", value: "7.50", type: "number" },
        {
          label: "生效时间",
          value: "2026-08-09T06:00",
          type: "datetime-local",
        },
      ],
    };
  }

  if (action?.kind === "manager-store-product") {
    const editing = action.mode === "edit";
    return {
      eyebrow: "门店商品配置",
      title: actionLabel,
      noticeTitle: "售价与库存分开管理",
      noticeBody:
        "这里配置本店售价、上架状态和低库存阈值；保存不会直接修改库存余额，也不会追溯历史订单快照。",
      confirmLabel: editing ? "保存商品配置" : "创建商品配置",
      fields: [
        {
          label: "商品资料",
          value: action.name || "零点气泡水",
          options: ["脉冲能量饮料", "折线薯片", "零点气泡水", "外设清洁套装"],
        },
        {
          label: "本店售价",
          value: `${action.price || "¥6.00"}`.replace("¥", ""),
          type: "number",
        },
        {
          label: "销售状态",
          value: action.listed || "已上架",
          options: ["已上架", "已下架"],
        },
        {
          label: "低库存阈值",
          value: `${action.threshold ?? 10}`,
          type: "number",
        },
        ...(editing
          ? [
              {
                label: "当前可用库存",
                value: `${action.available ?? 0}（只读，需通过库存业务动作变更）`,
                readOnly: true,
                full: true,
              },
            ]
          : []),
      ],
    };
  }

  if (action?.kind === "manager-employee") {
    return {
      eyebrow: "员工管理",
      title: actionLabel,
      noticeTitle: "仅可创建背景员工",
      noticeBody:
        "主演示人物受保护且不可替换；新员工固定归属棱镜旗舰店，可用于未来排班与覆盖演示。",
      confirmLabel: "创建背景员工",
      fields: [
        { label: "员工工作名", value: "背景员工 17" },
        { label: "员工编号", value: "EMP-017" },
        {
          label: "角色",
          value: "店员",
          options: ["店员", "店长"],
        },
        {
          label: "任职状态",
          value: "在职",
          options: ["在职", "暂不排班"],
        },
        {
          label: "所属门店",
          value: "棱镜旗舰店（固定，不跨店任职）",
          readOnly: true,
          full: true,
        },
      ],
    };
  }

  if (action?.kind === "manager-shift") {
    return {
      eyebrow: "未来排班",
      title: actionLabel,
      noticeTitle: "半小时粒度与覆盖检查",
      noticeBody:
        "班次需为 4–12 小时并可跨午夜；保存后会重新计算对应半小时区间的在班覆盖告警。",
      confirmLabel: "创建未来班次",
      fields: [
        {
          label: "排班员工",
          value: "背景员工 17",
          options: ["背景员工 17", "苏雨", "陈昊", "赵一航"],
        },
        { label: "班次日期", value: "2026-08-09", type: "date" },
        { label: "开始时间", value: "18:00", type: "time" },
        { label: "结束时间（可跨午夜）", value: "02:00", type: "time" },
        {
          label: "覆盖预览",
          value: "保存后 00:00–02:00 将由 2 人提升至 3 人，覆盖告警解除。",
          readOnly: true,
          full: true,
        },
      ],
    };
  }

  if (action?.kind === "attendance-correction") {
    return {
      eyebrow: "考勤更正",
      title: actionLabel,
      noticeTitle: "更正只追加，不覆盖原始事实",
      noticeBody:
        "原始签到记录会继续保留；本次提交新增一条带操作人、时间与原因的更正记录。",
      confirmLabel: "提交考勤更正",
      fields: [
        {
          label: "员工",
          value: action.employee || "苏雨",
          options: ["苏雨", "背景员工 07", "陈昊", "赵一航"],
        },
        {
          label: "原始考勤事实",
          value: action.original || "2026-08-08 16:12 签到 · 原班次 16:00",
          readOnly: true,
        },
        {
          label: "更正结果",
          value: "已核准迟到",
          options: ["已核准迟到", "按时到岗", "批准缺勤", "撤销异常"],
        },
        {
          label: "更正生效时间",
          value: "2026-08-08T16:12",
          type: "datetime-local",
        },
        {
          label: "更正原因（必填，最多 200 字）",
          value: "已核对当班记录，确认员工实际到岗时间与原始签到一致。",
          multiline: true,
          full: true,
        },
      ],
    };
  }

  if (action?.kind === "absence-record") {
    return {
      eyebrow: "考勤原始记录",
      title: actionLabel,
      noticeTitle: "原始事实保持只读",
      noticeBody:
        "该员工在签到窗口结束后仍无模拟签到记录，系统已按业务时间生成缺勤异常。",
      confirmLabel: "知道了",
      dismissOnly: true,
      fields: [
        {
          label: "员工",
          value: action.employee || "背景员工 07",
          readOnly: true,
        },
        { label: "计划班次", value: "2026-08-08 18:00–02:00", readOnly: true },
        { label: "签到窗口", value: "17:30–18:30", readOnly: true },
        {
          label: "异常判定",
          value: "19:00 仍无模拟签到，记录为缺勤",
          readOnly: true,
        },
        {
          label: "后续处理",
          value:
            "如需修正，请从考勤异常列表追加更正记录；原始缺勤事实不会删除。",
          multiline: true,
          full: true,
          readOnly: true,
        },
      ],
    };
  }

  if (action?.kind === "handover-snapshot") {
    return {
      eyebrow: "不可编辑交接快照",
      title: actionLabel,
      noticeTitle: "快照与实时业务分离",
      noticeBody:
        "快照在提交时冻结，此后不会随预约、订单、报修或库存状态变化；当前仅可查看。",
      confirmLabel: "知道了",
      dismissOnly: true,
      fields: [
        {
          label: "交班人",
          value: action.employee || "周宁 · 虚构人物",
          readOnly: true,
        },
        { label: "班次", value: "2026-08-08 18:00–02:00", readOnly: true },
        { label: "未完成预约", value: "5", readOnly: true },
        { label: "商品订单 / 报修", value: "4 / 3", readOnly: true },
        { label: "库存告警", value: "3 项低库存", readOnly: true },
        {
          label: "交接说明",
          value: "A-18 耳机报修待分派；晚高峰到店窗口较集中，请优先关注。",
          multiline: true,
          full: true,
          readOnly: true,
        },
      ],
    };
  }

  if (action?.kind === "machine-profile") {
    const editing = action.mode === "edit";
    return {
      eyebrow: "机型档案",
      title: actionLabel,
      noticeTitle: "总部统一体验档案",
      noticeBody:
        "机型档案统一描述座位体验规格，门店座位只引用档案；本次保存不会追溯修改历史预约。",
      confirmLabel: editing ? "保存机型档案" : "创建机型档案",
      fields: [
        { label: "档案名称", value: action.name || "新机型档案" },
        {
          label: "体验规格",
          value: action.spec || "2K / 240Hz",
        },
        {
          label: "体验描述",
          value: action.description || "强调高刷新、低延迟与沉浸体验。",
          multiline: true,
          full: true,
        },
        {
          label: "当前引用",
          value: action.seats || "尚未分配座位",
          readOnly: true,
          full: true,
        },
      ],
    };
  }

  if (action?.kind === "catalog-product") {
    const editing = action.mode === "edit";
    return {
      eyebrow: "连锁商品资料",
      title: actionLabel,
      noticeTitle: "总部资料范围",
      noticeBody:
        "总部维护商品名称、分类与可用门店范围；售价、上架状态和库存数量仍由各门店管理。",
      confirmLabel: editing ? "保存商品资料" : "创建商品资料",
      fields: [
        { label: "商品名称", value: action.name || "新商品资料" },
        {
          label: "分类",
          value: action.category || "饮品",
          options: ["饮品", "零食", "外设用品"],
        },
        {
          label: "可用门店范围",
          value: action.scope || "三店可用",
          options: ["三店可用", "仅旗舰店", "旗舰店与新店"],
        },
        {
          label: "资料状态",
          value: action.state || "正常",
          options: ["正常", "停用"],
        },
        {
          label: "资料说明",
          value: "用于连锁商品目录展示，门店可在授权范围内配置售价与上架状态。",
          multiline: true,
          full: true,
        },
      ],
    };
  }

  if (action?.kind === "store-profile") {
    return {
      eyebrow: "门店展示资料",
      title: actionLabel,
      noticeTitle: "未来配置",
      noticeBody: `本次保存只更新 ${action.store} 的展示资料与公开说明，不改变既有预约和历史快照。`,
      confirmLabel: "保存未来配置",
      fields: [
        { label: "生效门店", value: action.store, readOnly: true },
        { label: "生效时间", value: "2026-08-09 06:00" },
        {
          label: "变更摘要",
          value: "更新门店展示名称、虚构城市与公开演示说明。",
          multiline: true,
          full: true,
        },
      ],
    };
  }

  if (action?.kind === "store-future-config") {
    const editing = action.mode === "edit";
    const item = action.item || {};
    const common = {
      eyebrow: `${action.store} · ${action.scopeLabel}`,
      title: actionLabel,
      noticeTitle: "未来业务配置",
      noticeBody: `该变更只作用于 ${action.store} 的${action.scopeLabel}，历史预约、价格快照与库存流水保持不变。`,
      confirmLabel: editing ? "保存配置" : "创建配置",
    };

    if (action.scope === "areas") {
      return {
        ...common,
        fields: [
          { label: "区域名称", value: item.name || "新竞技区域" },
          { label: "计划座位数", value: item.detail || "24 个座位" },
          { label: "运营状态", value: item.attention ? "需关注" : "启用" },
          { label: "生效时间", value: "2026-08-09 06:00" },
          {
            label: "配置说明",
            value: "座位编号将在保存后按区域规则生成，既有座位不受影响。",
            multiline: true,
            full: true,
          },
        ],
      };
    }

    if (action.scope === "pricing") {
      return {
        ...common,
        fields: [
          { label: "版本名称", value: item.name || "价格版本 v5" },
          { label: "半小时价格", value: "¥7.50" },
          { label: "生效时间", value: "2026-08-09 06:00" },
          { label: "适用范围", value: `${action.store} · 全部运营座位` },
          {
            label: "版本说明",
            value: "仅用于生效后的新预约；已有预约继续使用创建时的价格快照。",
            multiline: true,
            full: true,
          },
        ],
      };
    }

    return {
      ...common,
      fields: [
        { label: "商品资料", value: item.name || "新商品资料" },
        { label: "门店范围", value: action.store, readOnly: true },
        { label: "销售状态", value: item.attention ? "需关注" : "已上架" },
        { label: "低库存阈值", value: "10" },
        {
          label: "配置说明",
          value: "只配置本店销售范围与告警阈值，不直接修改库存余额。",
          multiline: true,
          full: true,
        },
      ],
    };
  }

  return {
    eyebrow: "业务操作",
    title: actionLabel,
    noticeTitle: "当前入口没有可编辑表单",
    noticeBody:
      "该入口尚未声明业务专用字段，为避免提交错误信息，本原型不会展示通用配置表单。",
    confirmLabel: "返回",
    dismissOnly: true,
    fields: [
      {
        label: "未声明操作",
        value: actionLabel,
        readOnly: true,
        full: true,
      },
    ],
  };
}

export function GenericActionModal({ action, onClose, onConfirm }) {
  const modal = resolveActionModal(action);
  return (
    <Modal
      title={modal.title}
      eyebrow={modal.eyebrow}
      onClose={onClose}
      footer={
        modal.dismissOnly ? (
          <Button tone="primary" onClick={onClose}>
            {modal.confirmLabel}
          </Button>
        ) : (
          <>
            <Button tone="secondary" onClick={onClose}>
              取消
            </Button>
            <Button tone="primary" onClick={onConfirm}>
              {modal.confirmLabel}
            </Button>
          </>
        )
      }
    >
      <InlineNotice title={modal.noticeTitle} tone="info">
        {modal.noticeBody}
      </InlineNotice>
      <div className="form-grid modal-form">
        {modal.fields.map((field, index) => (
          <label
            className={`field ${field.full ? "field-full" : ""}`}
            key={`${field.label}-${index}`}
          >
            <span>{field.label}</span>
            {field.options ? (
              <select defaultValue={field.value} disabled={field.readOnly}>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.multiline ? (
              <textarea defaultValue={field.value} readOnly={field.readOnly} />
            ) : (
              <input
                type={field.type || "text"}
                defaultValue={field.value}
                readOnly={field.readOnly}
              />
            )}
          </label>
        ))}
      </div>
    </Modal>
  );
}

export function ExportModal({ hq = false, onClose, onConfirm, done = false }) {
  return (
    <Modal
      title={done ? "CSV 已生成" : "导出当前筛选 CSV"}
      eyebrow="UTF-8 BOM · 当前排序"
      onClose={onClose}
      footer={
        done ? (
          <Button tone="primary" icon={CloudArrowDown} onClick={onClose}>
            完成
          </Button>
        ) : (
          <>
            <Button tone="secondary" onClick={onClose}>
              取消
            </Button>
            <Button tone="primary" icon={FileCsv} onClick={onConfirm}>
              生成 CSV
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="export-success">
          <FileCsv weight="duotone" />
          <h3>导出证据已写入审计</h3>
          <p>文件：jingshu-audit-20260808.csv</p>
          <span>演示数据 · 不包含真实个人信息</span>
        </div>
      ) : (
        <>
          <div className="export-summary">
            <div>
              <span>数据类型</span>
              <strong>审计事件</strong>
            </div>
            <div>
              <span>门店范围</span>
              <strong>{hq ? "全部三店" : "棱镜旗舰店"}</strong>
            </div>
            <div>
              <span>经营日范围</span>
              <strong>08月08日 06:00–次日05:59</strong>
            </div>
            <div>
              <span>预计行数</span>
              <strong>{hq ? "148" : "62"} 行</strong>
            </div>
          </div>
          <InlineNotice title="导出使用当前筛选与排序" tone="info">
            结果是带 UTF-8 BOM 的 CSV，不包含
            Secret、完整请求体、原始图片或未授权门店数据。
          </InlineNotice>
        </>
      )}
    </Modal>
  );
}

export function CustomerHandoff({ onBack, onStaff }) {
  return (
    <main className="handoff-page">
      <header>
        <Brand onClick={onBack} />
        <span className="demo-chip">顾客 Web H5 衔接</span>
      </header>
      <section>
        <DeviceMobile weight="duotone" />
        <span className="eyebrow">管理端设计包边界</span>
        <h1>顾客侧流程由小程序与 H5 设计系统承接。</h1>
        <p>
          本次交付聚焦管理端。顾客在同一 Web
          沙箱中完成预约、模拟支付（不扣款）、商品订单与报修后，可切换到店员继续主演示。
        </p>
        <div className="handoff-actions">
          <Button tone="secondary" onClick={onBack}>
            返回角色入口
          </Button>
          <Button tone="primary" icon={Monitor} onClick={onStaff}>
            以店员继续
          </Button>
        </div>
      </section>
    </main>
  );
}
