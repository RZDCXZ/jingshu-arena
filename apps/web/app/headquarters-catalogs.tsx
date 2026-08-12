"use client";

import {
  Archive,
  Cube,
  MagnifyingGlass,
  Package,
  PencilSimple,
  Plus,
  ShieldCheck,
  Storefront,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import type {
  HeadquartersCatalogCommandRequest,
  HeadquartersCatalogsResponse,
  HeadquartersProductCategory,
} from "@jingshu/contracts";

import { createBrowserUuid } from "./browser-uuid";

type Catalogs = HeadquartersCatalogsResponse;
type Product = Catalogs["products"][number];
type MachineProfile = Catalogs["machineProfiles"][number];
type Tab = "machines" | "products";
type DialogState =
  | { kind: "product-form"; product?: Product }
  | { kind: "product-archive"; product: Product }
  | { kind: "machine-form"; profile?: MachineProfile }
  | { kind: "machine-archive"; profile: MachineProfile };

const categoryLabels: Record<HeadquartersProductCategory, string> = {
  drink: "饮品",
  meal: "餐食",
  snack: "零食",
  supply: "用品",
};

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

function DialogFrame({
  busy,
  children,
  firstFieldRef,
  icon,
  onClose,
  title,
}: {
  busy: boolean;
  children: ReactNode;
  firstFieldRef: RefObject<HTMLElement | null>;
  icon: ReactNode;
  onClose: () => void;
  title: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => firstFieldRef.current?.focus(), [firstFieldRef]);
  return (
    <div className="store-config-dialog-backdrop">
      <div
        aria-labelledby="hq-catalog-dialog-title"
        aria-modal="true"
        className="store-config-dialog hq-catalog-dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
          if (event.key !== "Tab") return;
          const focusable = Array.from(
            dialogRef.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
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
        }}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <span>{icon}</span>
          <div>
            <small>总部目录 · 服务端确认</small>
            <h2 id="hq-catalog-dialog-title">{title}</h2>
          </div>
          <button aria-label="关闭" disabled={busy} onClick={onClose}>
            <X />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function ProductDialog({
  catalogs,
  onClose,
  onSubmit,
  product,
}: {
  catalogs: Catalogs;
  onClose: () => void;
  onSubmit: (
    command: HeadquartersCatalogCommandRequest,
    success: string,
  ) => Promise<string | null>;
  product?: Product;
}) {
  const [code, setCode] = useState(product?.code ?? "");
  const [displayName, setDisplayName] = useState(product?.displayName ?? "");
  const [category, setCategory] = useState<HeadquartersProductCategory>(
    product?.category ?? "drink",
  );
  const [description, setDescription] = useState(product?.description ?? "");
  const [availableStoreIds, setAvailableStoreIds] = useState(
    product?.availableStores.map((store) => store.storeId) ??
      catalogs.stores.map((store) => store.storeId),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const codeFieldRef = useRef<HTMLInputElement>(null);
  const nameFieldRef = useRef<HTMLInputElement>(null);
  const firstFieldRef = product ? nameFieldRef : codeFieldRef;

  async function submit() {
    if (
      !displayName.trim() ||
      !description.trim() ||
      !availableStoreIds.length ||
      (!product && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(code.trim()))
    ) {
      setError("请填写安全的商品代码、名称、说明，并至少选择一家适用门店。");
      return;
    }
    setBusy(true);
    setError("");
    const command: HeadquartersCatalogCommandRequest = product
      ? {
          action: "update-product",
          availableStoreIds,
          category,
          description: description.trim(),
          displayName: displayName.trim(),
          expectedVersion: product.version,
          productId: product.productId,
        }
      : {
          action: "create-product",
          availableStoreIds,
          category,
          code: code.trim(),
          description: description.trim(),
          displayName: displayName.trim(),
        };
    const failure = await onSubmit(
      command,
      product ? "商品资料已保存，历史订单快照保持不变" : "商品资料已创建",
    );
    if (failure) setError(failure);
    else onClose();
    setBusy(false);
  }

  return (
    <DialogFrame
      busy={busy}
      firstFieldRef={firstFieldRef}
      icon={<Package />}
      onClose={onClose}
      title={product ? `编辑商品 · ${product.displayName}` : "创建商品资料"}
    >
      <p className="store-config-dialog-notice">
        总部只维护商品主资料与适用门店；门店售价、上架状态和库存数量不在此表单中。
      </p>
      <div className="store-config-fields">
        <label>
          <span>商品代码</span>
          <input
            disabled={Boolean(product)}
            maxLength={48}
            onChange={(event) => setCode(event.target.value.toLowerCase())}
            ref={codeFieldRef}
            value={code}
          />
        </label>
        <label>
          <span>商品名称</span>
          <input
            maxLength={60}
            onChange={(event) => setDisplayName(event.target.value)}
            ref={nameFieldRef}
            value={displayName}
          />
        </label>
        <label>
          <span>分类</span>
          <select
            onChange={(event) =>
              setCategory(event.target.value as HeadquartersProductCategory)
            }
            value={category}
          >
            {Object.entries(categoryLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="hq-catalog-store-scope">
          <legend>适用门店</legend>
          {catalogs.stores.map((store) => (
            <label key={store.storeId}>
              <input
                checked={availableStoreIds.includes(store.storeId)}
                onChange={(event) =>
                  setAvailableStoreIds((current) =>
                    event.target.checked
                      ? [...current, store.storeId]
                      : current.filter((id) => id !== store.storeId),
                  )
                }
                type="checkbox"
              />
              <span>{store.displayName}</span>
            </label>
          ))}
        </fieldset>
        <label className="is-wide">
          <span>资料说明</span>
          <textarea
            maxLength={240}
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
          <small>{description.length}/240</small>
        </label>
      </div>
      {error ? (
        <p className="store-config-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer>
        <button disabled={busy} onClick={onClose}>
          返回
        </button>
        <button
          className="is-primary"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? "提交中…" : product ? "保存商品资料" : "创建商品资料"}
        </button>
      </footer>
    </DialogFrame>
  );
}

function MachineDialog({
  onClose,
  onSubmit,
  profile,
}: {
  onClose: () => void;
  onSubmit: (
    command: HeadquartersCatalogCommandRequest,
    success: string,
  ) => Promise<string | null>;
  profile?: MachineProfile;
}) {
  const [code, setCode] = useState(profile?.code ?? "");
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [experienceDescription, setExperienceDescription] = useState(
    profile?.experienceDescription ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const codeFieldRef = useRef<HTMLInputElement>(null);
  const nameFieldRef = useRef<HTMLInputElement>(null);
  const firstFieldRef = profile ? nameFieldRef : codeFieldRef;

  async function submit() {
    if (
      !displayName.trim() ||
      !experienceDescription.trim() ||
      (!profile && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(code.trim()))
    ) {
      setError("请填写安全的虚构机型代码、名称和体验描述。");
      return;
    }
    setBusy(true);
    setError("");
    const command: HeadquartersCatalogCommandRequest = profile
      ? {
          action: "update-machine-profile",
          displayName: displayName.trim(),
          expectedVersion: profile.version,
          experienceDescription: experienceDescription.trim(),
          machineProfileId: profile.machineProfileId,
        }
      : {
          action: "create-machine-profile",
          code: code.trim(),
          displayName: displayName.trim(),
          experienceDescription: experienceDescription.trim(),
        };
    const failure = await onSubmit(
      command,
      profile ? "机型档案已保存，历史预约与报修快照保持不变" : "机型档案已创建",
    );
    if (failure) setError(failure);
    else onClose();
    setBusy(false);
  }

  return (
    <DialogFrame
      busy={busy}
      firstFieldRef={firstFieldRef}
      icon={<Cube />}
      onClose={onClose}
      title={profile ? `编辑机型 · ${profile.displayName}` : "创建机型档案"}
    >
      <p className="store-config-dialog-notice">
        只描述分辨率、刷新率与体验定位，不记录真实 CPU、GPU 品牌或具体硬件型号。
      </p>
      <div className="store-config-fields">
        <label>
          <span>机型代码</span>
          <input
            disabled={Boolean(profile)}
            maxLength={48}
            onChange={(event) => setCode(event.target.value.toLowerCase())}
            ref={codeFieldRef}
            value={code}
          />
        </label>
        <label>
          <span>档案名称</span>
          <input
            maxLength={60}
            onChange={(event) => setDisplayName(event.target.value)}
            ref={nameFieldRef}
            value={displayName}
          />
        </label>
        <label className="is-wide">
          <span>体验描述</span>
          <textarea
            maxLength={240}
            onChange={(event) => setExperienceDescription(event.target.value)}
            value={experienceDescription}
          />
          <small>{experienceDescription.length}/240</small>
        </label>
      </div>
      {profile ? (
        <div className="hq-catalog-reference-summary">
          <span>
            当前座位引用 <strong>{profile.seatReferenceCount}</strong>
          </span>
          <span>
            历史报修引用 <strong>{profile.historicalReferenceCount}</strong>
          </span>
        </div>
      ) : null}
      {error ? (
        <p className="store-config-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer>
        <button disabled={busy} onClick={onClose}>
          返回
        </button>
        <button
          className="is-primary"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? "提交中…" : profile ? "保存机型档案" : "创建机型档案"}
        </button>
      </footer>
    </DialogFrame>
  );
}

function ArchiveDialog({
  item,
  kind,
  onClose,
  onSubmit,
}: {
  item: Product | MachineProfile;
  kind: "machine" | "product";
  onClose: () => void;
  onSubmit: (
    command: HeadquartersCatalogCommandRequest,
    success: string,
  ) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const name = item.displayName;
  async function archive() {
    setBusy(true);
    setError("");
    const command: HeadquartersCatalogCommandRequest =
      kind === "product"
        ? {
            action: "archive-product",
            expectedVersion: item.version,
            productId: (item as Product).productId,
          }
        : {
            action: "archive-machine-profile",
            expectedVersion: item.version,
            machineProfileId: (item as MachineProfile).machineProfileId,
          };
    const failure = await onSubmit(
      command,
      `${kind === "product" ? "商品" : "机型"}档案已归档，历史事实保持不变`,
    );
    if (failure) setError(failure);
    else onClose();
    setBusy(false);
  }
  const profile = kind === "machine" ? (item as MachineProfile) : null;
  return (
    <DialogFrame
      busy={busy}
      firstFieldRef={confirmRef}
      icon={<Archive />}
      onClose={onClose}
      title={`归档${kind === "product" ? "商品" : "机型"} · ${name}`}
    >
      <p className="store-config-dialog-notice is-warning">
        <Warning />{" "}
        归档会阻止继续编辑，但不会硬删除资料，也不会追溯改写历史订单、预约价格、报修机型或审计事实。
      </p>
      {profile ? (
        <div className="hq-catalog-reference-summary">
          <span>
            仍被座位引用 <strong>{profile.seatReferenceCount}</strong>
          </span>
          <span>
            历史报修引用 <strong>{profile.historicalReferenceCount}</strong>
          </span>
        </div>
      ) : null}
      {error ? (
        <p className="store-config-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer>
        <button disabled={busy} onClick={onClose}>
          返回
        </button>
        <button
          className="is-danger"
          disabled={busy}
          onClick={() => void archive()}
          ref={confirmRef}
        >
          {busy ? "归档中…" : "确认归档"}
        </button>
      </footer>
    </DialogFrame>
  );
}

export function HeadquartersCatalogs({
  csrfToken,
  onToast,
  refreshKey,
}: {
  csrfToken: string;
  onToast: (message: string) => void;
  refreshKey: string;
}) {
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);
  const [tab, setTab] = useState<Tab>("products");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const dialogTriggerRef = useRef<HTMLButtonElement | null>(null);

  const openDialog = useCallback(
    (next: DialogState, trigger: HTMLButtonElement) => {
      dialogTriggerRef.current = trigger;
      setDialog(next);
    },
    [],
  );
  const closeDialog = useCallback(() => {
    setDialog(null);
    window.requestAnimationFrame(() => dialogTriggerRef.current?.focus());
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/hq/catalogs", {
        cache: "no-store",
        credentials: "same-origin",
        ...(signal ? { signal } : {}),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(failureMessage(payload, "总部目录载入失败。"));
      setCatalogs(payload as Catalogs);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "总部目录载入失败。");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  const submit = useCallback(
    async (command: HeadquartersCatalogCommandRequest, success: string) => {
      try {
        const response = await fetch("/api/v1/hq/catalogs/commands", {
          body: JSON.stringify(command),
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": createBrowserUuid(),
            "X-CSRF-Token": csrfToken,
          },
          method: "POST",
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok)
          return failureMessage(payload, "目录操作失败，数据没有改变。");
        await load();
        onToast(success);
        return null;
      } catch {
        return "网络中断，操作结果未知，请刷新后确认。";
      }
    },
    [csrfToken, load, onToast],
  );

  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const products = useMemo(
    () =>
      catalogs?.products.filter((product) =>
        `${product.code}${product.displayName}${product.description}`
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedQuery),
      ) ?? [],
    [catalogs, normalizedQuery],
  );
  const machineProfiles = useMemo(
    () =>
      catalogs?.machineProfiles.filter((profile) =>
        `${profile.code}${profile.displayName}${profile.experienceDescription}`
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedQuery),
      ) ?? [],
    [catalogs, normalizedQuery],
  );

  return (
    <main className="store-config-main hq-catalog-main">
      <div className="store-config-title-row">
        <div>
          <span>竞枢连锁 · 总部统一资料</span>
          <h1>连锁配置</h1>
          <p>维护商品主资料、适用门店与机型体验档案；历史业务记录保持冻结。</p>
        </div>
        <strong>
          <ShieldCheck /> 总部目录专用能力
        </strong>
      </div>
      <section className="store-config-fixed-note hq-catalog-boundary">
        <Storefront />
        <span>
          <strong>门店操作边界</strong>
          <small>
            这里不提供售价、上架、库存、到店、制作、维修、签到或交接操作。
          </small>
        </span>
      </section>
      <div className="store-config-tabs hq-catalog-tabs" role="tablist">
        <button
          className={tab === "products" ? "is-active" : ""}
          onClick={() => setTab("products")}
          role="tab"
        >
          商品资料 <span>{catalogs?.products.length ?? 0}</span>
        </button>
        <button
          className={tab === "machines" ? "is-active" : ""}
          onClick={() => setTab("machines")}
          role="tab"
        >
          机型档案 <span>{catalogs?.machineProfiles.length ?? 0}</span>
        </button>
      </div>
      {error ? (
        <section className="store-config-state is-error">
          <Warning />
          <span>{error}</span>
          <button onClick={() => void load()}>重试</button>
        </section>
      ) : loading && !catalogs ? (
        <section className="store-config-state">正在载入总部目录…</section>
      ) : catalogs ? (
        <section className="store-config-data-panel hq-catalog-panel">
          <header>
            <span>{tab === "products" ? <Package /> : <Cube />}</span>
            <div>
              <small>{tab === "products" ? "WEB-H03" : "WEB-H04"}</small>
              <h2>{tab === "products" ? "连锁商品资料" : "连锁机型档案"}</h2>
              <p>
                {tab === "products"
                  ? "虚构商品、分类与适用门店范围"
                  : "体验规格、引用数量与归档状态"}
              </p>
            </div>
            <button
              onClick={(event) =>
                openDialog(
                  tab === "products"
                    ? { kind: "product-form" }
                    : { kind: "machine-form" },
                  event.currentTarget,
                )
              }
            >
              <Plus /> 新建{tab === "products" ? "商品" : "机型"}
            </button>
          </header>
          <label className="hq-catalog-search">
            <MagnifyingGlass />
            <input
              aria-label="搜索总部目录"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索代码、名称或描述"
              value={query}
            />
          </label>
          <div className="store-config-seat-table-wrap store-config-data-table-wrap">
            {tab === "products" ? (
              <table className="store-config-seat-table store-config-data-table is-products">
                <thead>
                  <tr>
                    <th>商品</th>
                    <th>分类</th>
                    <th>适用门店</th>
                    <th>资料状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.productId}>
                      <td>
                        <strong>{product.displayName}</strong>
                        <small>
                          {product.code} · {product.description}
                        </small>
                      </td>
                      <td>{categoryLabels[product.category]}</td>
                      <td>
                        {product.availableStores
                          .map((store) => store.displayName)
                          .join("、")}
                      </td>
                      <td>
                        <span
                          className={`store-config-status ${product.archived ? "is-archived" : ""}`}
                        >
                          {product.archived ? "已归档" : "使用中"}
                        </span>
                      </td>
                      <td>
                        <div className="hq-catalog-actions">
                          <button
                            disabled={product.archived}
                            onClick={(event) =>
                              openDialog(
                                { kind: "product-form", product },
                                event.currentTarget,
                              )
                            }
                          >
                            <PencilSimple />
                            编辑
                          </button>
                          <button
                            disabled={product.archived}
                            onClick={(event) =>
                              openDialog(
                                { kind: "product-archive", product },
                                event.currentTarget,
                              )
                            }
                          >
                            <Archive />
                            归档
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="store-config-seat-table store-config-data-table hq-machine-table">
                <thead>
                  <tr>
                    <th>机型档案</th>
                    <th>体验描述</th>
                    <th>当前座位</th>
                    <th>历史报修</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {machineProfiles.map((profile) => (
                    <tr key={profile.machineProfileId}>
                      <td>
                        <strong>{profile.displayName}</strong>
                        <small>{profile.code}</small>
                      </td>
                      <td>{profile.experienceDescription}</td>
                      <td>{profile.seatReferenceCount}</td>
                      <td>{profile.historicalReferenceCount}</td>
                      <td>
                        <span
                          className={`store-config-status ${profile.archived ? "is-archived" : ""}`}
                        >
                          {profile.archived ? "已归档" : "使用中"}
                        </span>
                      </td>
                      <td>
                        <div className="hq-catalog-actions">
                          <button
                            disabled={profile.archived}
                            onClick={(event) =>
                              openDialog(
                                { kind: "machine-form", profile },
                                event.currentTarget,
                              )
                            }
                          >
                            <PencilSimple />
                            编辑
                          </button>
                          <button
                            disabled={profile.archived}
                            onClick={(event) =>
                              openDialog(
                                { kind: "machine-archive", profile },
                                event.currentTarget,
                              )
                            }
                          >
                            <Archive />
                            归档
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      ) : null}
      {catalogs && dialog?.kind === "product-form" ? (
        <ProductDialog
          catalogs={catalogs}
          onClose={closeDialog}
          onSubmit={submit}
          {...(dialog.product ? { product: dialog.product } : {})}
        />
      ) : null}
      {dialog?.kind === "machine-form" ? (
        <MachineDialog
          onClose={closeDialog}
          onSubmit={submit}
          {...(dialog.profile ? { profile: dialog.profile } : {})}
        />
      ) : null}
      {dialog?.kind === "product-archive" ? (
        <ArchiveDialog
          item={dialog.product}
          kind="product"
          onClose={closeDialog}
          onSubmit={submit}
        />
      ) : null}
      {dialog?.kind === "machine-archive" ? (
        <ArchiveDialog
          item={dialog.profile}
          kind="machine"
          onClose={closeDialog}
          onSubmit={submit}
        />
      ) : null}
    </main>
  );
}
