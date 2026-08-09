"use client";

import {
  ArrowRight,
  CheckCircle,
  MagnifyingGlass,
  Package,
  Pulse,
  SidebarSimple,
  User,
  Wrench,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";

const queueRows = [
  {
    arrival: "到店窗口 19:10–19:45",
    clock: "19:30",
    customer: "林澈 · 虚构人物",
    id: "reservation-lin-che",
    seat: "竞技区 A-18",
    status: "已确认",
    time: "19:30–21:30",
  },
  {
    arrival: "到店窗口 19:20–19:55",
    clock: "19:32",
    customer: "陆远 · 虚构人物",
    id: "reservation-lu-yuan",
    seat: "竞技区 B-07",
    status: "已确认",
    time: "19:40–21:40",
  },
  {
    arrival: "到店窗口 19:30–20:05",
    clock: "19:38",
    customer: "陈牧 · 虚构人物",
    id: "reservation-chen-mu",
    seat: "竞技区 C-12",
    status: "已确认",
    time: "19:50–21:50",
  },
  {
    arrival: "到店窗口 19:40–20:15",
    clock: "19:45",
    customer: "顾辰 · 虚构人物",
    id: "reservation-gu-chen",
    seat: "竞技区 A-05",
    status: "已确认",
    time: "20:00–22:00",
  },
] as const;

const waitingRows = [
  {
    clock: "19:20",
    customer: "耳机右声道无声",
    id: "repair-headset-a18",
    kind: "异常",
    note: "报修",
    seat: "竞技区 A-18",
    status: "待分派",
    tone: "danger",
  },
  {
    clock: "19:15",
    customer: "周屿 · 虚构人物",
    id: "reservation-zhou-yu",
    kind: "预约",
    note: "已到店待开始",
    seat: "竞技区 B-03",
    status: "已到店",
    tone: "warning",
  },
  {
    clock: "19:07",
    customer: "许泽 · 虚构人物",
    id: "reservation-xu-ze",
    kind: "预约",
    note: "已到店待开始",
    seat: "竞技区 C-01",
    status: "已到店",
    tone: "warning",
  },
] as const;

export function RoleWorkbench({
  filter,
  inspectorOpen,
  onFilter,
  onInspector,
  onPreviewAction,
}: {
  filter: string;
  inspectorOpen: boolean;
  onFilter: (value: string) => void;
  onInspector: (value: boolean) => void;
  onPreviewAction: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string>(queueRows[0]?.id ?? "");
  const normalizedFilter = filter.trim().toLocaleLowerCase("zh-CN");
  const visibleRows = useMemo(() => {
    if (!normalizedFilter) return queueRows;
    return queueRows.filter((row) =>
      `${row.customer} ${row.seat} ${row.status}`
        .toLocaleLowerCase("zh-CN")
        .includes(normalizedFilter),
    );
  }, [normalizedFilter]);
  const visibleWaitingRows = useMemo(() => {
    if (!normalizedFilter) return waitingRows;
    return waitingRows.filter((row) =>
      `${row.kind} ${row.customer} ${row.seat} ${row.status} ${row.note}`
        .toLocaleLowerCase("zh-CN")
        .includes(normalizedFilter),
    );
  }, [normalizedFilter]);
  const selected =
    queueRows.find((row) => row.id === selectedId) ?? queueRows[0];
  const currentRow = visibleRows.find((row) => row.id === queueRows[0]?.id);
  const upcomingRows = visibleRows.filter((row) => row.id !== queueRows[0]?.id);

  function openCurrentTask() {
    setSelectedId(queueRows[0]?.id ?? "");
    onPreviewAction();
  }

  return (
    <div className={`role-workbench ${inspectorOpen ? "has-inspector" : ""}`}>
      <main className="role-workbench-main">
        <div className="role-page-title">
          <div>
            <span>
              <Pulse weight="duotone" />
            </span>
            <h1>现场脉冲</h1>
          </div>
          <div className="role-page-tools">
            <label>
              <MagnifyingGlass />
              <input
                aria-label="筛选当前队列"
                onChange={(event) => onFilter(event.target.value)}
                placeholder="筛选当前队列"
                type="search"
                value={filter}
              />
            </label>
            {!inspectorOpen ? (
              <button
                aria-label="展开当前对象"
                onClick={() => onInspector(true)}
                type="button"
              >
                <SidebarSimple />
                <span>展开详情</span>
              </button>
            ) : null}
          </div>
        </div>
        <section
          className="role-queue-section"
          aria-labelledby="current-queue-title"
        >
          <div className="role-section-heading">
            <h2 id="current-queue-title">现在</h2>
            <span>界面参考数据 · 业务写入待接线</span>
          </div>
          {currentRow ? (
            <div className="role-queue-list">
              <button
                className="role-queue-row is-primary"
                onClick={openCurrentTask}
                type="button"
              >
                <time>{currentRow.clock}</time>
                <span className="role-row-person">
                  <strong>
                    <User weight="fill" />
                    {currentRow.customer}
                  </strong>
                  <small>{currentRow.status}</small>
                </span>
                <span className="role-row-detail is-schedule">
                  <span>{currentRow.time}</span>
                  <small>{currentRow.arrival}</small>
                </span>
                <span className="role-row-detail is-seat">
                  <small>竞技区</small>
                  <strong>{currentRow.seat.replace("竞技区 ", "")}</strong>
                </span>
                <span className="role-row-detail is-amount">
                  <small>模拟金额</small>
                  <strong>¥30.00</strong>
                </span>
                <span className="role-primary-action">
                  查看任务
                  <ArrowRight />
                </span>
              </button>
            </div>
          ) : (
            <p className="role-inline-empty">“现在”没有匹配结果。</p>
          )}
        </section>
        <section
          className="role-queue-section"
          aria-labelledby="upcoming-queue-title"
        >
          <div className="role-section-heading">
            <h2 id="upcoming-queue-title">接下来 30 分钟</h2>
            <span>{upcomingRows.length}</span>
          </div>
          {upcomingRows.length ? (
            <div className="role-queue-list">
              {upcomingRows.map((row) => (
                <button
                  className="role-queue-row"
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  type="button"
                >
                  <time>{row.clock}</time>
                  <span className="role-row-person">
                    <strong>
                      <User weight="fill" />
                      {row.customer}
                    </strong>
                  </span>
                  <span className="role-row-detail">
                    <span>{row.time}</span>
                    <small>{row.arrival}</small>
                  </span>
                  <span className="role-row-detail">
                    <small>竞技区</small>
                    <strong>{row.seat.replace("竞技区 ", "")}</strong>
                  </span>
                  <span className="role-status-pill">{row.status}</span>
                  <strong>¥30.00</strong>
                </button>
              ))}
            </div>
          ) : (
            <p className="role-inline-empty">接下来 30 分钟没有匹配结果。</p>
          )}
        </section>
        <section
          className="role-queue-section"
          aria-labelledby="waiting-queue-title"
        >
          <div className="role-section-heading">
            <h2 id="waiting-queue-title">等待回执</h2>
            <span>{visibleWaitingRows.length}</span>
          </div>
          {visibleWaitingRows.length ? (
            <div className="role-waiting-list">
              {visibleWaitingRows.map((row) => (
                <button
                  key={row.id}
                  onClick={() =>
                    onFilter(
                      row.kind === "异常"
                        ? "报修"
                        : (row.customer.split(" ")[0] ?? ""),
                    )
                  }
                  type="button"
                >
                  <span className={`role-wait-kind is-${row.tone}`}>
                    {row.kind}
                  </span>
                  <time>{row.clock}</time>
                  <strong>
                    {row.customer} · {row.seat}
                  </strong>
                  <span className="role-status-pill">{row.status}</span>
                  <span>{row.note}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
        {visibleRows.length === 0 && visibleWaitingRows.length === 0 ? (
          <div className="role-empty-state">
            <MagnifyingGlass />
            <strong>当前筛选没有待处理事项</strong>
            <button onClick={() => onFilter("")} type="button">
              清除筛选
            </button>
          </div>
        ) : null}
        <section className="role-summary-stack" aria-label="现场摘要">
          <button type="button" onClick={() => onFilter("已模拟支付")}>
            <Package />
            <strong>商品订单</strong>
            <span>已模拟支付 4 · 制作中 2 · 待取 1</span>
            <ArrowRight />
          </button>
          <button type="button" onClick={() => onFilter("报修")}>
            <Wrench />
            <strong>报修</strong>
            <span>紧急 1 · 待分派 2 · 待验证 1</span>
            <ArrowRight />
          </button>
        </section>
      </main>
      {inspectorOpen ? (
        <aside className="role-inspector" aria-label="当前选中对象">
          <div className="role-inspector-title">
            <h2>当前选中</h2>
            <button onClick={() => onInspector(false)} type="button">
              收起
            </button>
          </div>
          <section>
            <h3>
              <User weight="fill" />
              {selected?.customer} <span>{selected?.status}</span>
            </h3>
            <dl>
              <div>
                <dt>座位</dt>
                <dd>{selected?.seat}</dd>
              </div>
              <div>
                <dt>时间</dt>
                <dd>{selected?.time}（2小时）</dd>
              </div>
              <div>
                <dt>到店窗口</dt>
                <dd>{selected?.arrival.replace("到店窗口 ", "")}</dd>
              </div>
              <div>
                <dt>模拟金额</dt>
                <dd>¥30.00</dd>
              </div>
              <div>
                <dt>相关对象</dt>
                <dd>预约单、座位 {selected?.seat.replace("竞技区 ", "")}</dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>业务事件</h3>
            <ol>
              <li>
                <CheckCircle weight="fill" />
                <span>
                  <time>19:10</time>
                  <strong>预约已确认</strong>
                  <small>界面参考数据</small>
                </span>
              </li>
              <li>
                <CheckCircle weight="fill" />
                <span>
                  <time>19:12</time>
                  <strong>模拟支付成功</strong>
                  <small>界面参考数据 · 不扣款</small>
                </span>
              </li>
              <li>
                <span className="role-event-dot" />
                <span>
                  <time>19:30</time>
                  <strong>办理到店（待接线）</strong>
                  <small>服务端写入由 ticket 09 接入</small>
                </span>
              </li>
            </ol>
          </section>
          <section className="role-shift-card">
            <h3>本人班次</h3>
            <p>
              <span>班次时间</span>
              <strong>18:00–02:00</strong>
            </p>
            <p>
              <span>模拟签到</span>
              <strong>界面参考 · 待接线</strong>
            </p>
            <p>
              <span>交接状态</span>
              <strong>交接待提交</strong>
            </p>
          </section>
        </aside>
      ) : null}
    </div>
  );
}
