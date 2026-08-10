"use client";

import {
  ArrowClockwise,
  Barcode,
  CaretDown,
  CaretUp,
  CheckCircle,
  Cube,
  MagnifyingGlass,
  Receipt,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type {
  InventoryMovementResponse,
  ManagerInventoryAction,
  ManagerInventoryCommandRequest,
  ManagerInventoryCommandResponse,
  StoreInventoryResponse,
} from "@jingshu/contracts";

const movementLabels: Record<InventoryMovementResponse["kind"], string> = {
  compensation: "补偿流水",
  receipt: "手工入库",
  sale: "订单销售",
  "spare-return": "备件退回",
  "spare-usage": "备件领用",
  stocktake: "库存盘点",
  waste: "订单损耗",
};

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function shanghaiTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

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

function InventoryCommandDialog({
  action,
  csrfToken,
  inventory,
  onClose,
  onCompleted,
}: {
  action: ManagerInventoryAction;
  csrfToken: string;
  inventory: StoreInventoryResponse;
  onClose: () => void;
  onCompleted: (message: string) => void;
}) {
  const initialItem =
    action === "compensation"
      ? inventory.items.find(
          (item) =>
            item.inventoryItemId === inventory.movements[0]?.inventoryItemId,
        )
      : (inventory.items.find((item) => item.alerting) ?? inventory.items[0]);
  const [inventoryItemId, setInventoryItemId] = useState(
    initialItem?.inventoryItemId ?? "",
  );
  const [quantity, setQuantity] = useState(
    action === "stocktake" ? String(initialItem?.onHandQuantity ?? 0) : "1",
  );
  const [originalMovementId, setOriginalMovementId] = useState(
    action === "compensation"
      ? (inventory.movements.find(
          (movement) =>
            movement.inventoryItemId === initialItem?.inventoryItemId,
        )?.movementId ?? "")
      : "",
  );
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const item = inventory.items.find(
    (candidate) => candidate.inventoryItemId === inventoryItemId,
  );
  const parsedQuantity = Number(quantity);
  const delta =
    action === "stocktake" && item && Number.isInteger(parsedQuantity)
      ? parsedQuantity - item.onHandQuantity
      : parsedQuantity;
  const itemMovements = inventory.movements.filter(
    (movement) => movement.inventoryItemId === inventoryItemId,
  );
  const title =
    action === "receipt"
      ? "创建手工入库"
      : action === "stocktake"
        ? "创建库存盘点"
        : "创建补偿流水";

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    if (action === "stocktake" && item) {
      setQuantity(String(item.onHandQuantity));
    }
    if (action === "compensation") {
      setOriginalMovementId(itemMovements[0]?.movementId ?? "");
    }
  }, [action, inventoryItemId]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !submitting) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
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

  const quantityValid =
    Number.isInteger(parsedQuantity) &&
    (action === "receipt"
      ? parsedQuantity > 0
      : action === "stocktake"
        ? parsedQuantity >= (item?.reservedQuantity ?? 0) && delta !== 0
        : parsedQuantity !== 0 &&
          (item?.onHandQuantity ?? 0) + parsedQuantity >=
            (item?.reservedQuantity ?? 0));
  const canSubmit =
    Boolean(item) && quantityValid && reason.trim().length > 0 && !submitting;

  async function submit() {
    if (!item || !canSubmit) return;
    setSubmitting(true);
    setError("");
    const body: ManagerInventoryCommandRequest =
      action === "receipt"
        ? {
            action,
            inventoryItemId: item.inventoryItemId,
            quantity: parsedQuantity,
            reason: reason.trim(),
          }
        : action === "stocktake"
          ? {
              action,
              actualQuantity: parsedQuantity,
              inventoryItemId: item.inventoryItemId,
              reason: reason.trim(),
            }
          : {
              action,
              inventoryItemId: item.inventoryItemId,
              onHandDelta: parsedQuantity,
              originalMovementId: originalMovementId || null,
              reason: reason.trim(),
            };
    try {
      const response = await fetch("/api/v1/store/inventory/commands", {
        body: JSON.stringify(body),
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKeyRef.current,
          "X-CSRF-Token": csrfToken,
        },
        method: "POST",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setError(
          failureMessage(
            payload,
            "库存动作未能提交，余额与流水保持不变；可以安全重试。",
          ),
        );
        return;
      }
      const result = payload as ManagerInventoryCommandResponse;
      const actionLabel =
        action === "receipt"
          ? "入库"
          : action === "stocktake"
            ? "盘点"
            : "补偿";
      onCompleted(
        `${actionLabel}流水已创建${
          result.alertTransition === "resolved"
            ? " · 低库存告警已解除"
            : result.alertTransition === "activated"
              ? " · 已触发低库存告警"
              : ""
        }`,
      );
    } catch {
      setError("库存动作未能提交，余额与流水保持不变；可以安全重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="inventory-dialog-backdrop">
      <div
        aria-labelledby="inventory-dialog-title"
        aria-modal="true"
        className="inventory-dialog"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <span>{action === "stocktake" ? <Barcode /> : <Cube />}</span>
          <div>
            <small>统一库存账本</small>
            <h2 id="inventory-dialog-title">{title}</h2>
          </div>
          <button aria-label="关闭" disabled={submitting} onClick={onClose}>
            <X />
          </button>
        </header>
        <p className="inventory-dialog-notice">
          {action === "stocktake"
            ? "输入现场实际数量，确认差额后只追加盘点流水，不覆盖历史。"
            : action === "receipt"
              ? "手工入库只增加账面库存，并在同一事务写入流水、告警结果与审计。"
              : "错误操作通过新的补偿流水修正；可关联原流水，原记录保持不可编辑。"}
        </p>
        <div className="inventory-dialog-fields">
          <label className="is-wide">
            <span>库存项目</span>
            <select
              aria-label="库存项目"
              onChange={(event) => setInventoryItemId(event.target.value)}
              ref={firstFieldRef}
              value={inventoryItemId}
            >
              {inventory.items.map((candidate) => (
                <option
                  key={candidate.inventoryItemId}
                  value={candidate.inventoryItemId}
                >
                  {candidate.displayName} ·{" "}
                  {candidate.kind === "product" ? "商品" : "备件"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>当前账面库存</span>
            <input
              aria-label="当前账面库存"
              readOnly
              value={item?.onHandQuantity ?? 0}
            />
          </label>
          <label>
            <span>
              {action === "receipt"
                ? "入库数量"
                : action === "stocktake"
                  ? "实际数量"
                  : "补偿差额"}
            </span>
            <input
              aria-label={
                action === "receipt"
                  ? "入库数量"
                  : action === "stocktake"
                    ? "实际数量"
                    : "补偿差额"
              }
              inputMode="numeric"
              onChange={(event) => setQuantity(event.target.value)}
              step="1"
              type="number"
              value={quantity}
            />
          </label>
          {action === "stocktake" ? (
            <div className="inventory-delta-preview is-wide" role="status">
              <span>差额与流水预览</span>
              <strong>
                账面 {item?.onHandQuantity ?? 0} → 实际{" "}
                {Number.isInteger(parsedQuantity) ? parsedQuantity : "—"}；差额{" "}
                {Number.isInteger(delta) ? signed(delta) : "—"}
              </strong>
            </div>
          ) : null}
          {action === "compensation" ? (
            <label className="is-wide">
              <span>关联原流水（可选）</span>
              <select
                aria-label="关联原流水"
                onChange={(event) => setOriginalMovementId(event.target.value)}
                value={originalMovementId}
              >
                <option value="">不关联，在原因中说明原操作</option>
                {itemMovements.map((movement) => (
                  <option key={movement.movementId} value={movement.movementId}>
                    {movementLabels[movement.kind]} ·{" "}
                    {signed(movement.onHandDelta)} ·{" "}
                    {shanghaiTime(movement.businessOccurredAt)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="is-wide">
            <span>
              {action === "receipt"
                ? "入库原因"
                : action === "stocktake"
                  ? "盘点原因"
                  : "补偿原因"}
              （必填，最多 200 字）
            </span>
            <textarea
              aria-label={
                action === "receipt"
                  ? "入库原因"
                  : action === "stocktake"
                    ? "盘点原因"
                    : "补偿原因"
              }
              maxLength={200}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              value={reason}
            />
            <small>请勿填写真实个人信息 · {reason.length}/200</small>
          </label>
        </div>
        {error ? (
          <p className="inventory-dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button disabled={submitting} onClick={onClose}>
            返回
          </button>
          <button
            className="is-primary"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {submitting
              ? "事务提交中…"
              : action === "receipt"
                ? "确认入库"
                : action === "stocktake"
                  ? "提交盘点"
                  : "创建补偿"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function StoreInventory({
  csrfToken,
  onToast,
  refreshKey,
  role,
}: {
  csrfToken: string;
  onToast: (message: string) => void;
  refreshKey: string;
  role: "manager" | "staff";
}) {
  const [inventory, setInventory] = useState<StoreInventoryResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"all" | "product" | "spare">("all");
  const [alert, setAlert] = useState<"all" | "alerting" | "normal">("all");
  const [ledgerExpanded, setLedgerExpanded] = useState(false);
  const [command, setCommand] = useState<ManagerInventoryAction | null>(null);
  const commandTriggerRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/store/inventory", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setError(failureMessage(payload, "库存读取失败，请稍后重试。"));
        return;
      }
      setInventory(payload as StoreInventoryResponse);
    } catch {
      setError("库存读取失败，页面不会伪造余额。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const rows = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("zh-CN");
    return (inventory?.items ?? []).filter(
      (item) =>
        (kind === "all" || item.kind === kind) &&
        (alert === "all" ||
          (alert === "alerting" ? item.alerting : !item.alerting)) &&
        (!normalized ||
          `${item.displayName} ${item.code}`
            .toLocaleLowerCase("zh-CN")
            .includes(normalized)),
    );
  }, [alert, inventory, kind, search]);

  function closeCommand() {
    setCommand(null);
    window.requestAnimationFrame(() => commandTriggerRef.current?.focus());
  }

  function openCommand(
    action: ManagerInventoryAction,
    trigger: HTMLButtonElement,
  ) {
    commandTriggerRef.current = trigger;
    setCommand(action);
  }

  function completed(message: string) {
    closeCommand();
    setLedgerExpanded(true);
    onToast(message);
    void load();
  }

  return (
    <main className="inventory-main">
      <header className="inventory-title-row">
        <div>
          <span>
            {inventory?.store.displayName ?? "所属门店"} · 统一库存账本
          </span>
          <h1>库存</h1>
          <p>
            可用库存 = 账面库存 − 预留库存；商品与八类维修备件共用不可变流水。
          </p>
        </div>
        {role === "manager" ? (
          <div className="inventory-actions">
            <button
              onClick={(event) => openCommand("stocktake", event.currentTarget)}
            >
              <Barcode />
              盘点
            </button>
            <button
              onClick={(event) =>
                openCommand("compensation", event.currentTarget)
              }
            >
              <ArrowClockwise />
              补偿流水
            </button>
            <button
              className="is-primary"
              onClick={(event) => openCommand("receipt", event.currentTarget)}
            >
              <Cube />
              手工入库
            </button>
          </div>
        ) : null}
      </header>
      {role === "staff" ? (
        <section className="inventory-readonly-note">
          <CheckCircle />
          <span>
            <strong>余额只读</strong>
            店员只能从商品订单或报修进入授权库存动作，不能直接编辑数量。
          </span>
        </section>
      ) : null}
      {loading ? (
        <section className="inventory-state">正在读取服务端库存账本…</section>
      ) : null}
      {error ? (
        <section className="inventory-state is-error" role="alert">
          <Warning />
          <span>{error}</span>
          <button onClick={() => void load()}>重新读取</button>
        </section>
      ) : null}
      {inventory ? (
        <>
          <section className="inventory-summary" aria-label="库存摘要">
            <div>
              <span>库存项目</span>
              <strong>{inventory.summary.itemCount}</strong>
            </div>
            <div>
              <span>商品</span>
              <strong>{inventory.summary.productCount}</strong>
            </div>
            <div>
              <span>维修备件</span>
              <strong>{inventory.summary.spareCount}</strong>
            </div>
            <div className="is-alert">
              <span>低库存</span>
              <strong>{inventory.summary.alertCount}</strong>
            </div>
          </section>
          <section className="inventory-filter-bar" aria-label="库存筛选">
            <label>
              <MagnifyingGlass />
              <input
                aria-label="搜索库存项目"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索库存项目"
                value={search}
              />
            </label>
            <label>
              <span>类别</span>
              <select
                aria-label="类别"
                onChange={(event) => setKind(event.target.value as typeof kind)}
                value={kind}
              >
                <option value="all">全部类别</option>
                <option value="product">商品</option>
                <option value="spare">备件</option>
              </select>
            </label>
            <label>
              <span>库存状态</span>
              <select
                aria-label="库存状态"
                onChange={(event) =>
                  setAlert(event.target.value as typeof alert)
                }
                value={alert}
              >
                <option value="all">全部状态</option>
                <option value="normal">正常</option>
                <option value="alerting">低库存</option>
              </select>
            </label>
          </section>
          <section className="inventory-table-wrap" aria-label="库存余额">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>库存项目</th>
                  <th>类别</th>
                  <th>账面库存</th>
                  <th>预留库存</th>
                  <th>可用库存</th>
                  <th>独立阈值</th>
                  <th>告警状态</th>
                  <th>最近关联流水</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.inventoryItemId}>
                    <td>
                      <strong>{item.displayName}</strong>
                      <small>{item.code}</small>
                    </td>
                    <td>{item.kind === "product" ? "商品" : "备件"}</td>
                    <td>{item.onHandQuantity}</td>
                    <td>{item.reservedQuantity}</td>
                    <td>{item.availableQuantity}</td>
                    <td>{item.lowStockThreshold}</td>
                    <td>
                      <span
                        className={
                          item.alerting
                            ? "inventory-alert-pill is-alerting"
                            : "inventory-alert-pill"
                        }
                      >
                        {item.alerting ? "低库存" : "正常"}
                      </span>
                    </td>
                    <td>
                      {item.recentMovement ? (
                        <span className="inventory-recent">
                          <strong>
                            {movementLabels[item.recentMovement.kind]}{" "}
                            {signed(item.recentMovement.onHandDelta)}
                          </strong>
                          <small>
                            {shanghaiTime(
                              item.recentMovement.businessOccurredAt,
                            )}{" "}
                            · {item.recentMovement.reason}
                          </small>
                        </span>
                      ) : (
                        <span className="inventory-no-movement">
                          尚无关联流水
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 ? (
              <p className="inventory-empty">没有符合当前筛选的库存项目。</p>
            ) : null}
          </section>
          <section className="inventory-ledger">
            <header>
              <span>
                <Receipt />
                <strong>最近库存流水</strong>
              </span>
              <button
                aria-controls="inventory-ledger-rows"
                aria-expanded={ledgerExpanded}
                onClick={() => setLedgerExpanded((value) => !value)}
              >
                {ledgerExpanded ? "收起流水" : "查看全部流水"}
                {ledgerExpanded ? <CaretUp /> : <CaretDown />}
              </button>
            </header>
            <div id="inventory-ledger-rows">
              {inventory.movements
                .slice(0, ledgerExpanded ? 20 : 3)
                .map((movement) => (
                  <article key={movement.movementId}>
                    <time>{shanghaiTime(movement.businessOccurredAt)}</time>
                    <span>{movementLabels[movement.kind]}</span>
                    <strong>{movement.inventoryItemName}</strong>
                    <b>{signed(movement.onHandDelta)}</b>
                    <small>
                      {movement.reason}
                      {movement.originalMovementId ? " · 已关联原流水" : ""}
                    </small>
                  </article>
                ))}
              {inventory.movements.length === 0 ? (
                <p className="inventory-empty">
                  当前沙箱尚无库存流水；店长业务动作会在这里追加记录。
                </p>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
      {command && inventory ? (
        <InventoryCommandDialog
          action={command}
          csrfToken={csrfToken}
          inventory={inventory}
          onClose={closeCommand}
          onCompleted={completed}
        />
      ) : null}
    </main>
  );
}
