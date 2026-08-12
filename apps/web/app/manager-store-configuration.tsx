"use client";

import {
  Archive,
  CalendarPlus,
  Clock,
  CurrencyDollar,
  MapPin,
  MagnifyingGlass,
  Package,
  PencilSimple,
  Plus,
  Seat,
  Storefront,
  Warning,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import type {
  HeadquartersCatalogCommandRequest,
  HeadquartersCatalogsResponse,
  ManagerPricePlanOverlapPreviewRequest,
  ManagerPricePlanOverlapPreviewResponse,
  ManagerStoreConfigurationCommandRequest,
  ManagerStoreConfigurationResponse,
  SeatLifecycleStatus,
  StoreAreaLifecycleStatus,
  StoreBusinessHoursDaySet,
} from "@jingshu/contracts";

import { createBrowserUuid } from "./browser-uuid";
import { canonicalHeadquartersStores } from "./headquarters-stores";

type Configuration = ManagerStoreConfigurationResponse;
type Area = Configuration["areas"][number];
type StoreProduct = Configuration["products"][number];
type StoreSeat = Configuration["seats"][number];
type PricePlan = Configuration["pricePlans"][number];
type Command = ManagerStoreConfigurationCommandRequest;
type HeadquartersProduct = HeadquartersCatalogsResponse["products"][number];
type ConfigurationTab = "profile" | "seats" | "pricing" | "products";

type DialogState =
  | { readonly kind: "area"; readonly area?: Area }
  | { readonly kind: "hours" }
  | {
      readonly kind: "headquarters-product";
      readonly product: HeadquartersProduct;
    }
  | { readonly kind: "price"; readonly plan?: PricePlan }
  | { readonly kind: "product"; readonly product: StoreProduct }
  | { readonly kind: "seat"; readonly seat?: StoreSeat }
  | { readonly kind: "dependencies"; readonly seat: StoreSeat };

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

function shanghaiDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function formatCents(value: number) {
  return `¥${(value / 100).toFixed(2)}`;
}

function orderedPricePlans(pricePlans: Configuration["pricePlans"]) {
  const statusOrder = {
    scheduled: 0,
    current: 1,
    archived: 2,
    historical: 3,
  } as const;
  return [...pricePlans].sort(
    (left, right) =>
      statusOrder[left.status] - statusOrder[right.status] ||
      new Date(right.effectiveFrom).getTime() -
        new Date(left.effectiveFrom).getTime(),
  );
}

function productCategoryLabel(
  value: StoreProduct["headquartersProduct"]["category"],
) {
  return {
    drink: "饮品",
    meal: "餐食",
    snack: "零食",
    supply: "用品",
  }[value];
}

function nextHalfHour(value: string) {
  const halfHourMs = 30 * 60 * 1_000;
  const time = new Date(value).getTime();
  return new Date(
    Math.ceil((time + 1) / halfHourMs) * halfHourMs,
  ).toISOString();
}

function shanghaiDateTimeLocal(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  })
    .formatToParts(new Date(value))
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function parseShanghaiDateTimeLocal(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return null;
  const parsed = new Date(`${value}:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function useDialogFocus(
  dialogRef: RefObject<HTMLDivElement | null>,
  firstFieldRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  blocked: boolean,
) {
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, [firstFieldRef]);

  return (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !blocked) {
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
  };
}

function DialogFrame({
  children,
  eyebrow = "所属门店 · 服务端确认",
  firstFieldRef,
  icon,
  onClose,
  submitting,
  title,
}: {
  children: ReactNode;
  eyebrow?: string;
  firstFieldRef: RefObject<HTMLElement | null>;
  icon: ReactNode;
  onClose: () => void;
  submitting: boolean;
  title: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const handleKeyDown = useDialogFocus(
    dialogRef,
    firstFieldRef,
    onClose,
    submitting,
  );
  return (
    <div className="store-config-dialog-backdrop">
      <div
        aria-labelledby="store-config-dialog-title"
        aria-modal="true"
        className="store-config-dialog"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <span>{icon}</span>
          <div>
            <small>{eyebrow}</small>
            <h2 id="store-config-dialog-title">{title}</h2>
          </div>
          <button aria-label="关闭" disabled={submitting} onClick={onClose}>
            <X />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function ProfilePanel({
  configuration,
  onSubmit,
}: {
  configuration: Configuration;
  onSubmit: (command: Command, success: string) => Promise<string | null>;
}) {
  const [displayName, setDisplayName] = useState(
    configuration.store.displayName,
  );
  const [fictitiousCity, setFictitiousCity] = useState(
    configuration.store.fictitiousCity,
  );
  const [introduction, setIntroduction] = useState(
    configuration.store.introduction,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const baselineRef = useRef(configuration.store);

  useEffect(() => {
    const baseline = baselineRef.current;
    const hasLocalEdits =
      displayName.trim() !== baseline.displayName ||
      fictitiousCity.trim() !== baseline.fictitiousCity ||
      introduction.trim() !== baseline.introduction;
    baselineRef.current = configuration.store;
    if (!hasLocalEdits || baseline.storeId !== configuration.store.storeId) {
      setDisplayName(configuration.store.displayName);
      setFictitiousCity(configuration.store.fictitiousCity);
      setIntroduction(configuration.store.introduction);
    }
  }, [configuration.store, displayName, fictitiousCity, introduction]);

  const changed =
    displayName.trim() !== configuration.store.displayName ||
    fictitiousCity.trim() !== configuration.store.fictitiousCity ||
    introduction.trim() !== configuration.store.introduction;
  const valid =
    displayName.trim().length > 0 &&
    fictitiousCity.includes("虚构") &&
    introduction.trim().length > 0;

  async function submit() {
    if (!changed || !valid || submitting) return;
    const nextDisplayName = displayName.trim();
    const nextFictitiousCity = fictitiousCity.trim();
    const nextIntroduction = introduction.trim();
    setDisplayName(nextDisplayName);
    setFictitiousCity(nextFictitiousCity);
    setIntroduction(nextIntroduction);
    setSubmitting(true);
    setError("");
    const failure = await onSubmit(
      {
        action: "update-store-profile",
        displayName: nextDisplayName,
        expectedVersion: configuration.store.version,
        fictitiousCity: nextFictitiousCity,
        introduction: nextIntroduction,
        storeId: configuration.store.storeId,
      },
      "门店展示资料已由服务端确认保存",
    );
    setError(failure ?? "");
    setSubmitting(false);
  }

  return (
    <section className="store-config-profile-card">
      <header>
        <span>
          <Storefront />
        </span>
        <div>
          <h2>门店展示资料</h2>
          <p>顾客端仅展示虚构城市与演示介绍，不收集真实经营地址。</p>
        </div>
      </header>
      <div className="store-config-fields">
        <label>
          <span>门店工作名称</span>
          <input
            aria-label="门店工作名称"
            maxLength={60}
            onChange={(event) => setDisplayName(event.target.value)}
            value={displayName}
          />
        </label>
        <label>
          <span>虚构城市</span>
          <input
            aria-label="虚构城市"
            maxLength={40}
            onChange={(event) => setFictitiousCity(event.target.value)}
            value={fictitiousCity}
          />
          <small>必须明确包含“虚构”字样。</small>
        </label>
        <label className="is-wide">
          <span>演示介绍</span>
          <textarea
            aria-label="演示介绍"
            maxLength={280}
            onChange={(event) => setIntroduction(event.target.value)}
            rows={4}
            value={introduction}
          />
          <small>{introduction.length}/280 · 请勿填写真实个人或地址信息</small>
        </label>
      </div>
      {error ? (
        <p className="store-config-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer>
        <span>配置版本 {configuration.store.version}</span>
        <button
          className="is-primary"
          disabled={!changed || !valid || submitting}
          onClick={() => void submit()}
        >
          {submitting ? "保存中…" : "保存资料"}
        </button>
      </footer>
    </section>
  );
}

function HoursDialog({
  configuration,
  onClose,
  onSubmit,
}: {
  configuration: Configuration;
  onClose: () => void;
  onSubmit: (command: Command, success: string) => Promise<string | null>;
}) {
  const initial = shanghaiDateTimeLocal(
    new Date(Date.parse(configuration.currentTime) + 86_400_000).toISOString(),
  );
  const [daySet, setDaySet] = useState<StoreBusinessHoursDaySet>("all");
  const [effectiveFrom, setEffectiveFrom] = useState(initial);
  const [isOpen24Hours, setIsOpen24Hours] = useState(false);
  const [opensAt, setOpensAt] = useState("09:00");
  const [closesAt, setClosesAt] = useState("02:00");
  const [closesNextDay, setClosesNextDay] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  async function submit() {
    setSubmitting(true);
    setError("");
    const parsed = parseShanghaiDateTimeLocal(effectiveFrom);
    if (!parsed || parsed.getTime() <= Date.parse(configuration.currentTime)) {
      setError("请选择晚于当前业务时间的生效时刻。");
      setSubmitting(false);
      return;
    }
    const failure = await onSubmit(
      {
        action: "schedule-business-hours",
        closesAt: isOpen24Hours ? "00:00" : closesAt,
        closesNextDay: isOpen24Hours ? false : closesNextDay,
        daySet,
        effectiveFrom: parsed.toISOString(),
        expectedVersion: configuration.store.version,
        isOpen24Hours,
        opensAt: isOpen24Hours ? "00:00" : opensAt,
        storeId: configuration.store.storeId,
      },
      "未来营业规则已创建，当前营业时间保持不变",
    );
    if (failure) {
      setError(failure);
    } else {
      onClose();
    }
    setSubmitting(false);
  }

  return (
    <DialogFrame
      firstFieldRef={firstFieldRef}
      icon={<CalendarPlus />}
      onClose={onClose}
      submitting={submitting}
      title="创建未来营业规则"
    >
      <p className="store-config-dialog-notice">
        新规则只从未来业务时间生效；已经创建的预约和历史快照不会被改写。
      </p>
      <div className="store-config-fields">
        <label>
          <span>适用日</span>
          <select
            aria-label="适用日"
            onChange={(event) =>
              setDaySet(event.target.value as StoreBusinessHoursDaySet)
            }
            ref={firstFieldRef}
            value={daySet}
          >
            <option value="all">每天</option>
            <option value="weekdays">工作日</option>
            <option value="weekends">周末</option>
          </select>
        </label>
        <label>
          <span>生效时间</span>
          <input
            aria-label="生效时间"
            onChange={(event) => setEffectiveFrom(event.target.value)}
            type="datetime-local"
            value={effectiveFrom}
          />
        </label>
        <label className="store-config-check is-wide">
          <input
            checked={isOpen24Hours}
            onChange={(event) => setIsOpen24Hours(event.target.checked)}
            type="checkbox"
          />
          <span>24 小时营业</span>
        </label>
        {!isOpen24Hours ? (
          <>
            <label>
              <span>开始时间</span>
              <input
                aria-label="开始时间"
                onChange={(event) => setOpensAt(event.target.value)}
                type="time"
                value={opensAt}
              />
            </label>
            <label>
              <span>结束时间</span>
              <input
                aria-label="结束时间"
                onChange={(event) => setClosesAt(event.target.value)}
                type="time"
                value={closesAt}
              />
            </label>
            <label className="store-config-check is-wide">
              <input
                checked={closesNextDay}
                onChange={(event) => setClosesNextDay(event.target.checked)}
                type="checkbox"
              />
              <span>结束时间位于次日</span>
            </label>
          </>
        ) : null}
      </div>
      {error ? (
        <p className="store-config-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer>
        <button disabled={submitting} onClick={onClose}>
          返回
        </button>
        <button
          className="is-primary"
          disabled={submitting}
          onClick={() => void submit()}
        >
          {submitting ? "创建中…" : "创建未来规则"}
        </button>
      </footer>
    </DialogFrame>
  );
}

function AreaDialog({
  area,
  configuration,
  onClose,
  onSubmit,
}: {
  area?: Area;
  configuration: Configuration;
  onClose: () => void;
  onSubmit: (command: Command, success: string) => Promise<string | null>;
}) {
  const [code, setCode] = useState(area?.code ?? "");
  const [displayName, setDisplayName] = useState(area?.displayName ?? "");
  const [lifecycleStatus, setLifecycleStatus] =
    useState<StoreAreaLifecycleStatus>(area?.lifecycleStatus ?? "draft");
  const [sortOrder, setSortOrder] = useState(String(area?.sortOrder ?? 100));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const codeFieldRef = useRef<HTMLInputElement>(null);
  const displayNameFieldRef = useRef<HTMLInputElement>(null);
  const lifecycleFieldRef = useRef<HTMLSelectElement>(null);
  const referenced = area?.businessReferenced ?? false;
  const initialFocusRef = area
    ? referenced
      ? lifecycleFieldRef
      : displayNameFieldRef
    : codeFieldRef;
  const lifecycleOptions: ReadonlyArray<{
    label: string;
    value: StoreAreaLifecycleStatus;
  }> = !area
    ? [
        { label: "草稿", value: "draft" },
        { label: "有效", value: "active" },
      ]
    : area.lifecycleStatus === "draft"
      ? referenced
        ? [{ label: "草稿", value: "draft" }]
        : [
            { label: "草稿", value: "draft" },
            { label: "有效", value: "active" },
          ]
      : area.lifecycleStatus === "active"
        ? [
            { label: "有效", value: "active" },
            { label: "归档", value: "archived" },
          ]
        : [{ label: "归档", value: "archived" }];

  async function execute(command: Command, success: string) {
    setSubmitting(true);
    setError("");
    const failure = await onSubmit(command, success);
    if (failure) setError(failure);
    else onClose();
    setSubmitting(false);
  }

  function submit() {
    const parsedSortOrder = Number(sortOrder);
    if (
      !displayName.trim() ||
      !Number.isInteger(parsedSortOrder) ||
      parsedSortOrder < 0
    ) {
      setError("请填写区域名称和非负整数排序值。");
      return;
    }
    void execute(
      area
        ? {
            action: "update-area",
            areaId: area.areaId,
            displayName: displayName.trim(),
            expectedVersion: area.version,
            lifecycleStatus,
            sortOrder: parsedSortOrder,
            storeId: configuration.store.storeId,
          }
        : {
            action: "create-area",
            code: code.trim().toLowerCase(),
            displayName: displayName.trim(),
            expectedVersion: configuration.store.version,
            lifecycleStatus:
              lifecycleStatus === "archived" ? "draft" : lifecycleStatus,
            sortOrder: parsedSortOrder,
            storeId: configuration.store.storeId,
          },
      area ? "区域配置已由服务端确认保存" : "区域已由服务端确认创建",
    );
  }

  return (
    <DialogFrame
      firstFieldRef={initialFocusRef}
      icon={<MapPin />}
      onClose={onClose}
      submitting={submitting}
      title={area ? `编辑区域 ${area.code}` : "创建区域"}
    >
      <p className="store-config-dialog-notice">
        {referenced
          ? "该区域已有业务引用，只能在有效座位清空后归档，名称与排序保持原样。"
          : "未被业务引用且不含座位的草稿区域可以永久删除。"}
      </p>
      <div className="store-config-fields">
        <label>
          <span>区域代码</span>
          <input
            aria-label="区域代码"
            disabled={Boolean(area)}
            maxLength={20}
            onChange={(event) => setCode(event.target.value)}
            ref={codeFieldRef}
            value={code}
          />
        </label>
        <label>
          <span>显示名称</span>
          <input
            aria-label="区域显示名称"
            disabled={referenced}
            maxLength={60}
            onChange={(event) => setDisplayName(event.target.value)}
            ref={displayNameFieldRef}
            value={displayName}
          />
        </label>
        <label>
          <span>生命周期</span>
          <select
            aria-label="区域生命周期"
            onChange={(event) =>
              setLifecycleStatus(event.target.value as StoreAreaLifecycleStatus)
            }
            ref={lifecycleFieldRef}
            value={lifecycleStatus}
          >
            {lifecycleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>排序</span>
          <input
            aria-label="区域排序"
            disabled={referenced}
            inputMode="numeric"
            min={0}
            onChange={(event) => setSortOrder(event.target.value)}
            type="number"
            value={sortOrder}
          />
        </label>
      </div>
      {error ? (
        <p className="store-config-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer>
        {area?.lifecycleStatus === "draft" &&
        !area.businessReferenced &&
        area.seatCount === 0 ? (
          <button
            className="is-danger"
            disabled={submitting}
            onClick={() =>
              void execute(
                {
                  action: "delete-area",
                  areaId: area.areaId,
                  expectedVersion: area.version,
                  storeId: configuration.store.storeId,
                },
                "未引用的草稿区域已删除",
              )
            }
          >
            删除草稿
          </button>
        ) : null}
        <button disabled={submitting} onClick={onClose}>
          返回
        </button>
        <button
          className="is-primary"
          disabled={!code.trim() || !displayName.trim() || submitting}
          onClick={submit}
        >
          {submitting ? "提交中…" : area ? "保存区域" : "创建区域"}
        </button>
      </footer>
    </DialogFrame>
  );
}

function SeatDialog({
  configuration,
  onClose,
  onDependencies,
  onSubmit,
  seat,
}: {
  configuration: Configuration;
  onClose: () => void;
  onDependencies: (seat: StoreSeat) => void;
  onSubmit: (command: Command, success: string) => Promise<string | null>;
  seat?: StoreSeat;
}) {
  const [areaId, setAreaId] = useState(
    seat?.area.areaId ??
      configuration.areas.find((area) => area.lifecycleStatus !== "archived")
        ?.areaId ??
      "",
  );
  const [code, setCode] = useState(seat?.code ?? "");
  const [machineProfileId, setMachineProfileId] = useState(
    seat?.machineProfile.machineProfileId ??
      configuration.machineProfiles.find((profile) => !profile.archived)
        ?.machineProfileId ??
      "",
  );
  const [lifecycleStatus, setLifecycleStatus] = useState<SeatLifecycleStatus>(
    seat?.lifecycleStatus ?? "draft",
  );
  const operationalStatus = seat?.operationalStatus ?? "normal";
  const [sortOrder, setSortOrder] = useState(String(seat?.sortOrder ?? 100));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const codeFieldRef = useRef<HTMLInputElement>(null);
  const lifecycleFieldRef = useRef<HTMLSelectElement>(null);
  const referenced = seat?.businessReferenced ?? false;
  const initialFocusRef = referenced ? lifecycleFieldRef : codeFieldRef;
  const lifecycleOptions: ReadonlyArray<{
    label: string;
    value: SeatLifecycleStatus;
  }> = !seat
    ? [
        { label: "草稿", value: "draft" },
        { label: "有效", value: "active" },
      ]
    : seat.lifecycleStatus === "draft"
      ? referenced
        ? [{ label: "草稿", value: "draft" }]
        : [
            { label: "草稿", value: "draft" },
            { label: "有效", value: "active" },
          ]
      : seat.lifecycleStatus === "active"
        ? [
            { label: "有效", value: "active" },
            { label: "停用", value: "inactive" },
          ]
        : [{ label: "停用", value: "inactive" }];

  async function execute(command: Command, success: string) {
    setSubmitting(true);
    setError("");
    const failure = await onSubmit(command, success);
    if (failure) setError(failure);
    else onClose();
    setSubmitting(false);
  }

  function submit() {
    const parsedSortOrder = Number(sortOrder);
    if (
      !code.trim() ||
      !areaId ||
      !machineProfileId ||
      !Number.isInteger(parsedSortOrder) ||
      parsedSortOrder < 0
    ) {
      setError("请填写座位编号、区域、机型档案和非负整数排序值。");
      return;
    }
    const selectedArea = configuration.areas.find(
      (area) => area.areaId === areaId,
    );
    const selectedProfile = configuration.machineProfiles.find(
      (profile) => profile.machineProfileId === machineProfileId,
    );
    if (
      lifecycleStatus === "active" &&
      (!selectedArea || selectedArea.lifecycleStatus !== "active")
    ) {
      setError("有效座位只能放在有效区域，请先激活区域或选择其他区域。");
      return;
    }
    if (
      lifecycleStatus === "active" &&
      (!selectedProfile || selectedProfile.archived)
    ) {
      setError("有效座位必须使用未归档的总部机型档案。");
      return;
    }
    if (
      seat &&
      lifecycleStatus === "inactive" &&
      (seat.dependencies.activeReservations > 0 ||
        seat.dependencies.openRepairs > 0)
    ) {
      onDependencies(seat);
      return;
    }
    void execute(
      seat
        ? {
            action: "update-seat",
            areaId,
            code: code.trim().toUpperCase(),
            expectedVersion: seat.version,
            lifecycleStatus,
            machineProfileId,
            seatId: seat.seatId,
            sortOrder: parsedSortOrder,
            storeId: configuration.store.storeId,
          }
        : {
            action: "create-seat",
            areaId,
            code: code.trim().toUpperCase(),
            expectedVersion: configuration.store.version,
            lifecycleStatus:
              lifecycleStatus === "inactive" ? "draft" : lifecycleStatus,
            machineProfileId,
            sortOrder: parsedSortOrder,
            storeId: configuration.store.storeId,
          },
      seat ? "座位配置已由服务端确认保存" : "座位已由服务端确认创建",
    );
  }

  return (
    <DialogFrame
      firstFieldRef={initialFocusRef}
      icon={<Seat />}
      onClose={onClose}
      submitting={submitting}
      title={seat ? `编辑座位 ${seat.code}` : "创建座位"}
    >
      <p className="store-config-dialog-notice">
        {referenced
          ? "该座位已有业务引用，只能保持原编号、区域与机型并转为停用。"
          : "座位编号在门店内唯一；机型档案来自总部统一配置。"}
      </p>
      <div className="store-config-fields">
        <label>
          <span>座位编号</span>
          <input
            aria-label="座位编号"
            disabled={referenced}
            maxLength={20}
            onChange={(event) => setCode(event.target.value)}
            ref={codeFieldRef}
            value={code}
          />
        </label>
        <label>
          <span>区域</span>
          <select
            aria-label="座位区域"
            disabled={referenced}
            onChange={(event) => setAreaId(event.target.value)}
            value={areaId}
          >
            {configuration.areas
              .filter(
                (area) =>
                  area.areaId === seat?.area.areaId ||
                  (area.lifecycleStatus !== "archived" &&
                    (lifecycleStatus !== "active" ||
                      area.lifecycleStatus === "active")),
              )
              .map((area) => (
                <option key={area.areaId} value={area.areaId}>
                  {area.displayName} · {area.code}
                  {area.lifecycleStatus === "archived" ? "（已归档）" : ""}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span>总部机型档案</span>
          <select
            aria-label="总部机型档案"
            disabled={referenced}
            onChange={(event) => setMachineProfileId(event.target.value)}
            value={machineProfileId}
          >
            {configuration.machineProfiles
              .filter(
                (profile) =>
                  profile.machineProfileId ===
                    seat?.machineProfile.machineProfileId || !profile.archived,
              )
              .map((profile) => (
                <option
                  key={profile.machineProfileId}
                  value={profile.machineProfileId}
                >
                  {profile.displayName} · {profile.code}
                  {profile.archived ? "（已归档）" : ""}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span>生命周期</span>
          <select
            aria-label="座位生命周期"
            onChange={(event) =>
              setLifecycleStatus(event.target.value as SeatLifecycleStatus)
            }
            ref={lifecycleFieldRef}
            value={lifecycleStatus}
          >
            {lifecycleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>运营状态</span>
          <select aria-label="座位运营状态" disabled value={operationalStatus}>
            <option value="normal">正常</option>
            <option value="maintenance">维护中</option>
          </select>
        </label>
        <label>
          <span>排序</span>
          <input
            aria-label="座位排序"
            disabled={referenced}
            inputMode="numeric"
            min={0}
            onChange={(event) => setSortOrder(event.target.value)}
            type="number"
            value={sortOrder}
          />
        </label>
      </div>
      {seat &&
      (seat.dependencies.activeReservations > 0 ||
        seat.dependencies.openRepairs > 0) ? (
        <p className="store-config-dependency-summary">
          <Warning /> 有效预约 {seat.dependencies.activeReservations} 条 ·
          未关闭报修 {seat.dependencies.openRepairs} 条
        </p>
      ) : null}
      {error ? (
        <p className="store-config-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer>
        {seat?.lifecycleStatus === "draft" && !seat.businessReferenced ? (
          <button
            className="is-danger"
            disabled={submitting}
            onClick={() =>
              void execute(
                {
                  action: "delete-seat",
                  expectedVersion: seat.version,
                  seatId: seat.seatId,
                  storeId: configuration.store.storeId,
                },
                "未引用的草稿座位已删除",
              )
            }
          >
            删除草稿
          </button>
        ) : null}
        <button disabled={submitting} onClick={onClose}>
          返回
        </button>
        <button
          className="is-primary"
          disabled={!code.trim() || !areaId || !machineProfileId || submitting}
          onClick={submit}
        >
          {submitting ? "提交中…" : seat ? "保存座位" : "创建座位"}
        </button>
      </footer>
    </DialogFrame>
  );
}

function DependencyDialog({
  onClose,
  onNavigateRepairs,
  onNavigateReservations,
  readOnly,
  seat,
}: {
  onClose: () => void;
  onNavigateRepairs: () => void;
  onNavigateReservations: () => void;
  readOnly: boolean;
  seat: StoreSeat;
}) {
  const firstFieldRef = useRef<HTMLButtonElement>(null);
  return (
    <DialogFrame
      firstFieldRef={firstFieldRef}
      icon={<Warning />}
      onClose={onClose}
      submitting={false}
      title={`${seat.code} 暂不能停用`}
    >
      <p className="store-config-dialog-notice is-warning">
        {readOnly
          ? "总部只能理解当前业务依赖，不能从配置页处理预约或报修；请切换到对应门店的店长角色。"
          : "先处理仍在生效的业务依赖，再返回门店配置停用座位。服务端会再次核验，不会提前隐藏座位。"}
      </p>
      <div className="store-config-dependency-cards">
        {readOnly ? (
          <article>
            <CalendarPlus />
            <span>
              <strong>{seat.dependencies.activeReservations} 条有效预约</strong>
              <small>只读依赖 · 配置页不可履约</small>
            </span>
          </article>
        ) : (
          <button
            disabled={seat.dependencies.activeReservations === 0}
            onClick={onNavigateReservations}
            {...(seat.dependencies.activeReservations > 0
              ? { ref: firstFieldRef }
              : {})}
          >
            <CalendarPlus />
            <span>
              <strong>{seat.dependencies.activeReservations} 条有效预约</strong>
              <small>
                {seat.dependencies.activeReservations > 0
                  ? "前往实时运营处理预约"
                  : "当前无预约依赖"}
              </small>
            </span>
          </button>
        )}
        {readOnly ? (
          <article>
            <Wrench />
            <span>
              <strong>{seat.dependencies.openRepairs} 条未关闭报修</strong>
              <small>只读依赖 · 配置页不可处理</small>
            </span>
          </article>
        ) : (
          <button
            disabled={seat.dependencies.openRepairs === 0}
            onClick={onNavigateRepairs}
            {...(seat.dependencies.activeReservations === 0 &&
            seat.dependencies.openRepairs > 0
              ? { ref: firstFieldRef }
              : {})}
          >
            <Wrench />
            <span>
              <strong>{seat.dependencies.openRepairs} 条未关闭报修</strong>
              <small>
                {seat.dependencies.openRepairs > 0
                  ? "前往报修队列处理工单"
                  : "当前无报修依赖"}
              </small>
            </span>
          </button>
        )}
      </div>
      <footer>
        <button
          className="is-primary"
          onClick={onClose}
          {...(readOnly ? { ref: firstFieldRef } : {})}
        >
          知道了
        </button>
      </footer>
    </DialogFrame>
  );
}

function PricePlanDialog({
  baseline,
  configuration,
  csrfToken,
  onClose,
  onSubmit,
  previewEndpoint,
}: {
  baseline?: PricePlan;
  configuration: Configuration;
  csrfToken: string;
  onClose: () => void;
  onSubmit: (command: Command, success: string) => Promise<string | null>;
  previewEndpoint: string;
}) {
  const initialPlan =
    baseline ??
    configuration.pricePlans.find((plan) => plan.status === "current") ??
    configuration.pricePlans[0];
  const firstArea =
    configuration.areas.find((area) => area.lifecycleStatus === "active") ??
    configuration.areas[0];
  const firstProfile =
    configuration.machineProfiles.find((profile) => !profile.archived) ??
    configuration.machineProfiles[0];
  const [areaId, setAreaId] = useState(
    initialPlan?.area.areaId ?? firstArea?.areaId ?? "",
  );
  const [machineProfileId, setMachineProfileId] = useState(
    initialPlan?.machineProfile.machineProfileId ??
      firstProfile?.machineProfileId ??
      "",
  );
  const [startsAt, setStartsAt] = useState(initialPlan?.startsAt ?? "06:00");
  const [endsAt, setEndsAt] = useState(initialPlan?.endsAt ?? "06:00");
  const [endsNextDay, setEndsNextDay] = useState(
    initialPlan?.endsNextDay ?? true,
  );
  const [weekdayCents, setWeekdayCents] = useState(
    String(initialPlan?.weekdayHalfHourCents ?? 800),
  );
  const [weekendCents, setWeekendCents] = useState(
    String(initialPlan?.weekendHalfHourCents ?? 1_000),
  );
  const [effectiveFrom, setEffectiveFrom] = useState(
    shanghaiDateTimeLocal(nextHalfHour(configuration.currentTime)),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{
    readonly key: string;
    readonly result: ManagerPricePlanOverlapPreviewResponse;
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const areaFieldRef = useRef<HTMLSelectElement>(null);
  const parsedEffectiveFrom = parseShanghaiDateTimeLocal(effectiveFrom);
  const parsedWeekdayCents = Number(weekdayCents);
  const parsedWeekendCents = Number(weekendCents);
  const selectedArea = configuration.areas.find(
    (area) => area.areaId === areaId,
  );
  const selectedProfile = configuration.machineProfiles.find(
    (profile) => profile.machineProfileId === machineProfileId,
  );
  const rangeValid = endsNextDay ? endsAt <= startsAt : endsAt > startsAt;
  const effectiveFromIso = parsedEffectiveFrom?.toISOString() ?? "";
  const previewRequest = useMemo<ManagerPricePlanOverlapPreviewRequest | null>(
    () =>
      areaId &&
      machineProfileId &&
      effectiveFromIso &&
      /^\d{2}:(?:00|30)$/u.test(startsAt) &&
      /^\d{2}:(?:00|30)$/u.test(endsAt) &&
      rangeValid
        ? {
            areaId,
            effectiveFrom: effectiveFromIso,
            endsAt,
            endsNextDay,
            machineProfileId,
            startsAt,
          }
        : null,
    [
      areaId,
      effectiveFromIso,
      endsAt,
      endsNextDay,
      machineProfileId,
      rangeValid,
      startsAt,
    ],
  );
  const previewKey = previewRequest ? JSON.stringify(previewRequest) : "";

  useEffect(() => {
    if (!previewRequest) {
      setPreview(null);
      setPreviewError("");
      setPreviewing(false);
      return;
    }
    const controller = new AbortController();
    setPreview(null);
    setPreviewError("");
    setPreviewing(true);
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(previewEndpoint, {
            body: JSON.stringify(previewRequest),
            cache: "no-store",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrfToken,
            },
            method: "POST",
            signal: controller.signal,
          });
          const payload: unknown = await response.json();
          if (!response.ok) {
            setPreviewError(
              failureMessage(payload, "价格重叠检查失败，请稍后重试。"),
            );
            return;
          }
          setPreview({
            key: previewKey,
            result: payload as ManagerPricePlanOverlapPreviewResponse,
          });
        } catch {
          if (!controller.signal.aborted) {
            setPreviewError("价格重叠检查失败，请稍后重试。");
          }
        } finally {
          if (!controller.signal.aborted) setPreviewing(false);
        }
      })();
    }, 150);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [csrfToken, previewEndpoint, previewKey, previewRequest]);

  const previewReady = preview?.key === previewKey;
  const overlappingPlan = previewReady ? preview.result.overlap : null;
  const valid =
    Boolean(selectedArea && selectedProfile && parsedEffectiveFrom) &&
    parsedEffectiveFrom!.getTime() >
      new Date(configuration.currentTime).getTime() &&
    parsedEffectiveFrom!.getTime() % (30 * 60 * 1_000) === 0 &&
    /^\d{2}:(?:00|30)$/u.test(startsAt) &&
    /^\d{2}:(?:00|30)$/u.test(endsAt) &&
    rangeValid &&
    Number.isInteger(parsedWeekdayCents) &&
    parsedWeekdayCents >= 0 &&
    Number.isInteger(parsedWeekendCents) &&
    parsedWeekendCents >= 0 &&
    previewReady &&
    !previewing &&
    !previewError &&
    !overlappingPlan;

  async function submit() {
    if (!valid || !parsedEffectiveFrom || submitting) return;
    setSubmitting(true);
    setError("");
    const failure = await onSubmit(
      {
        action: "create-price-plan",
        areaId,
        effectiveFrom: parsedEffectiveFrom.toISOString(),
        endsAt,
        endsNextDay,
        expectedVersion: configuration.store.version,
        machineProfileId,
        startsAt,
        storeId: configuration.store.storeId,
        weekdayHalfHourCents: parsedWeekdayCents,
        weekendHalfHourCents: parsedWeekendCents,
      },
      "未来价格版本已由服务端确认创建",
    );
    if (failure) setError(failure);
    else onClose();
    setSubmitting(false);
  }

  return (
    <DialogFrame
      firstFieldRef={areaFieldRef}
      icon={<CurrencyDollar />}
      onClose={onClose}
      submitting={submitting}
      title="新建未来价格版本"
    >
      <p className="store-config-dialog-notice">
        只允许创建未来生效版本；同一门店、区域、机型与时段不能出现重叠版本。
      </p>
      <div className="store-config-fields">
        <label>
          <span>所属门店</span>
          <input disabled value={configuration.store.displayName} />
        </label>
        <label>
          <span>区域</span>
          <select
            aria-label="价格适用区域"
            onChange={(event) => setAreaId(event.target.value)}
            ref={areaFieldRef}
            value={areaId}
          >
            {configuration.areas
              .filter((area) => area.lifecycleStatus === "active")
              .map((area) => (
                <option key={area.areaId} value={area.areaId}>
                  {area.displayName} · {area.code}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span>总部机型</span>
          <select
            aria-label="价格适用机型"
            onChange={(event) => setMachineProfileId(event.target.value)}
            value={machineProfileId}
          >
            {configuration.machineProfiles
              .filter((profile) => !profile.archived)
              .map((profile) => (
                <option
                  key={profile.machineProfileId}
                  value={profile.machineProfileId}
                >
                  {profile.displayName} · {profile.code}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span>生效时间（上海时区）</span>
          <input
            aria-label="价格生效时间"
            min={shanghaiDateTimeLocal(nextHalfHour(configuration.currentTime))}
            onChange={(event) => setEffectiveFrom(event.target.value)}
            step={1_800}
            type="datetime-local"
            value={effectiveFrom}
          />
        </label>
        <label>
          <span>开始时刻</span>
          <input
            aria-label="价格时段开始"
            onChange={(event) => setStartsAt(event.target.value)}
            step={1_800}
            type="time"
            value={startsAt}
          />
        </label>
        <label>
          <span>结束时刻</span>
          <input
            aria-label="价格时段结束"
            onChange={(event) => setEndsAt(event.target.value)}
            step={1_800}
            type="time"
            value={endsAt}
          />
        </label>
        <label>
          <span>工作日每半小时（分）</span>
          <input
            aria-label="工作日每半小时价格"
            inputMode="numeric"
            min={0}
            onChange={(event) => setWeekdayCents(event.target.value)}
            type="number"
            value={weekdayCents}
          />
        </label>
        <label>
          <span>周末每半小时（分）</span>
          <input
            aria-label="周末每半小时价格"
            inputMode="numeric"
            min={0}
            onChange={(event) => setWeekendCents(event.target.value)}
            type="number"
            value={weekendCents}
          />
        </label>
        <label className="store-config-check">
          <input
            checked={endsNextDay}
            onChange={(event) => setEndsNextDay(event.target.checked)}
            type="checkbox"
          />
          <span>结束时刻属于次日（06:00 经营日边界）</span>
        </label>
      </div>
      <section
        className={`store-config-review ${overlappingPlan || !rangeValid || previewError ? "is-conflict" : ""}`}
      >
        <header>提交前核对</header>
        <div>
          <span>匹配范围</span>
          <strong>
            {configuration.store.displayName} /{" "}
            {selectedArea?.displayName ?? "—"} /{" "}
            {selectedProfile?.displayName ?? "—"}
          </strong>
        </div>
        <div>
          <span>价格与时段</span>
          <strong>
            工作日 {formatCents(parsedWeekdayCents || 0)} · 周末{" "}
            {formatCents(parsedWeekendCents || 0)} / 半小时；{startsAt}–{endsAt}
            {endsNextDay ? "（次日）" : ""}
          </strong>
        </div>
        <div>
          <span>生效与重叠</span>
          <strong>
            {parsedEffectiveFrom
              ? shanghaiDateTime(parsedEffectiveFrom.toISOString())
              : "时间无效"}
            ；
            {!previewRequest
              ? "请先填写有效时段"
              : previewError
                ? previewError
                : previewing || !previewReady
                  ? "正在由服务端检查…"
                  : overlappingPlan
                    ? `与 v${overlappingPlan.version} 重叠`
                    : "服务端未发现重叠"}
          </strong>
        </div>
        <p>新版本仅影响生效后的新预约，不会改写已有预约价格快照。</p>
      </section>
      {error ? (
        <p className="store-config-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer>
        <button disabled={submitting} onClick={onClose}>
          返回
        </button>
        <button
          className="is-primary"
          disabled={!valid || submitting}
          onClick={() => void submit()}
        >
          {submitting ? "提交中…" : "确认创建版本"}
        </button>
      </footer>
    </DialogFrame>
  );
}

function StoreProductDialog({
  configuration,
  onClose,
  onSubmit,
  product,
}: {
  configuration: Configuration;
  onClose: () => void;
  onSubmit: (command: Command, success: string) => Promise<string | null>;
  product: StoreProduct;
}) {
  const [listed, setListed] = useState(product.listed);
  const [unitPriceCents, setUnitPriceCents] = useState(
    String(product.unitPriceCents),
  );
  const [lowStockThreshold, setLowStockThreshold] = useState(
    String(product.lowStockThreshold),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const listedFieldRef = useRef<HTMLInputElement>(null);
  const parsedPrice = Number(unitPriceCents);
  const parsedThreshold = Number(lowStockThreshold);
  const valid =
    !product.archived &&
    Number.isInteger(parsedPrice) &&
    parsedPrice >= 0 &&
    Number.isInteger(parsedThreshold) &&
    parsedThreshold >= 0;

  async function execute(command: Command, success: string) {
    setSubmitting(true);
    setError("");
    const failure = await onSubmit(command, success);
    if (failure) setError(failure);
    else onClose();
    setSubmitting(false);
  }

  return (
    <DialogFrame
      firstFieldRef={listedFieldRef}
      icon={<Package />}
      onClose={onClose}
      submitting={submitting}
      title={`门店商品 · ${product.headquartersProduct.displayName}`}
    >
      <p className="store-config-dialog-notice">
        总部商品档案只读；门店只维护上架、整数分价格与库存预警阈值。下架或归档不会改写历史订单。
      </p>
      <div className="store-config-fields">
        <label>
          <span>总部商品代码</span>
          <input disabled value={product.headquartersProduct.code} />
        </label>
        <label>
          <span>总部分类</span>
          <input
            disabled
            value={productCategoryLabel(product.headquartersProduct.category)}
          />
        </label>
        <label className="is-wide">
          <span>总部名称与说明</span>
          <textarea
            disabled
            value={`${product.headquartersProduct.displayName}\n${product.headquartersProduct.description}`}
          />
        </label>
        <label className="store-config-check">
          <input
            aria-label="门店上架"
            checked={listed}
            disabled={product.archived}
            onChange={(event) => setListed(event.target.checked)}
            ref={listedFieldRef}
            type="checkbox"
          />
          <span>在当前门店上架</span>
        </label>
        <label>
          <span>门店售价（分）</span>
          <input
            aria-label="门店商品售价"
            disabled={product.archived}
            inputMode="numeric"
            min={0}
            onChange={(event) => setUnitPriceCents(event.target.value)}
            type="number"
            value={unitPriceCents}
          />
        </label>
        <label>
          <span>低库存预警阈值</span>
          <input
            aria-label="低库存预警阈值"
            disabled={product.archived}
            inputMode="numeric"
            min={0}
            onChange={(event) => setLowStockThreshold(event.target.value)}
            type="number"
            value={lowStockThreshold}
          />
        </label>
        <label>
          <span>在手 / 预留</span>
          <input
            disabled
            value={`${product.onHandQuantity} / ${product.reservedQuantity}`}
          />
        </label>
        <label>
          <span>可用库存</span>
          <input disabled value={product.availableQuantity} />
        </label>
      </div>
      {product.businessReferenced ? (
        <p className="store-config-dependency-summary">
          <Warning /> 已有订单引用；允许下架或归档配置，历史订单快照保持不变。
        </p>
      ) : null}
      {error ? (
        <p className="store-config-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer>
        {!product.archived ? (
          <button
            className="is-danger"
            disabled={submitting}
            onClick={() =>
              void execute(
                {
                  action: "archive-store-product",
                  expectedVersion: product.version,
                  storeId: configuration.store.storeId,
                  storeProductId: product.storeProductId,
                },
                "门店商品配置已归档，历史订单保持不变",
              )
            }
          >
            归档配置
          </button>
        ) : null}
        <button disabled={submitting} onClick={onClose}>
          返回
        </button>
        <button
          className="is-primary"
          disabled={!valid || submitting}
          onClick={() =>
            void execute(
              {
                action: "update-store-product",
                expectedVersion: product.version,
                listed,
                lowStockThreshold: parsedThreshold,
                storeId: configuration.store.storeId,
                storeProductId: product.storeProductId,
                unitPriceCents: parsedPrice,
              },
              "门店商品配置已由服务端确认保存",
            )
          }
        >
          {submitting ? "提交中…" : "保存门店配置"}
        </button>
      </footer>
    </DialogFrame>
  );
}

function HeadquartersProductScopeDialog({
  catalogs,
  onClose,
  onSubmit,
  product,
}: {
  catalogs: HeadquartersCatalogsResponse;
  onClose: () => void;
  onSubmit: (
    command: HeadquartersCatalogCommandRequest,
    success: string,
  ) => Promise<string | null>;
  product: HeadquartersProduct;
}) {
  const [availableStoreIds, setAvailableStoreIds] = useState(
    product.availableStores.map((store) => store.storeId),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const firstFieldRef = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!availableStoreIds.length) {
      setError("商品范围至少保留一家固定门店。");
      return;
    }
    setSubmitting(true);
    setError("");
    const failure = await onSubmit(
      {
        action: "update-product",
        availableStoreIds,
        category: product.category,
        description: product.description,
        displayName: product.displayName,
        expectedVersion: product.version,
        productId: product.productId,
      },
      "商品适用门店范围已保存，历史订单与库存记录保持不变",
    );
    if (failure) setError(failure);
    else onClose();
    setSubmitting(false);
  }

  return (
    <DialogFrame
      eyebrow="连锁商品范围 · 服务端确认"
      firstFieldRef={firstFieldRef}
      icon={<Package />}
      onClose={onClose}
      submitting={submitting}
      title={`商品适用门店范围 · ${product.displayName}`}
    >
      <p className="store-config-dialog-notice">
        范围变化只影响新目录与新订单；既有门店商品、库存和历史订单继续保留，只读事实不会被改写。
      </p>
      <div className="store-config-fields">
        <label>
          <span>商品代码</span>
          <input disabled value={product.code} />
        </label>
        <label>
          <span>总部商品资料</span>
          <input disabled value={product.displayName} />
        </label>
        <fieldset className="hq-catalog-store-scope is-wide">
          <legend>适用固定门店</legend>
          {catalogs.stores.map((store, index) => (
            <label key={store.storeId}>
              <input
                checked={availableStoreIds.includes(store.storeId)}
                onChange={(event) =>
                  setAvailableStoreIds((current) =>
                    event.target.checked
                      ? [...current, store.storeId]
                      : current.filter((storeId) => storeId !== store.storeId),
                  )
                }
                ref={index === 0 ? firstFieldRef : undefined}
                type="checkbox"
              />
              <span>{store.displayName}</span>
            </label>
          ))}
        </fieldset>
      </div>
      <section className="store-config-review">
        <header>提交前核对</header>
        <div>
          <span>适用范围</span>
          <strong>{availableStoreIds.length}/3 家固定门店</strong>
        </div>
        <div>
          <span>未来影响</span>
          <strong>仅新目录与新订单</strong>
        </div>
        <p>既有门店商品、库存流水与历史订单保持不变。</p>
      </section>
      {error ? (
        <p className="store-config-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer>
        <button disabled={submitting} onClick={onClose}>
          返回
        </button>
        <button
          className="is-primary"
          disabled={submitting}
          onClick={() => void submit()}
        >
          {submitting ? "提交中…" : "保存商品范围"}
        </button>
      </footer>
    </DialogFrame>
  );
}

function StoreConfiguration({
  catalogs,
  csrfToken,
  mode,
  onNavigateRepairs,
  onNavigateReservations,
  onProductScopeSubmit,
  onSelectStore,
  onToast,
  refreshKey,
  selectedStoreId,
  storeOptions,
}: {
  catalogs?: HeadquartersCatalogsResponse;
  csrfToken: string;
  mode: "headquarters" | "manager";
  onNavigateRepairs: () => void;
  onNavigateReservations: () => void;
  onProductScopeSubmit?: (
    command: HeadquartersCatalogCommandRequest,
    success: string,
  ) => Promise<string | null>;
  onSelectStore?: (storeId: string) => void;
  onToast: (message: string) => void;
  refreshKey: string;
  selectedStoreId?: string;
  storeOptions?: HeadquartersCatalogsResponse["stores"];
}) {
  const [configuration, setConfiguration] = useState<Configuration | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<ConfigurationTab>("profile");
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const profileTabRef = useRef<HTMLButtonElement>(null);
  const seatsTabRef = useRef<HTMLButtonElement>(null);
  const pricingTabRef = useRef<HTMLButtonElement>(null);
  const productsTabRef = useRef<HTMLButtonElement>(null);
  const pendingCommandKeysRef = useRef(new Map<string, string>());
  const configurationEndpointRef = useRef("");
  const loadSequenceRef = useRef(0);
  const headquartersQuery =
    mode === "headquarters" && selectedStoreId
      ? `?storeId=${encodeURIComponent(selectedStoreId)}`
      : "";
  const configurationEndpoint =
    mode === "headquarters"
      ? `/api/v1/hq/store-configuration${headquartersQuery}`
      : "/api/v1/manager/store-configuration";
  const commandEndpoint =
    mode === "headquarters"
      ? "/api/v1/hq/store-configuration/commands"
      : "/api/v1/manager/store-configuration/commands";
  const previewEndpoint =
    mode === "headquarters"
      ? `/api/v1/hq/store-configuration/price-overlap-preview${headquartersQuery}`
      : "/api/v1/manager/store-configuration/price-overlap-preview";
  configurationEndpointRef.current = configurationEndpoint;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (configurationEndpointRef.current !== configurationEndpoint) {
        return false;
      }
      const sequence = ++loadSequenceRef.current;
      setLoading(true);
      setError("");
      try {
        const response = await fetch(configurationEndpoint, {
          cache: "no-store",
          credentials: "same-origin",
          ...(signal ? { signal } : {}),
        });
        const payload: unknown = await response.json();
        if (
          sequence !== loadSequenceRef.current ||
          configurationEndpointRef.current !== configurationEndpoint
        ) {
          return false;
        }
        if (!response.ok) {
          setError(failureMessage(payload, "门店配置读取失败，请稍后重试。"));
          return false;
        }
        setConfiguration(payload as Configuration);
        return true;
      } catch {
        if (
          signal?.aborted ||
          sequence !== loadSequenceRef.current ||
          configurationEndpointRef.current !== configurationEndpoint
        ) {
          return false;
        }
        setError("门店配置读取失败，页面不会展示未经服务端确认的数据。");
        return false;
      } finally {
        if (
          sequence === loadSequenceRef.current &&
          configurationEndpointRef.current === configurationEndpoint
        ) {
          setLoading(false);
        }
      }
    },
    [configurationEndpoint],
  );

  useEffect(() => {
    const controller = new AbortController();
    setConfiguration(null);
    setDialog(null);
    setLoading(true);
    void load(controller.signal);
    return () => {
      controller.abort();
      loadSequenceRef.current += 1;
    };
  }, [load, refreshKey]);

  const execute = useCallback(
    async (command: Command, success: string) => {
      const requestPayload = JSON.stringify(command);
      const idempotencyKey =
        pendingCommandKeysRef.current.get(requestPayload) ??
        createBrowserUuid();
      pendingCommandKeysRef.current.set(requestPayload, idempotencyKey);
      try {
        const response = await fetch(commandEndpoint, {
          body: requestPayload,
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
            "X-CSRF-Token": csrfToken,
          },
          method: "POST",
        });
        const payload: unknown = await response.json();
        const outcomeUnknown =
          response.status === 408 || response.status >= 500;
        if (!outcomeUnknown) {
          pendingCommandKeysRef.current.delete(requestPayload);
        }
        if (!response.ok) {
          const message = outcomeUnknown
            ? "提交结果暂时未知，请使用原提交标识安全重试。"
            : failureMessage(
                payload,
                "配置未能提交，服务端数据保持不变；请安全重试。",
              );
          if (response.status === 404 || response.status === 409) {
            const refreshed = await load();
            setDialog(null);
            window.requestAnimationFrame(() => returnFocusRef.current?.focus());
            setError(
              refreshed
                ? `${message} 已载入最新配置，请重新打开表单。`
                : `${message} 最新配置回读失败，请刷新页面后再继续。`,
            );
          }
          return message;
        }
        if (!(await load())) {
          return "服务端已确认写入，但最新配置回读失败；请刷新页面后再继续。";
        }
        onToast(success);
        return null;
      } catch {
        return "提交结果暂时未知，请使用原提交标识安全重试。";
      }
    },
    [commandEndpoint, csrfToken, load, onToast],
  );

  const seats = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("zh-CN");
    return (configuration?.seats ?? []).filter(
      (seat) =>
        (areaFilter === "all" || seat.area.areaId === areaFilter) &&
        (!normalized ||
          `${seat.code} ${seat.area.displayName} ${seat.machineProfile.displayName}`
            .toLocaleLowerCase("zh-CN")
            .includes(normalized)),
    );
  }, [areaFilter, configuration, search]);

  function openDialog(next: DialogState, trigger: HTMLButtonElement) {
    returnFocusRef.current = trigger;
    setDialog(next);
  }

  function closeDialog() {
    setDialog(null);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }

  function selectHeadquartersStore(storeId: string) {
    if (storeId === selectedStoreId) return;
    setDialog(null);
    setAreaFilter("all");
    setSearch("");
    setConfiguration(null);
    setLoading(true);
    onSelectStore?.(storeId);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const tabs: ReadonlyArray<{
      ref: RefObject<HTMLButtonElement | null>;
      value: ConfigurationTab;
    }> = [
      { ref: profileTabRef, value: "profile" },
      { ref: seatsTabRef, value: "seats" },
      { ref: pricingTabRef, value: "pricing" },
      { ref: productsTabRef, value: "products" },
    ];
    const currentIndex = tabs.findIndex((item) => item.value === tab);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowLeft"
            ? (currentIndex - 1 + tabs.length) % tabs.length
            : (currentIndex + 1) % tabs.length;
    const nextTab = tabs[nextIndex]!;
    setTab(nextTab.value);
    nextTab.ref.current?.focus();
  }

  if (loading && !configuration)
    return (
      <main className="store-config-main">
        <section className="store-config-state">
          {mode === "headquarters"
            ? "正在读取固定三店配置…"
            : "正在读取所属门店配置…"}
        </section>
      </main>
    );
  if (error && !configuration)
    return (
      <main className="store-config-main">
        <section className="store-config-state is-error" role="alert">
          <Warning />
          <span>{error}</span>
          <button onClick={() => void load()}>重新读取</button>
        </section>
      </main>
    );
  if (!configuration) return null;

  return (
    <main className="store-config-main">
      <header className="store-config-title-row">
        <div>
          <span>
            {configuration.store.displayName} ·{" "}
            {mode === "headquarters" ? "固定三店配置" : "固定所属门店"}
          </span>
          <h1>门店配置</h1>
          <p>被业务引用的配置只能归档或停用；历史预约与价格快照保持不可变。</p>
        </div>
        {mode === "headquarters" ? (
          <label className="store-config-store-selector">
            <span>当前门店</span>
            <select
              onChange={(event) => selectHeadquartersStore(event.target.value)}
              value={selectedStoreId}
            >
              {storeOptions?.map((store) => (
                <option key={store.storeId} value={store.storeId}>
                  {store.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <strong>
            <MapPin /> {configuration.store.fictitiousCity}
          </strong>
        )}
      </header>
      {mode === "headquarters" ? (
        <nav
          aria-label="固定三店快捷切换"
          className="store-config-store-switcher"
        >
          {storeOptions?.map((store) => (
            <button
              aria-current={
                store.storeId === selectedStoreId ? "page" : undefined
              }
              className={store.storeId === selectedStoreId ? "is-active" : ""}
              data-store-tone={store.code}
              key={store.storeId}
              onClick={() => selectHeadquartersStore(store.storeId)}
              type="button"
            >
              <Storefront />
              <span>
                <strong>{store.displayName}</strong>
                <small>{store.code}</small>
              </span>
            </button>
          ))}
        </nav>
      ) : null}
      <section className="store-config-fixed-note">
        <Archive />
        <span>
          <strong>固定演示门店 · 不可新增、删除或停用门店</strong>
          <small>
            {mode === "headquarters"
              ? "总部只能在棱镜旗舰店、星桥标准店和极点新店间切换；不继承到店、履约、维修、库存、签到或交接入口。"
              : "店长只能维护当前所属门店；城市和介绍必须保持为虚构演示数据。"}
          </small>
        </span>
      </section>
      {error ? (
        <section className="store-config-state is-error" role="alert">
          <Warning />
          <span>{error}</span>
        </section>
      ) : null}
      <div
        className="store-config-tabs"
        role="tablist"
        aria-label="门店配置分类"
      >
        <button
          aria-controls="store-config-profile-panel"
          aria-selected={tab === "profile"}
          className={tab === "profile" ? "is-active" : ""}
          id="store-config-profile-tab"
          onKeyDown={handleTabKeyDown}
          onClick={() => setTab("profile")}
          ref={profileTabRef}
          role="tab"
          tabIndex={tab === "profile" ? 0 : -1}
        >
          基本资料
        </button>
        <button
          aria-controls="store-config-seats-panel"
          aria-selected={tab === "seats"}
          className={tab === "seats" ? "is-active" : ""}
          id="store-config-seats-tab"
          onKeyDown={handleTabKeyDown}
          onClick={() => setTab("seats")}
          ref={seatsTabRef}
          role="tab"
          tabIndex={tab === "seats" ? 0 : -1}
        >
          区域与座位 <span>{configuration.seats.length}</span>
        </button>
        <button
          aria-controls="store-config-pricing-panel"
          aria-selected={tab === "pricing"}
          className={tab === "pricing" ? "is-active" : ""}
          id="store-config-pricing-tab"
          onClick={() => setTab("pricing")}
          onKeyDown={handleTabKeyDown}
          ref={pricingTabRef}
          role="tab"
          tabIndex={tab === "pricing" ? 0 : -1}
        >
          价格计划 <span>{configuration.pricePlans.length}</span>
        </button>
        <button
          aria-controls="store-config-products-panel"
          aria-selected={tab === "products"}
          className={tab === "products" ? "is-active" : ""}
          id="store-config-products-tab"
          onClick={() => setTab("products")}
          onKeyDown={handleTabKeyDown}
          ref={productsTabRef}
          role="tab"
          tabIndex={tab === "products" ? 0 : -1}
        >
          {mode === "headquarters" ? "商品范围" : "商品上架"}{" "}
          <span>
            {mode === "headquarters"
              ? (catalogs?.products.length ?? 0)
              : configuration.products.length}
          </span>
        </button>
      </div>
      {tab === "profile" ? (
        <div
          aria-labelledby="store-config-profile-tab"
          className="store-config-profile-grid"
          id="store-config-profile-panel"
          role="tabpanel"
        >
          <ProfilePanel configuration={configuration} onSubmit={execute} />
          <section className="store-config-hours-card">
            <header>
              <span>
                <Clock />
              </span>
              <div>
                <h2>营业时间</h2>
                <p>当前规则与未来版本分开记录。</p>
              </div>
              <button
                onClick={(event) =>
                  openDialog({ kind: "hours" }, event.currentTarget)
                }
              >
                <Plus /> 新建规则
              </button>
            </header>
            <div className="store-config-current-hours">
              <small>当前服务端规则</small>
              <strong>{configuration.businessHours.current.display}</strong>
              <span>
                {configuration.businessHours.current.isOpen24Hours
                  ? "24 小时营业"
                  : "按经营日边界计算"}
              </span>
            </div>
            <div className="store-config-scheduled-hours">
              <h3>默认回退与各适用日已生效版本</h3>
              <article>
                <span>
                  <strong>
                    {configuration.businessHours.baseline.isOpen24Hours
                      ? "00:00–24:00"
                      : `${configuration.businessHours.baseline.opensAt}–${configuration.businessHours.baseline.closesAt}${configuration.businessHours.baseline.closesNextDay ? "（次日）" : ""}`}
                  </strong>
                  <small>默认回退</small>
                </span>
                <time>未命中适用日版本时使用</time>
              </article>
              {configuration.businessHours.effective.length ? (
                configuration.businessHours.effective.map((rule) => (
                  <article key={rule.businessHoursId}>
                    <span>
                      <strong>
                        {rule.isOpen24Hours
                          ? "00:00–24:00"
                          : `${rule.opensAt}–${rule.closesAt}${rule.closesNextDay ? "（次日）" : ""}`}
                      </strong>
                      <small>
                        {rule.daySet === "all"
                          ? "每天"
                          : rule.daySet === "weekdays"
                            ? "工作日"
                            : "周末"}
                      </small>
                    </span>
                    <time>{shanghaiDateTime(rule.effectiveFrom)} 起</time>
                  </article>
                ))
              ) : (
                <p>尚无各适用日已生效版本。</p>
              )}
            </div>
            <div className="store-config-scheduled-hours">
              <h3>未来规则</h3>
              {configuration.businessHours.scheduled.length ? (
                configuration.businessHours.scheduled.map((rule) => (
                  <article key={rule.businessHoursId}>
                    <span>
                      <strong>
                        {rule.isOpen24Hours
                          ? "00:00–24:00"
                          : `${rule.opensAt}–${rule.closesAt}${rule.closesNextDay ? "（次日）" : ""}`}
                      </strong>
                      <small>
                        {rule.daySet === "all"
                          ? "每天"
                          : rule.daySet === "weekdays"
                            ? "工作日"
                            : "周末"}
                      </small>
                    </span>
                    <time>{shanghaiDateTime(rule.effectiveFrom)} 生效</time>
                  </article>
                ))
              ) : (
                <p>尚未安排未来规则。</p>
              )}
            </div>
          </section>
        </div>
      ) : tab === "seats" ? (
        <div
          aria-labelledby="store-config-seats-tab"
          className="store-config-seats-layout"
          id="store-config-seats-panel"
          role="tabpanel"
        >
          <aside className="store-config-areas">
            <header>
              <div>
                <small>空间结构</small>
                <h2>区域</h2>
              </div>
              <button
                aria-label="创建区域"
                onClick={(event) =>
                  openDialog({ kind: "area" }, event.currentTarget)
                }
              >
                <Plus />
              </button>
            </header>
            <button
              className={areaFilter === "all" ? "is-selected" : ""}
              onClick={() => setAreaFilter("all")}
            >
              <span>
                <strong>全部区域</strong>
                <small>含草稿与归档配置</small>
              </span>
              <b>{configuration.seats.length}</b>
            </button>
            {configuration.areas.map((area) => (
              <div
                className={areaFilter === area.areaId ? "is-selected" : ""}
                key={area.areaId}
              >
                <button onClick={() => setAreaFilter(area.areaId)}>
                  <span>
                    <strong>{area.displayName}</strong>
                    <small>
                      {area.code} ·{" "}
                      {area.lifecycleStatus === "active"
                        ? "有效"
                        : area.lifecycleStatus === "draft"
                          ? "草稿"
                          : "已归档"}
                    </small>
                  </span>
                  <b>{area.seatCount}</b>
                </button>
                <button
                  aria-label={`编辑区域 ${area.code}`}
                  onClick={(event) => {
                    openDialog({ kind: "area", area }, event.currentTarget);
                  }}
                >
                  <PencilSimple />
                </button>
              </div>
            ))}
          </aside>
          <section className="store-config-seat-panel">
            <header>
              <div>
                <small>门店内唯一编号 · 总部机型档案</small>
                <h2>座位</h2>
              </div>
              <button
                className="is-primary"
                onClick={(event) =>
                  openDialog({ kind: "seat" }, event.currentTarget)
                }
              >
                <Plus /> 新建座位
              </button>
            </header>
            <div className="store-config-seat-filter">
              <label>
                <MagnifyingGlass />
                <input
                  aria-label="搜索座位"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索编号、区域或机型"
                  value={search}
                />
              </label>
            </div>
            <div className="store-config-seat-table-wrap">
              <table className="store-config-seat-table">
                <thead>
                  <tr>
                    <th>座位编号</th>
                    <th>区域</th>
                    <th>总部机型</th>
                    <th>状态</th>
                    <th>业务依赖</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {seats.map((seat) => (
                    <tr key={seat.seatId}>
                      <td>
                        <strong>{seat.code}</strong>
                        <small>v{seat.version}</small>
                      </td>
                      <td>{seat.area.displayName}</td>
                      <td>
                        <strong>{seat.machineProfile.displayName}</strong>
                        <small>{seat.machineProfile.code}</small>
                      </td>
                      <td>
                        <span
                          className={`store-config-status is-${seat.lifecycleStatus}`}
                        >
                          {seat.lifecycleStatus === "active"
                            ? seat.operationalStatus === "maintenance"
                              ? "维护中"
                              : "有效"
                            : seat.lifecycleStatus === "draft"
                              ? "草稿"
                              : "已停用"}
                        </span>
                      </td>
                      <td>
                        {seat.dependencies.activeReservations ||
                        seat.dependencies.openRepairs ? (
                          <button
                            className="store-config-dependency-link"
                            onClick={(event) =>
                              openDialog(
                                { kind: "dependencies", seat },
                                event.currentTarget,
                              )
                            }
                          >
                            {seat.dependencies.activeReservations} 预约 ·{" "}
                            {seat.dependencies.openRepairs} 报修
                          </button>
                        ) : (
                          <span className="store-config-no-dependency">
                            无阻断依赖
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          aria-label={`编辑座位 ${seat.code}`}
                          className="store-config-edit-button"
                          onClick={(event) =>
                            openDialog(
                              { kind: "seat", seat },
                              event.currentTarget,
                            )
                          }
                        >
                          <PencilSimple /> 编辑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!seats.length ? (
                <p className="store-config-empty">没有符合条件的座位。</p>
              ) : null}
            </div>
          </section>
        </div>
      ) : tab === "pricing" ? (
        <section
          aria-labelledby="store-config-pricing-tab"
          className="store-config-data-panel"
          id="store-config-pricing-panel"
          role="tabpanel"
        >
          <header>
            <span>
              <CurrencyDollar />
            </span>
            <div>
              <small>未来版本 · 整数分 · 06:00 经营日</small>
              <h2>价格计划</h2>
              <p>历史版本只读；新版本生效后，已有预约价格快照保持不变。</p>
            </div>
            <button
              className="is-primary"
              onClick={(event) =>
                openDialog({ kind: "price" }, event.currentTarget)
              }
            >
              <Plus /> 新建未来版本
            </button>
          </header>
          <div className="store-config-seat-table-wrap store-config-data-table-wrap">
            <table className="store-config-seat-table store-config-data-table">
              <thead>
                <tr>
                  <th>门店 / 区域</th>
                  <th>总部机型</th>
                  <th>适用时段</th>
                  <th>工作日 / 周末</th>
                  <th>有效期</th>
                  <th>版本状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {orderedPricePlans(configuration.pricePlans).map((plan) => (
                  <tr key={plan.pricePlanId}>
                    <td>
                      <strong>{plan.area.displayName}</strong>
                      <small>
                        {plan.store.displayName} · {plan.area.code}
                      </small>
                    </td>
                    <td>
                      <strong>{plan.machineProfile.displayName}</strong>
                      <small>{plan.machineProfile.code}</small>
                    </td>
                    <td>
                      <strong>
                        {plan.startsAt}–{plan.endsAt}
                      </strong>
                      <small>
                        {plan.endsNextDay ? "结束于次日" : "当日时段"}
                      </small>
                    </td>
                    <td>
                      <strong>
                        {plan.legacyWeekdayBreakdown
                          ? `基准 ${formatCents(plan.legacyWeekdayBreakdown.baseHalfHourCents)}`
                          : formatCents(plan.weekdayHalfHourCents)}
                      </strong>
                      <small>
                        {plan.legacyWeekdayBreakdown
                          ? `晚间 ${formatCents(plan.legacyWeekdayBreakdown.eveningHalfHourCents)} · 凌晨 ${formatCents(plan.legacyWeekdayBreakdown.overnightHalfHourCents)}`
                          : `${formatCents(plan.weekendHalfHourCents)} / 半小时`}
                      </small>
                      {plan.legacyWeekdayBreakdown ? (
                        <small>
                          周末 {formatCents(plan.weekendHalfHourCents)} / 半小时
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <strong>{shanghaiDateTime(plan.effectiveFrom)}</strong>
                      <small>
                        {plan.effectiveUntil
                          ? `至 ${shanghaiDateTime(plan.effectiveUntil)}`
                          : "持续有效"}
                      </small>
                    </td>
                    <td>
                      <span className={`store-config-status is-${plan.status}`}>
                        v{plan.version} ·{" "}
                        {plan.status === "current"
                          ? "当前"
                          : plan.status === "scheduled"
                            ? "未来"
                            : plan.status === "historical"
                              ? "历史"
                              : "已归档"}
                      </span>
                    </td>
                    <td>
                      {plan.status === "scheduled" ? (
                        <button
                          className="store-config-edit-button"
                          onClick={() =>
                            void execute(
                              {
                                action: "archive-price-plan",
                                expectedVersion: plan.configVersion,
                                pricePlanId: plan.pricePlanId,
                                storeId: configuration.store.storeId,
                              },
                              "未来价格版本已归档",
                            )
                          }
                        >
                          <Archive /> 归档
                        </button>
                      ) : mode === "headquarters" &&
                        plan.status === "current" ? (
                        <button
                          className="store-config-edit-button"
                          onClick={(event) =>
                            openDialog(
                              { kind: "price", plan },
                              event.currentTarget,
                            )
                          }
                        >
                          <PencilSimple /> 基于当前调整
                        </button>
                      ) : (
                        <span className="store-config-no-dependency">只读</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : mode === "headquarters" ? (
        <section
          aria-labelledby="store-config-products-tab"
          className="store-config-data-panel"
          id="store-config-products-panel"
          role="tabpanel"
        >
          <header>
            <span>
              <Package />
            </span>
            <div>
              <small>连锁主资料 · 固定门店集合</small>
              <h2>商品适用门店范围</h2>
              <p>
                只维护新销售的适用范围；售价、上架、阈值和库存仍由对应店长管理。
              </p>
            </div>
          </header>
          <div className="store-config-seat-table-wrap store-config-data-table-wrap">
            <table className="store-config-seat-table store-config-data-table is-products">
              <thead>
                <tr>
                  <th>总部商品</th>
                  <th>分类</th>
                  <th>当前范围</th>
                  <th>未来影响</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {catalogs?.products.map((product) => (
                  <tr key={product.productId}>
                    <td>
                      <strong>{product.displayName}</strong>
                      <small>{product.code}</small>
                    </td>
                    <td>{productCategoryLabel(product.category)}</td>
                    <td>
                      <strong>
                        {product.availableStores.length === 3
                          ? "三店可用"
                          : product.availableStores
                              .map((store) => store.displayName)
                              .join("、") || "暂无适用门店"}
                      </strong>
                      <small>
                        {product.availableStores.length}/3 家固定门店
                      </small>
                    </td>
                    <td>
                      <span className="store-config-no-dependency">
                        新目录与新订单
                      </span>
                      <small>历史订单与库存记录不变</small>
                    </td>
                    <td>
                      <button
                        aria-label="编辑商品范围"
                        className="store-config-edit-button"
                        disabled={product.archived}
                        onClick={(event) =>
                          openDialog(
                            { kind: "headquarters-product", product },
                            event.currentTarget,
                          )
                        }
                      >
                        <PencilSimple /> 编辑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section
          aria-labelledby="store-config-products-tab"
          className="store-config-data-panel"
          id="store-config-products-panel"
          role="tabpanel"
        >
          <header>
            <span>
              <Package />
            </span>
            <div>
              <small>总部商品只读 · 门店配置可维护</small>
              <h2>商品上架</h2>
              <p>只调整本店上架、售价和库存阈值；下架与归档不改写历史订单。</p>
            </div>
          </header>
          <div className="store-config-seat-table-wrap store-config-data-table-wrap">
            <table className="store-config-seat-table store-config-data-table is-products">
              <thead>
                <tr>
                  <th>总部商品</th>
                  <th>分类</th>
                  <th>门店售价</th>
                  <th>库存</th>
                  <th>预警阈值</th>
                  <th>门店状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {configuration.products.map((product) => (
                  <tr key={product.storeProductId}>
                    <td>
                      <strong>{product.headquartersProduct.displayName}</strong>
                      <small>{product.headquartersProduct.code}</small>
                    </td>
                    <td>
                      {productCategoryLabel(
                        product.headquartersProduct.category,
                      )}
                    </td>
                    <td>
                      <strong>{formatCents(product.unitPriceCents)}</strong>
                      <small>整数分</small>
                    </td>
                    <td>
                      <strong>{product.availableQuantity} 可用</strong>
                      <small>
                        {product.onHandQuantity} 在手 ·{" "}
                        {product.reservedQuantity} 预留
                      </small>
                    </td>
                    <td>
                      <strong>{product.lowStockThreshold}</strong>
                      <small>
                        {product.alerting ? "已触发预警" : "库存正常"}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`store-config-status ${product.archived ? "is-archived" : product.listed ? "is-current" : "is-inactive"}`}
                      >
                        {product.archived
                          ? "已归档"
                          : product.listed
                            ? "已上架"
                            : "已下架"}
                      </span>
                    </td>
                    <td>
                      <button
                        aria-label={`配置商品 ${product.headquartersProduct.displayName}`}
                        className="store-config-edit-button"
                        onClick={(event) =>
                          openDialog(
                            { kind: "product", product },
                            event.currentTarget,
                          )
                        }
                      >
                        <PencilSimple /> {product.archived ? "查看" : "配置"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {dialog?.kind === "hours" ? (
        <HoursDialog
          configuration={configuration}
          onClose={closeDialog}
          onSubmit={execute}
        />
      ) : null}
      {dialog?.kind === "area" ? (
        <AreaDialog
          {...(dialog.area ? { area: dialog.area } : {})}
          configuration={configuration}
          onClose={closeDialog}
          onSubmit={execute}
        />
      ) : null}
      {dialog?.kind === "price" ? (
        <PricePlanDialog
          {...(dialog.plan ? { baseline: dialog.plan } : {})}
          configuration={configuration}
          csrfToken={csrfToken}
          onClose={closeDialog}
          onSubmit={execute}
          previewEndpoint={previewEndpoint}
        />
      ) : null}
      {dialog?.kind === "headquarters-product" &&
      catalogs &&
      onProductScopeSubmit ? (
        <HeadquartersProductScopeDialog
          catalogs={catalogs}
          onClose={closeDialog}
          onSubmit={onProductScopeSubmit}
          product={dialog.product}
        />
      ) : null}
      {dialog?.kind === "product" ? (
        <StoreProductDialog
          configuration={configuration}
          onClose={closeDialog}
          onSubmit={execute}
          product={dialog.product}
        />
      ) : null}
      {dialog?.kind === "seat" ? (
        <SeatDialog
          configuration={configuration}
          onClose={closeDialog}
          onDependencies={(seat) => setDialog({ kind: "dependencies", seat })}
          onSubmit={execute}
          {...(dialog.seat ? { seat: dialog.seat } : {})}
        />
      ) : null}
      {dialog?.kind === "dependencies" ? (
        <DependencyDialog
          onClose={closeDialog}
          onNavigateRepairs={() => {
            closeDialog();
            onNavigateRepairs();
          }}
          onNavigateReservations={() => {
            closeDialog();
            onNavigateReservations();
          }}
          readOnly={mode === "headquarters"}
          seat={dialog.seat}
        />
      ) : null}
    </main>
  );
}

export function ManagerStoreConfiguration({
  csrfToken,
  onNavigateRepairs,
  onNavigateReservations,
  onToast,
  refreshKey,
}: {
  csrfToken: string;
  onNavigateRepairs: () => void;
  onNavigateReservations: () => void;
  onToast: (message: string) => void;
  refreshKey: string;
}) {
  return (
    <StoreConfiguration
      csrfToken={csrfToken}
      mode="manager"
      onNavigateRepairs={onNavigateRepairs}
      onNavigateReservations={onNavigateReservations}
      onToast={onToast}
      refreshKey={refreshKey}
    />
  );
}

export function HeadquartersStoreConfiguration({
  csrfToken,
  onToast,
  refreshKey,
}: {
  csrfToken: string;
  onToast: (message: string) => void;
  refreshKey: string;
}) {
  const [catalogs, setCatalogs] = useState<HeadquartersCatalogsResponse | null>(
    null,
  );
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [error, setError] = useState("");
  const pendingKeysRef = useRef(new Map<string, string>());

  const loadCatalogs = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/v1/hq/catalogs", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setError(failureMessage(payload, "固定三店资料读取失败。"));
        return false;
      }
      const next = payload as HeadquartersCatalogsResponse;
      const stores = canonicalHeadquartersStores(
        next.stores,
        (store) => store.code,
      );
      setCatalogs({ ...next, stores });
      setSelectedStoreId((current) =>
        stores.some((store) => store.storeId === current)
          ? current
          : (stores[0]?.storeId ?? ""),
      );
      return true;
    } catch {
      setError("固定三店资料读取失败，页面不会使用客户端预置范围。");
      return false;
    }
  }, []);

  useEffect(() => {
    void loadCatalogs();
  }, [loadCatalogs, refreshKey]);

  const executeProductScope = useCallback(
    async (command: HeadquartersCatalogCommandRequest, success: string) => {
      const requestPayload = JSON.stringify(command);
      const idempotencyKey =
        pendingKeysRef.current.get(requestPayload) ?? createBrowserUuid();
      pendingKeysRef.current.set(requestPayload, idempotencyKey);
      try {
        const response = await fetch("/api/v1/hq/catalogs/commands", {
          body: requestPayload,
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
            "X-CSRF-Token": csrfToken,
          },
          method: "POST",
        });
        const payload: unknown = await response.json();
        const outcomeUnknown =
          response.status === 408 || response.status >= 500;
        if (!outcomeUnknown) pendingKeysRef.current.delete(requestPayload);
        if (!response.ok) {
          return outcomeUnknown
            ? "商品范围提交结果暂时未知，请使用原提交标识安全重试。"
            : failureMessage(payload, "商品范围没有改变，请修正后重试。");
        }
        if (!(await loadCatalogs())) {
          return "服务端已保存商品范围，但最新范围回读失败；请刷新后核对。";
        }
        onToast(success);
        return null;
      } catch {
        return "商品范围提交结果暂时未知，请使用原提交标识安全重试。";
      }
    },
    [csrfToken, loadCatalogs, onToast],
  );

  if (!catalogs || !selectedStoreId) {
    return (
      <main className="store-config-main">
        <section
          className={`store-config-state${error ? " is-error" : ""}`}
          {...(error ? { role: "alert" } : {})}
        >
          {error ? (
            <>
              <Warning />
              <span>{error}</span>
              <button onClick={() => void loadCatalogs()}>重新读取</button>
            </>
          ) : (
            "正在读取固定三店范围…"
          )}
        </section>
      </main>
    );
  }

  return (
    <StoreConfiguration
      catalogs={catalogs}
      csrfToken={csrfToken}
      mode="headquarters"
      onNavigateRepairs={() => undefined}
      onNavigateReservations={() => undefined}
      onProductScopeSubmit={executeProductScope}
      onSelectStore={setSelectedStoreId}
      onToast={onToast}
      refreshKey={refreshKey}
      selectedStoreId={selectedStoreId}
      storeOptions={catalogs.stores}
    />
  );
}
