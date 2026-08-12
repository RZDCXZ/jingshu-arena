"use client";

import {
  Armchair,
  ArrowClockwise,
  CalendarBlank,
  Camera,
  CaretDown,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Circle,
  Clock,
  CurrencyCny,
  Crown,
  GameController,
  House,
  Hourglass,
  Info,
  ImageSquare,
  Lightning,
  Lock,
  MagnifyingGlass,
  MapPin,
  Minus,
  Monitor,
  Package,
  Plus,
  Receipt,
  ShieldCheck,
  Star,
  Storefront,
  Ticket,
  Timer,
  Trash,
  TrendUp,
  User,
  Warning,
  Wrench,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ApiErrorResponse,
  CreateCustomerPendingOrderRequest,
  CreateCustomerPendingReservationRequest,
  CustomerExperienceCouponStatus,
  CustomerJourneyReservation,
  CustomerJourneyResponse,
  CustomerMachineProfileCode,
  CustomerMembershipResponse,
  CustomerOrderCancellationResponse,
  CustomerOrderCatalogResponse,
  CustomerOrderDetailResponse,
  CustomerOrderPaymentResponse,
  CustomerOrderStatus,
  CustomerPendingOrderResponse,
  CustomerSeatAvailability,
  CustomerSeatAvailabilityResponse,
  CustomerPendingReservationResponse,
  CustomerReservationCancellationResponse,
  CustomerReservationDetailResponse,
  CustomerReservationPaymentResponse,
  CustomerReservationStatus,
  CustomerStoreCatalogResponse,
  RepairCreatedResponse,
  RepairDetailResponse,
  RepairImageCompletionResponse,
  RepairImageSaved,
  RepairImageIntentResponse,
  RepairImageListResponse,
  RepairSampleImageResponse,
} from "@jingshu/contracts";

import repairSample from "../../../product-ui/miniprogram/design-prototype/public/assets/repair-headset-sample.png";

const profileIcons = {
  competitive: GameController,
  flagship: Lightning,
  standard: Monitor,
} as const;

const availabilityLabels: Record<CustomerSeatAvailability, string> = {
  available: "可订",
  "in-use": "使用中",
  maintenance: "维护中",
  reserved: "已预留",
};

const priceRuleLabels = {
  "weekday-base": "工作日 06:00–18:00 · 基础价",
  "weekday-evening": "工作日 18:00–24:00 · 1.20 倍",
  "weekday-overnight": "工作日 00:00–06:00 · 0.90 倍",
  weekend: "周末营业时段 · 1.15 倍",
} as const;

const shanghaiPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Shanghai",
  year: "numeric",
});

const shanghaiDisplayFormatter = new Intl.DateTimeFormat("zh-CN", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Shanghai",
  weekday: "short",
});

function shanghaiInputValue(value: string, roundUp = false) {
  const date = new Date(value);
  if (roundUp) {
    date.setTime(Math.ceil(date.getTime() / 1_800_000) * 1_800_000);
  }
  const parts = Object.fromEntries(
    shanghaiPartsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function shanghaiInputToIso(value: string) {
  return new Date(`${value}:00+08:00`).toISOString();
}

function formatMoney(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

function formatWindow(value: string) {
  return shanghaiDisplayFormatter.format(new Date(value));
}

function formatFullWindow(startsAt: string, endsAt: string) {
  const date = new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    weekday: "short",
    year: "numeric",
  }).format(new Date(startsAt));
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  });
  return `${date} ${time.format(new Date(startsAt))}–${time.format(new Date(endsAt))}`;
}

function formatSeatTitle(areaName: string, seatCode: string) {
  const areaSuffix = seatCode.split("-")[0];
  return areaName.endsWith(` ${areaSuffix}`)
    ? `${areaName.slice(0, -2)} ${seatCode}`
    : `${areaName} ${seatCode}`;
}

const couponReasonLabels = {
  "business-kind": "仅限预约业务使用",
  "minimum-spend": "当前金额未达到最低使用门槛",
  store: "不适用于当前门店",
  "time-window": "不适用于当前预约时段",
  unavailable: "体验券已被占用或失效",
  validity: "预约时段超出体验券有效期",
} as const;

type CustomerView =
  | "conditions"
  | "confirm"
  | "detail"
  | "held"
  | "journey"
  | "membership"
  | "order-catalog"
  | "order-confirm"
  | "order-detail"
  | "order-payment"
  | "payment"
  | "repair-create"
  | "repair-detail"
  | "seats";

type CustomerEntryPage =
  | "customer-home"
  | "customer-orders"
  | "customer-repairs"
  | "customer-reservations";

interface CustomerRepairFile {
  readonly file: File;
  readonly id: string;
  readonly previewUrl: string;
}

type JourneyGroup = "current" | "future" | "history";

type PaymentStage = "confirm" | "failure" | "processing" | "success";

const reservationStatusLabels: Record<
  CustomerReservationStatus,
  { label: string; tone: "active" | "pending" | "terminal" }
> = {
  arrived: { label: "已到店", tone: "active" },
  cancelled: { label: "已取消", tone: "terminal" },
  completed: { label: "已完成", tone: "terminal" },
  confirmed: { label: "已确认", tone: "active" },
  expired: { label: "已过期", tone: "terminal" },
  "in-use": { label: "使用中", tone: "active" },
  "pending-confirmation": { label: "待确认", tone: "pending" },
};

const timelineLabels: Record<string, string> = {
  "reservation.cancelled": "预约已取消",
  "reservation.no-show-expired": "逾时未到店，预约已过期",
  "reservation.pending-created": "已创建十分钟预约保留",
  "reservation.pending-expired": "预约保留已到期",
  "reservation.simulated-payment-succeeded": "模拟支付成功（未扣款）",
};

const terminalReasonLabels: Record<string, string> = {
  "confirmed-no-show": "开始后十五分钟未到店，预约自动过期",
  "pending-confirmation-timeout": "十分钟保留到期，预约自动过期",
  "planned-end-auto-completed": "计划结束后自动完成",
};

const lifecycleProgressSteps = [
  { label: "已确认", status: "confirmed" },
  { label: "已到店", status: "arrived" },
  { label: "使用中", status: "in-use" },
] as const;

const orderStatusLabels = {
  cancelled: "已取消",
  completed: "已完成",
  expired: "已过期",
  "pending-simulated-payment": "待模拟支付",
  preparing: "制作中",
  "ready-for-pickup": "待取",
  "simulated-paid": "模拟支付成功",
} as const;

const orderTimelineLabels: Record<string, string> = {
  "order.cancelled": "商品订单已取消，库存与体验券已释放",
  "order.expired": "十分钟库存保留已到期",
  "order.pending-created": "整单库存已排他保留",
  "order.preparing": "店员已开始制作",
  "order.ready-for-pickup": "商品已备齐，等待领取",
  "order.completed": "全部商品已领取",
  "order.simulated-payment-succeeded": "模拟支付成功（未扣款）",
};

function orderProgressIndex(
  status: CustomerOrderStatus,
  timeline: CustomerOrderDetailResponse["timeline"],
) {
  const directProgress: Partial<Record<CustomerOrderStatus, number>> = {
    completed: 4,
    "pending-simulated-payment": 0,
    preparing: 2,
    "ready-for-pickup": 3,
    "simulated-paid": 1,
  };
  const timelineProgress: Record<string, number> = {
    "order.completed": 4,
    "order.pending-created": 0,
    "order.preparing": 2,
    "order.ready-for-pickup": 3,
    "order.simulated-payment-succeeded": 1,
  };
  return (
    directProgress[status] ??
    Math.max(0, ...timeline.map((event) => timelineProgress[event.type] ?? 0))
  );
}

const journeyGroupLabels: Record<JourneyGroup, string> = {
  current: "当前",
  future: "未来",
  history: "历史",
};

const couponStatusLabels: Record<CustomerExperienceCouponStatus, string> = {
  available: "可用",
  expired: "已过期",
  redeemed: "已使用",
  reserved: "占用中",
};

const couponStatusOrder: readonly CustomerExperienceCouponStatus[] = [
  "available",
  "reserved",
  "redeemed",
  "expired",
];

function lifecycleProgressIndex(
  status: CustomerReservationStatus,
  timeline: CustomerReservationDetailResponse["timeline"],
) {
  if (status === "completed") {
    return lifecycleProgressSteps.length;
  }
  const activeIndex = lifecycleProgressSteps.findIndex(
    (step) => step.status === status,
  );
  if (activeIndex >= 0) {
    return activeIndex;
  }
  return timeline.some(
    (event) => event.type === "reservation.simulated-payment-succeeded",
  )
    ? 1
    : -1;
}

function JourneyReservationCard({
  item,
  onOpen,
}: {
  item: CustomerJourneyReservation;
  onOpen: (reservationId: string) => void;
}) {
  const status = reservationStatusLabels[item.status];
  return (
    <article className="customer-journey-card">
      <div className="customer-journey-card-head">
        <span className={`is-${status.tone}`}>{status.label}</span>
        <small>{formatMoney(item.payableCents)} · 模拟金额</small>
      </div>
      <button
        className="customer-journey-main"
        onClick={() => onOpen(item.reservationId)}
        type="button"
      >
        <span>
          <CalendarBlank />
          <strong>
            {formatFullWindow(item.window.startsAt, item.window.endsAt)}
          </strong>
        </span>
        <h2>{item.store.displayName}</h2>
        <p>
          {formatSeatTitle(item.area.displayName, item.seat.code)} ·{" "}
          {item.machineProfile.displayName}
        </p>
        <CaretRight />
      </button>
      {item.coupon || item.refund || item.growthAward ? (
        <div className="customer-journey-links">
          {item.coupon ? (
            <span>
              <Ticket />
              {item.coupon.displayName} −
              {formatMoney(item.coupon.discountCents)}
            </span>
          ) : null}
          {item.refund ? (
            <button onClick={() => onOpen(item.reservationId)} type="button">
              <CurrencyCny />
              模拟退款 {formatMoney(item.refund.amountCents)}
              <CaretRight />
            </button>
          ) : null}
          {item.growthAward ? (
            <button onClick={() => onOpen(item.reservationId)} type="button">
              <TrendUp />
              完成发放 +{item.growthAward.growthPoints} 成长值
              <CaretRight />
            </button>
          ) : null}
        </div>
      ) : null}
      {item.related.orders.length > 0 || item.related.repairs.length > 0 ? (
        <div className="customer-journey-related">
          {item.related.orders.map((order) => (
            <button
              key={order.id}
              onClick={() => onOpen(item.reservationId)}
              type="button"
            >
              <Package />
              <span>
                <strong>{order.label}</strong>
                <small>{order.status}</small>
              </span>
              <CaretRight />
            </button>
          ))}
          {item.related.repairs.map((repair) => (
            <button
              key={repair.id}
              onClick={() => onOpen(item.reservationId)}
              type="button"
            >
              <Wrench />
              <span>
                <strong>{repair.label}</strong>
                <small>{repair.status}</small>
              </span>
              <CaretRight />
            </button>
          ))}
        </div>
      ) : null}
      {item.terminalReason ? (
        <p className="customer-journey-reason">
          结果说明：
          {terminalReasonLabels[item.terminalReason] ?? item.terminalReason}
        </p>
      ) : null}
    </article>
  );
}

const LIFECYCLE_REQUEST_TIMEOUT_MS = 8_000;

export function CustomerSeatBrowser({
  csrfToken,
  entryPage = "customer-home",
  refreshKey,
}: {
  csrfToken: string;
  entryPage?: CustomerEntryPage;
  refreshKey: string;
}) {
  const customerRootRef = useRef<HTMLElement>(null);
  const lastRefreshKeyRef = useRef(refreshKey);
  const lastEntryPageRef = useRef<CustomerEntryPage | null>(null);
  const pendingEntryIntentRef = useRef<"order" | "repair" | null>(null);
  const [catalog, setCatalog] = useState<CustomerStoreCatalogResponse | null>(
    null,
  );
  const [catalogFailure, setCatalogFailure] = useState("");
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [view, setView] = useState<CustomerView>("conditions");
  const [storeCode, setStoreCode] = useState("prism-flagship");
  const [areaCode, setAreaCode] = useState("competitive-a");
  const [machineCode, setMachineCode] =
    useState<CustomerMachineProfileCode>("competitive");
  const [mode, setMode] = useState<"future" | "immediate">("immediate");
  const [durationHours, setDurationHours] = useState(2);
  const [futureStart, setFutureStart] = useState("");
  const [availability, setAvailability] =
    useState<CustomerSeatAvailabilityResponse | null>(null);
  const [availabilityFailure, setAvailabilityFailure] = useState("");
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [selectedSeat, setSelectedSeat] = useState("");
  const [selectionNotice, setSelectionNotice] = useState("");
  const [selectedCouponId, setSelectedCouponId] = useState<string | null>(null);
  const [priceExpanded, setPriceExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submissionFailure, setSubmissionFailure] = useState("");
  const [conflictInvalidated, setConflictInvalidated] = useState(false);
  const reservationKeyRef = useRef<string | null>(null);
  const [createdReservation, setCreatedReservation] =
    useState<CustomerPendingReservationResponse | null>(null);
  const [activeReservationId, setActiveReservationId] = useState<string | null>(
    null,
  );
  const [detailReturnView, setDetailReturnView] = useState<"held" | "journey">(
    "held",
  );
  const [reservationDetail, setReservationDetail] =
    useState<CustomerReservationDetailResponse | null>(null);
  const [detailObservedAt, setDetailObservedAt] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailFailure, setDetailFailure] = useState("");
  const [detailPriceExpanded, setDetailPriceExpanded] = useState(false);
  const [paymentStage, setPaymentStage] = useState<PaymentStage>("confirm");
  const [paymentFailure, setPaymentFailure] = useState("");
  const [paymentResult, setPaymentResult] =
    useState<CustomerReservationPaymentResponse | null>(null);
  const paymentKeyRef = useRef<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [cancelFailure, setCancelFailure] = useState("");
  const cancelKeyRef = useRef<string | null>(null);
  const [, setCountdownTick] = useState(0);
  const [membership, setMembership] =
    useState<CustomerMembershipResponse | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [membershipFailure, setMembershipFailure] = useState("");
  const [membershipAttempt, setMembershipAttempt] = useState(0);
  const [couponStatus, setCouponStatus] =
    useState<CustomerExperienceCouponStatus>("available");
  const [journey, setJourney] = useState<CustomerJourneyResponse | null>(null);
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [journeyFailure, setJourneyFailure] = useState("");
  const [journeyAttempt, setJourneyAttempt] = useState(0);
  const [journeyGroup, setJourneyGroup] = useState<JourneyGroup>("current");
  const [historyFilter, setHistoryFilter] = useState<"all" | "refunds">("all");
  const [orderCatalog, setOrderCatalog] =
    useState<CustomerOrderCatalogResponse | null>(null);
  const [orderCatalogLoading, setOrderCatalogLoading] = useState(false);
  const [orderCatalogFailure, setOrderCatalogFailure] = useState("");
  const [orderCategory, setOrderCategory] = useState<
    "all" | CustomerOrderCatalogResponse["products"][number]["category"]
  >("all");
  const [orderCart, setOrderCart] = useState<Record<string, number>>({});
  const [selectedOrderCouponId, setSelectedOrderCouponId] = useState<
    string | null
  >(null);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderSubmissionFailure, setOrderSubmissionFailure] = useState("");
  const orderCreateKeyRef = useRef<string | null>(null);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [orderDetail, setOrderDetail] =
    useState<CustomerOrderDetailResponse | null>(null);
  const [orderDetailLoading, setOrderDetailLoading] = useState(false);
  const [orderDetailFailure, setOrderDetailFailure] = useState("");
  const [orderObservedAt, setOrderObservedAt] = useState(0);
  const [orderPaymentResult, setOrderPaymentResult] =
    useState<CustomerOrderPaymentResponse | null>(null);
  const [orderPaymentLoading, setOrderPaymentLoading] = useState(false);
  const [orderPaymentFailure, setOrderPaymentFailure] = useState("");
  const orderPaymentKeyRef = useRef<string | null>(null);
  const [orderCancelLoading, setOrderCancelLoading] = useState(false);
  const [orderCancelFailure, setOrderCancelFailure] = useState("");
  const orderCancelKeyRef = useRef<string | null>(null);
  const [repairDescription, setRepairDescription] = useState("");
  const [repairFiles, setRepairFiles] = useState<
    ReadonlyArray<CustomerRepairFile>
  >([]);
  const [repairSampleSelected, setRepairSampleSelected] = useState(false);
  const [repairPermissionNotice, setRepairPermissionNotice] = useState("");
  const [repairSubmitting, setRepairSubmitting] = useState(false);
  const [repairImageRetrying, setRepairImageRetrying] = useState(false);
  const [repairFailure, setRepairFailure] = useState("");
  const [repairUploadNotice, setRepairUploadNotice] = useState("");
  const [createdRepair, setCreatedRepair] =
    useState<RepairCreatedResponse | null>(null);
  const [repairDetail, setRepairDetail] = useState<RepairDetailResponse | null>(
    null,
  );
  const [repairDetailFailure, setRepairDetailFailure] = useState("");
  const [savedRepairImages, setSavedRepairImages] = useState<
    ReadonlyArray<RepairImageSaved>
  >([]);
  const repairKeyRef = useRef<string | null>(null);

  useEffect(() => {
    orderPaymentKeyRef.current = null;
    orderCancelKeyRef.current = null;
  }, [activeOrderId]);

  useEffect(() => {
    if (lastRefreshKeyRef.current === refreshKey) return;
    lastRefreshKeyRef.current = refreshKey;
    setCatalogAttempt((attempt) => attempt + 1);
    setAvailabilityAttempt((attempt) => attempt + 1);
    setMembershipAttempt((attempt) => attempt + 1);
    setJourneyAttempt((attempt) => attempt + 1);
    if (activeReservationId) void readReservationDetail(activeReservationId);
    if (activeOrderId) void readOrderDetail(activeOrderId);
    if (createdRepair && view === "repair-detail") {
      void readRepairPublicDetail(createdRepair.repairId).catch((error) =>
        setRepairDetailFailure(
          error instanceof Error ? error.message : "公开处理动态暂时无法读取。",
        ),
      );
    }
  }, [refreshKey]);

  useEffect(() => {
    if (lastEntryPageRef.current === entryPage) return;
    lastEntryPageRef.current = entryPage;

    if (entryPage === "customer-home") {
      pendingEntryIntentRef.current = null;
      setView("conditions");
      return;
    }

    pendingEntryIntentRef.current =
      entryPage === "customer-orders"
        ? "order"
        : entryPage === "customer-repairs"
          ? "repair"
          : null;
    setJourneyGroup("current");
    setHistoryFilter("all");
    setView("journey");
    setJourneyAttempt((attempt) => attempt + 1);
  }, [entryPage]);

  useEffect(() => {
    if (
      ![
        "conditions",
        "journey",
        "membership",
        "order-catalog",
        "order-confirm",
        "order-detail",
        "order-payment",
        "repair-create",
        "repair-detail",
        "seats",
      ].includes(view)
    ) {
      return;
    }
    customerRootRef.current?.parentElement?.scrollTo({
      behavior: "auto",
      top: 0,
    });
  }, [view]);

  useEffect(() => {
    if (!(
      (view === "detail" &&
        reservationDetail?.status === "pending-confirmation") ||
      (view === "order-detail" &&
        orderDetail?.status === "pending-simulated-payment")
    )) {
      return;
    }
    const timer = window.setInterval(
      () => setCountdownTick((value) => value + 1),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [orderDetail?.status, reservationDetail?.status, view]);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogFailure("");
    void fetch("/api/v1/customer/stores", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "X-Retry-Attempt": String(catalogAttempt) },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as
          ApiErrorResponse | CustomerStoreCatalogResponse;
        if (!response.ok) {
          throw new Error(
            "error" in payload
              ? payload.error.message
              : "三店资料暂时无法读取。",
          );
        }
        setCatalog(payload as CustomerStoreCatalogResponse);
        setFutureStart(
          shanghaiInputValue(
            (payload as CustomerStoreCatalogResponse).currentTime,
            true,
          ),
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setCatalogFailure(
          error instanceof Error ? error.message : "三店资料暂时无法读取。",
        );
      });
    return () => controller.abort();
  }, [catalogAttempt]);

  useEffect(() => {
    if (view !== "membership") return;
    const controller = new AbortController();
    setMembershipLoading(true);
    setMembershipFailure("");
    void fetch("/api/v1/customer/membership", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "X-Retry-Attempt": String(membershipAttempt) },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as
          ApiErrorResponse | CustomerMembershipResponse;
        if (!response.ok) {
          throw new Error(
            "error" in payload
              ? payload.error.message
              : "会员档案暂时无法读取。",
          );
        }
        setMembership(payload as CustomerMembershipResponse);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setMembershipFailure(
          error instanceof Error ? error.message : "会员档案暂时无法读取。",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setMembershipLoading(false);
      });
    return () => controller.abort();
  }, [membershipAttempt, view]);

  useEffect(() => {
    if (view !== "journey") return;
    const controller = new AbortController();
    setJourneyLoading(true);
    setJourneyFailure("");
    void fetch("/api/v1/customer/journey", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "X-Retry-Attempt": String(journeyAttempt) },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as
          ApiErrorResponse | CustomerJourneyResponse;
        if (!response.ok) {
          throw new Error(
            "error" in payload
              ? payload.error.message
              : "统一行程暂时无法读取。",
          );
        }
        setJourney(payload as CustomerJourneyResponse);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setJourneyFailure(
          error instanceof Error ? error.message : "统一行程暂时无法读取。",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setJourneyLoading(false);
      });
    return () => controller.abort();
  }, [journeyAttempt, view]);

  useEffect(() => {
    const intent = pendingEntryIntentRef.current;
    if (!intent || view !== "journey" || !journey) return;

    const target = journey.groups.current.find((item) =>
      intent === "order"
        ? item.status === "arrived" || item.status === "in-use"
        : item.status === "in-use",
    );
    pendingEntryIntentRef.current = null;
    if (!target) return;

    openJourneyReservation(target.reservationId);
  }, [journey, view]);

  const store = useMemo(
    () => catalog?.stores.find((item) => item.code === storeCode) ?? null,
    [catalog, storeCode],
  );
  const area = store?.areas.find((item) => item.code === areaCode) ?? null;
  const machine =
    store?.machineProfiles.find((item) => item.code === machineCode) ?? null;

  useEffect(() => {
    if (!catalog || !store || !area || !machine) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      area: area.code,
      durationHours: String(durationHours),
      machine: machine.code,
      mode,
      store: store.code,
    });
    if (mode === "future" && futureStart) {
      query.set("start", shanghaiInputToIso(futureStart));
    }
    if (mode === "future" && !futureStart) return;

    setAvailabilityLoading(true);
    setAvailabilityFailure("");
    void fetch(`/api/v1/customer/seat-availability?${query.toString()}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as
          ApiErrorResponse | CustomerSeatAvailabilityResponse;
        if (!response.ok) {
          throw new Error(
            "error" in payload
              ? payload.error.message
              : "座位可订性暂时无法读取。",
          );
        }
        const result = payload as CustomerSeatAvailabilityResponse;
        setAvailability(result);
        setSelectedSeat((current) => {
          if (
            current &&
            !result.seats.some(
              (seat) =>
                seat.code === current && seat.availability === "available",
            )
          ) {
            setSelectionNotice(
              `${current} 已不符合新的时段、区域或机型条件，选择已清除。`,
            );
            return "";
          }
          return current;
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setAvailability(null);
        setAvailabilityFailure(
          error instanceof Error ? error.message : "座位可订性暂时无法读取。",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setAvailabilityLoading(false);
      });
    return () => controller.abort();
  }, [
    area,
    availabilityAttempt,
    catalog,
    durationHours,
    futureStart,
    machine,
    mode,
    store,
  ]);

  function chooseStore(nextStoreCode: string) {
    const nextStore = catalog?.stores.find(
      (item) => item.code === nextStoreCode,
    );
    if (!nextStore) return;
    setStoreCode(nextStore.code);
    setAreaCode(nextStore.areas[0]?.code ?? "");
    const preferredMachine =
      nextStore.machineProfiles.find(
        (profile) => profile.code === "standard",
      ) ?? nextStore.machineProfiles[0];
    if (preferredMachine) setMachineCode(preferredMachine.code);
    setSelectedSeat("");
    setSelectedCouponId(null);
    reservationKeyRef.current = null;
    setSelectionNotice("");
  }

  function openConfirmation() {
    if (!availability || !selectedSeat) return;
    const firstEligibleCoupon = availability.coupons.find(
      (coupon) => coupon.eligibility.status === "eligible",
    );
    setSelectedCouponId(firstEligibleCoupon?.id ?? null);
    setPriceExpanded(false);
    setSubmissionFailure("");
    setConflictInvalidated(false);
    reservationKeyRef.current = null;
    setView("confirm");
  }

  function returnToSeats() {
    if (conflictInvalidated) setSelectedSeat("");
    setSelectedCouponId(null);
    setSubmissionFailure("");
    setConflictInvalidated(false);
    reservationKeyRef.current = null;
    setView("seats");
  }

  async function createReservation() {
    if (!availability || !selectedSeat || submitting || conflictInvalidated) {
      return;
    }
    const idempotencyKey = reservationKeyRef.current ?? crypto.randomUUID();
    reservationKeyRef.current = idempotencyKey;
    const request: CreateCustomerPendingReservationRequest = {
      areaCode: availability.area.code,
      couponId: selectedCouponId,
      durationHours,
      machineProfileCode: availability.machineProfile.code,
      mode: availability.window.mode,
      ...(availability.window.mode === "future"
        ? { requestedStartsAt: availability.window.startsAt }
        : {}),
      seatCode: selectedSeat,
      storeCode: availability.store.code,
    };
    setSubmitting(true);
    setSubmissionFailure("");
    try {
      const response = await fetch("/api/v1/customer/reservations", {
        body: JSON.stringify(request),
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "X-CSRF-Token": csrfToken,
        },
        method: "POST",
      });
      const payload = (await response.json()) as
        ApiErrorResponse | CustomerPendingReservationResponse;
      if (!response.ok) {
        const failure = payload as ApiErrorResponse;
        const code = failure.error.code;
        if (
          code.includes("SEAT_CONFLICT") ||
          code.includes("SEAT_MAINTENANCE") ||
          code.includes("SEAT_NOT_FOUND") ||
          code.includes("CUSTOMER_CONFLICT")
        ) {
          setConflictInvalidated(true);
          reservationKeyRef.current = null;
        } else if (code.includes("COUPON")) {
          setSelectedCouponId(null);
          reservationKeyRef.current = null;
        }
        throw new Error(failure.error.message);
      }
      const created = payload as CustomerPendingReservationResponse;
      setCreatedReservation(created);
      setActiveReservationId(created.reservationId);
      setDetailReturnView("held");
      setView("held");
      void readReservationDetail(created.reservationId);
    } catch (error) {
      setSubmissionFailure(
        error instanceof Error
          ? error.message
          : "预约保留未能创建；未发生扣款，可安全重试。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function readReservationDetail(reservationId: string) {
    setActiveReservationId(reservationId);
    setDetailLoading(true);
    setDetailFailure("");
    try {
      const response = await fetch(
        `/api/v1/customer/reservations/${reservationId}`,
        {
          cache: "no-store",
          credentials: "same-origin",
        },
      );
      const payload = (await response.json()) as
        ApiErrorResponse | CustomerReservationDetailResponse;
      if (!response.ok) {
        throw new Error(
          "error" in payload ? payload.error.message : "预约详情暂时无法读取。",
        );
      }
      setReservationDetail(payload as CustomerReservationDetailResponse);
      setDetailObservedAt(Date.now());
      return payload as CustomerReservationDetailResponse;
    } catch (error) {
      setDetailFailure(
        error instanceof Error ? error.message : "预约详情暂时无法读取。",
      );
      return null;
    } finally {
      setDetailLoading(false);
    }
  }

  function openPayment() {
    setPaymentStage("confirm");
    setPaymentFailure("");
    setPaymentResult(null);
    setView("payment");
  }

  async function simulatePayment() {
    if (!activeReservationId || paymentStage === "processing") return;
    const idempotencyKey = paymentKeyRef.current ?? crypto.randomUUID();
    paymentKeyRef.current = idempotencyKey;
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      LIFECYCLE_REQUEST_TIMEOUT_MS,
    );
    setPaymentStage("processing");
    setPaymentFailure("");
    try {
      const response = await fetch(
        `/api/v1/customer/reservations/${activeReservationId}/simulated-payment`,
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Idempotency-Key": idempotencyKey,
            "X-CSRF-Token": csrfToken,
          },
          method: "POST",
          signal: controller.signal,
        },
      );
      const payload = (await response.json()) as
        ApiErrorResponse | CustomerReservationPaymentResponse;
      if (!response.ok) {
        const failure = payload as ApiErrorResponse;
        if (failure.error.currentStatus) {
          await readReservationDetail(activeReservationId);
        }
        throw new Error(failure.error.message);
      }
      setPaymentResult(payload as CustomerReservationPaymentResponse);
      await readReservationDetail(activeReservationId);
      setMembershipAttempt((attempt) => attempt + 1);
      setJourneyAttempt((attempt) => attempt + 1);
      setPaymentStage("success");
    } catch (error) {
      setPaymentFailure(
        error instanceof DOMException && error.name === "AbortError"
          ? "请求等待超时。不会扣款，请使用原提交标识安全重试。"
          : error instanceof Error
            ? error.message
            : "模拟支付未完成。不会扣款，可安全重试。",
      );
      setPaymentStage("failure");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function cancelReservation() {
    if (
      !activeReservationId ||
      !reservationDetail ||
      cancelSubmitting ||
      cancelReason.trim().length === 0
    ) {
      return;
    }
    const idempotencyKey = cancelKeyRef.current ?? crypto.randomUUID();
    cancelKeyRef.current = idempotencyKey;
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      LIFECYCLE_REQUEST_TIMEOUT_MS,
    );
    setCancelSubmitting(true);
    setCancelFailure("");
    try {
      const response = await fetch(
        `/api/v1/customer/reservations/${activeReservationId}/cancel`,
        {
          body: JSON.stringify({ reason: cancelReason.trim() }),
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
            "X-CSRF-Token": csrfToken,
          },
          method: "POST",
          signal: controller.signal,
        },
      );
      const payload = (await response.json()) as
        ApiErrorResponse | CustomerReservationCancellationResponse;
      if (!response.ok) {
        const failure = payload as ApiErrorResponse;
        if (failure.error.currentStatus) {
          await readReservationDetail(activeReservationId);
        }
        throw new Error(failure.error.message);
      }
      await readReservationDetail(activeReservationId);
      setMembershipAttempt((attempt) => attempt + 1);
      setJourneyAttempt((attempt) => attempt + 1);
      setCancelOpen(false);
      setCancelReason("");
      cancelKeyRef.current = null;
    } catch (error) {
      setCancelFailure(
        error instanceof DOMException && error.name === "AbortError"
          ? "请求等待超时。预约、退款和体验券状态未知，请使用原提交标识安全重试。"
          : error instanceof Error
            ? error.message
            : "取消未完整完成，可使用原提交标识安全重试。",
      );
    } finally {
      window.clearTimeout(timeout);
      setCancelSubmitting(false);
    }
  }

  async function openOrderCatalog(reservationId: string) {
    setOrderCatalog(null);
    setOrderCatalogLoading(true);
    setOrderCatalogFailure("");
    setOrderSubmissionFailure("");
    setOrderCart({});
    setOrderCategory("all");
    setSelectedOrderCouponId(null);
    orderCreateKeyRef.current = null;
    setView("order-catalog");
    try {
      const response = await fetch(
        `/api/v1/customer/reservations/${reservationId}/products`,
        { cache: "no-store", credentials: "same-origin" },
      );
      const payload = (await response.json()) as
        ApiErrorResponse | CustomerOrderCatalogResponse;
      if (!response.ok) {
        throw new Error(
          "error" in payload ? payload.error.message : "柜台商品暂时无法读取。",
        );
      }
      const result = payload as CustomerOrderCatalogResponse;
      setOrderCatalog(result);
      setSelectedOrderCouponId(
        result.coupons.find(
          (coupon) => coupon.eligibility.status === "eligible",
        )?.id ?? null,
      );
    } catch (error) {
      setOrderCatalogFailure(
        error instanceof Error ? error.message : "柜台商品暂时无法读取。",
      );
    } finally {
      setOrderCatalogLoading(false);
    }
  }

  function changeOrderQuantity(productId: string, delta: number) {
    const product = orderCatalog?.products.find(
      (candidate) => candidate.id === productId,
    );
    if (!product) return;
    setOrderCart((current) => {
      const quantity = Math.max(
        0,
        Math.min(product.availableQuantity, (current[productId] ?? 0) + delta),
      );
      if (quantity === 0) {
        const next = { ...current };
        delete next[productId];
        return next;
      }
      return { ...current, [productId]: quantity };
    });
    setOrderSubmissionFailure("");
    orderCreateKeyRef.current = null;
  }

  async function readOrderDetail(orderId: string) {
    setActiveOrderId(orderId);
    setOrderDetailLoading(true);
    setOrderDetailFailure("");
    try {
      const response = await fetch(`/api/v1/customer/orders/${orderId}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = (await response.json()) as
        ApiErrorResponse | CustomerOrderDetailResponse;
      if (!response.ok) {
        throw new Error(
          "error" in payload ? payload.error.message : "商品订单暂时无法读取。",
        );
      }
      setOrderDetail(payload as CustomerOrderDetailResponse);
      setOrderObservedAt(Date.now());
      return payload as CustomerOrderDetailResponse;
    } catch (error) {
      setOrderDetailFailure(
        error instanceof Error ? error.message : "商品订单暂时无法读取。",
      );
      return null;
    } finally {
      setOrderDetailLoading(false);
    }
  }

  function openRelatedOrder(orderId: string) {
    setOrderDetail(null);
    setOrderPaymentResult(null);
    setOrderPaymentFailure("");
    setOrderCancelFailure("");
    setActiveOrderId(orderId);
    setView("order-detail");
    void readOrderDetail(orderId);
  }

  async function createOrder() {
    if (!orderCatalog || orderSubmitting) return;
    const lines = orderCatalog.products.flatMap((product) => {
      const quantity = orderCart[product.id] ?? 0;
      return quantity > 0 ? [{ productId: product.id, quantity }] : [];
    });
    if (lines.length === 0) return;
    const subtotalCents = lines.reduce((total, line) => {
      const product = orderCatalog.products.find(
        (candidate) => candidate.id === line.productId,
      );
      return total + (product?.unitPriceCents ?? 0) * line.quantity;
    }, 0);
    const coupon = orderCatalog.coupons.find(
      (candidate) => candidate.id === selectedOrderCouponId,
    );
    const couponId =
      coupon?.eligibility.status === "eligible" &&
      subtotalCents >= coupon.minimumSpendCents
        ? coupon.id
        : null;
    const request: CreateCustomerPendingOrderRequest = {
      couponId,
      lines,
      reservationId: orderCatalog.reservation.reservationId,
    };
    const idempotencyKey = orderCreateKeyRef.current ?? crypto.randomUUID();
    orderCreateKeyRef.current = idempotencyKey;
    setOrderSubmitting(true);
    setOrderSubmissionFailure("");
    try {
      const response = await fetch("/api/v1/customer/orders", {
        body: JSON.stringify(request),
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "X-CSRF-Token": csrfToken,
        },
        method: "POST",
      });
      const payload = (await response.json()) as
        ApiErrorResponse | CustomerPendingOrderResponse;
      if (!response.ok) {
        throw new Error(
          "error" in payload
            ? payload.error.message
            : "商品订单未创建，购物车内容已保留。",
        );
      }
      const created = payload as CustomerPendingOrderResponse;
      setActiveOrderId(created.orderId);
      setOrderDetail(null);
      setOrderPaymentResult(null);
      setOrderPaymentFailure("");
      setOrderCancelFailure("");
      setView("order-detail");
      await readOrderDetail(created.orderId);
      setJourneyAttempt((attempt) => attempt + 1);
      setMembershipAttempt((attempt) => attempt + 1);
    } catch (error) {
      setOrderSubmissionFailure(
        error instanceof Error
          ? error.message
          : "商品订单未创建，整单库存不会被部分占用。",
      );
    } finally {
      setOrderSubmitting(false);
    }
  }

  async function simulateOrderPayment() {
    if (!activeOrderId || orderPaymentLoading) return;
    const idempotencyKey = orderPaymentKeyRef.current ?? crypto.randomUUID();
    orderPaymentKeyRef.current = idempotencyKey;
    setOrderPaymentLoading(true);
    setOrderPaymentFailure("");
    try {
      const response = await fetch(
        `/api/v1/customer/orders/${activeOrderId}/simulated-payment`,
        {
          body: JSON.stringify({}),
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
            "X-CSRF-Token": csrfToken,
          },
          method: "POST",
        },
      );
      const payload = (await response.json()) as
        ApiErrorResponse | CustomerOrderPaymentResponse;
      if (!response.ok) {
        throw new Error(
          "error" in payload
            ? payload.error.message
            : "模拟支付未完成；不会产生真实扣款。",
        );
      }
      setOrderPaymentResult(payload as CustomerOrderPaymentResponse);
      await readOrderDetail(activeOrderId);
      setJourneyAttempt((attempt) => attempt + 1);
      setMembershipAttempt((attempt) => attempt + 1);
      setView("order-payment");
    } catch (error) {
      setOrderPaymentFailure(
        error instanceof Error
          ? error.message
          : "模拟支付未完成；不会产生真实扣款。",
      );
    } finally {
      setOrderPaymentLoading(false);
    }
  }

  async function cancelOrder() {
    if (!activeOrderId || orderCancelLoading) return;
    const idempotencyKey = orderCancelKeyRef.current ?? crypto.randomUUID();
    orderCancelKeyRef.current = idempotencyKey;
    setOrderCancelLoading(true);
    setOrderCancelFailure("");
    try {
      const response = await fetch(
        `/api/v1/customer/orders/${activeOrderId}/cancel`,
        {
          body: JSON.stringify({ reason: "顾客在模拟支付前取消商品订单" }),
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
            "X-CSRF-Token": csrfToken,
          },
          method: "POST",
        },
      );
      const payload = (await response.json()) as
        ApiErrorResponse | CustomerOrderCancellationResponse;
      if (!response.ok) {
        throw new Error(
          "error" in payload ? payload.error.message : "商品订单取消未完成。",
        );
      }
      await readOrderDetail(activeOrderId);
      setJourneyAttempt((attempt) => attempt + 1);
      setMembershipAttempt((attempt) => attempt + 1);
    } catch (error) {
      setOrderCancelFailure(
        error instanceof Error ? error.message : "商品订单取消未完成。",
      );
    } finally {
      setOrderCancelLoading(false);
    }
  }

  function openRepairCreate() {
    setRepairDescription("");
    repairFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setRepairFiles([]);
    setRepairSampleSelected(false);
    setRepairPermissionNotice("");
    setRepairFailure("");
    setRepairUploadNotice("");
    setCreatedRepair(null);
    setRepairDetail(null);
    setRepairDetailFailure("");
    setSavedRepairImages([]);
    repairKeyRef.current = null;
    setView("repair-create");
  }

  async function readRepairImages(repairId: string) {
    const response = await fetch(`/api/v1/repairs/${repairId}/images`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const payload = (await response.json()) as
      ApiErrorResponse | RepairImageListResponse;
    if (!response.ok) {
      throw new Error(
        "error" in payload ? payload.error.message : "报修图片暂时无法读取。",
      );
    }
    const images = (payload as RepairImageListResponse).images;
    setSavedRepairImages(images);
    return images;
  }

  async function readRepairPublicDetail(repairId: string) {
    setRepairDetailFailure("");
    const response = await fetch(`/api/v1/repairs/${repairId}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const payload = (await response.json()) as
      ApiErrorResponse | RepairDetailResponse;
    if (!response.ok) {
      throw new Error(
        "error" in payload
          ? payload.error.message
          : "公开处理动态暂时无法读取。",
      );
    }
    const nextDetail = payload as RepairDetailResponse;
    setRepairDetail(nextDetail);
    return nextDetail;
  }

  function openExistingRepair(
    repair: CustomerReservationDetailResponse["related"]["repairs"][number],
  ) {
    if (!reservationDetail) return;
    setCreatedRepair({
      createdAt: reservationDetail.currentTime,
      description: repair.label.split(" · ").slice(1).join(" · "),
      duplicate: true,
      machineProfile: {
        code: reservationDetail.snapshot.machineProfile.code,
        displayName: reservationDetail.snapshot.machineProfile.displayName,
      },
      priority: "normal",
      repairId: repair.id,
      reservationId: reservationDetail.reservationId,
      seat: {
        code: reservationDetail.snapshot.seat.code,
        operationalStatus: "normal",
      },
      source: "customer",
      status: repair.status,
      store: reservationDetail.snapshot.store,
    });
    repairFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setRepairFiles([]);
    setRepairSampleSelected(false);
    setSavedRepairImages([]);
    setRepairDetail(null);
    setRepairDetailFailure("");
    setRepairUploadNotice("正在重新签发私有图片读取地址…");
    setView("repair-detail");
    void Promise.all([
      readRepairImages(repair.id),
      readRepairPublicDetail(repair.id),
    ])
      .then(([images]) => {
        setRepairUploadNotice(
          images.length > 0
            ? `已打开现有报修，并重新授权读取 ${images.length} 张私有图片。`
            : "已打开该座位现有的未关闭报修，没有创建重复记录。",
        );
      })
      .catch((error) => {
        setRepairDetailFailure(
          error instanceof Error ? error.message : "报修图片暂时无法读取。",
        );
      });
  }

  function chooseRepairFiles(files: FileList | null) {
    if (!files) return;
    const remaining =
      3 -
      savedRepairImages.length -
      repairFiles.length -
      (repairSampleSelected ? 1 : 0);
    const candidates = Array.from(files).slice(0, Math.max(0, remaining));
    const accepted = candidates.filter(
      (file) =>
        ["image/jpeg", "image/png", "image/webp"].includes(file.type) &&
        file.size > 0 &&
        file.size <= 5 * 1024 * 1024,
    );
    if (accepted.length !== candidates.length || files.length > remaining) {
      setRepairPermissionNotice(
        "仅接受最多 3 张 JPEG、PNG 或 WebP，且每张不超过 5 MB。无效文件未加入。",
      );
    } else {
      setRepairPermissionNotice("");
    }
    setRepairFiles((current) => [
      ...current,
      ...accepted.map((file) => ({
        file,
        id: crypto.randomUUID(),
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  }

  function removeRepairFile(id: string) {
    setRepairFiles((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  async function uploadRepairFile(repairId: string, file: File) {
    const intentResponse = await fetch(
      `/api/v1/repairs/${repairId}/images/intents`,
      {
        body: JSON.stringify({
          declaredContentType: file.type,
          filename: file.name,
          size: file.size,
        }),
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        method: "POST",
      },
    );
    const intentPayload = (await intentResponse.json()) as
      ApiErrorResponse | RepairImageIntentResponse;
    if (!intentResponse.ok) {
      throw new Error(
        "error" in intentPayload
          ? intentPayload.error.message
          : "图片上传意图创建失败。",
      );
    }
    const intent = intentPayload as RepairImageIntentResponse;
    const uploadResponse = await fetch(intent.uploadUrl, {
      body: file,
      cache: "no-store",
      headers: { "Content-Type": file.type },
      method: "PUT",
    });
    if (!uploadResponse.ok) {
      const failure = (await uploadResponse.json()) as ApiErrorResponse;
      throw new Error(failure.error.message);
    }
    const completionResponse = await fetch(intent.completeUrl, {
      body: "{}",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      method: "POST",
    });
    const completion = (await completionResponse.json()) as
      ApiErrorResponse | RepairImageCompletionResponse;
    if (!completionResponse.ok) {
      throw new Error(
        "error" in completion ? completion.error.message : "图片净化未完成。",
      );
    }
    return (completion as RepairImageCompletionResponse).image;
  }

  async function saveRepairSample(repairId: string) {
    const response = await fetch(`/api/v1/repairs/${repairId}/images/sample`, {
      body: JSON.stringify({ sampleAssetId: "repair-headset-v1" }),
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      method: "POST",
    });
    const payload = (await response.json()) as
      ApiErrorResponse | RepairSampleImageResponse;
    if (!response.ok) {
      throw new Error(
        "error" in payload ? payload.error.message : "样例图未保存。",
      );
    }
    return (payload as RepairSampleImageResponse).image;
  }

  async function retryRepairEvidence(useSampleFallback = false) {
    if (!createdRepair || repairImageRetrying) return;
    setRepairImageRetrying(true);
    const saved: RepairImageSaved[] = [];
    const failedFiles: CustomerRepairFile[] = [];
    const failures: string[] = [];
    if (!useSampleFallback) {
      for (const item of repairFiles) {
        try {
          saved.push(await uploadRepairFile(createdRepair.repairId, item.file));
          URL.revokeObjectURL(item.previewUrl);
        } catch (error) {
          failedFiles.push(item);
          failures.push(
            error instanceof Error ? error.message : "图片净化未完成。",
          );
        }
      }
    }
    const shouldSaveSample = useSampleFallback || repairSampleSelected;
    let sampleFailed = false;
    if (shouldSaveSample) {
      try {
        saved.push(await saveRepairSample(createdRepair.repairId));
        if (useSampleFallback) {
          repairFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        }
      } catch (error) {
        sampleFailed = true;
        if (useSampleFallback) failedFiles.push(...repairFiles);
        failures.push(
          error instanceof Error ? error.message : "样例图未保存。",
        );
      }
    }
    setRepairFiles(failedFiles);
    setRepairSampleSelected(sampleFailed);
    setSavedRepairImages((current) => [
      ...current,
      ...saved.filter(
        (image) => !current.some((item) => item.imageId === image.imageId),
      ),
    ]);
    setRepairUploadNotice(
      failures.length > 0
        ? `${failures[0]} 文字报修和既有净化图片不受影响。`
        : saved.length > 0
          ? `新增 ${saved.length} 张安全图片已保存。`
          : "没有待保存的图片。",
    );
    setRepairImageRetrying(false);
  }

  async function createRepair() {
    if (
      !activeReservationId ||
      repairSubmitting ||
      repairDescription.trim().length < 1
    ) {
      return;
    }
    const idempotencyKey = repairKeyRef.current ?? crypto.randomUUID();
    repairKeyRef.current = idempotencyKey;
    setRepairSubmitting(true);
    setRepairFailure("");
    setRepairUploadNotice("");
    try {
      const response = await fetch("/api/v1/customer/repairs", {
        body: JSON.stringify({
          description: repairDescription,
          reservationId: activeReservationId,
        }),
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "X-CSRF-Token": csrfToken,
        },
        method: "POST",
      });
      const payload = (await response.json()) as
        ApiErrorResponse | RepairCreatedResponse;
      if (!response.ok) {
        throw new Error(
          "error" in payload ? payload.error.message : "文字报修暂时无法保存。",
        );
      }
      const repair = payload as RepairCreatedResponse;
      setCreatedRepair(repair);
      const saved: RepairImageSaved[] = [];
      const failures: string[] = [];
      const failedFiles: CustomerRepairFile[] = [];
      for (const item of repairFiles) {
        try {
          saved.push(await uploadRepairFile(repair.repairId, item.file));
          URL.revokeObjectURL(item.previewUrl);
        } catch (error) {
          failedFiles.push(item);
          failures.push(
            error instanceof Error ? error.message : "图片净化未完成。",
          );
        }
      }
      let sampleFailed = false;
      if (repairSampleSelected) {
        try {
          saved.push(await saveRepairSample(repair.repairId));
        } catch (error) {
          sampleFailed = true;
          failures.push(
            error instanceof Error ? error.message : "样例图未保存。",
          );
        }
      }
      setRepairFiles(failedFiles);
      setRepairSampleSelected(sampleFailed);
      const existingImages = repair.duplicate
        ? await readRepairImages(repair.repairId).catch(() => saved)
        : [];
      setSavedRepairImages(repair.duplicate ? existingImages : saved);
      setRepairUploadNotice(
        repair.duplicate
          ? `该座位已有未关闭报修，已打开记录并读取 ${existingImages.length} 张安全图片。`
          : failures.length > 0
            ? `文字报修已保存；${failures[0]} 未净化的原文件不会显示或保留。`
            : saved.length > 0
              ? `文字报修与 ${saved.length} 张净化图片已保存。`
              : "文字报修已保存；图片为可选项。",
      );
      setView("repair-detail");
      await readRepairPublicDetail(repair.repairId).catch((error) =>
        setRepairDetailFailure(
          error instanceof Error ? error.message : "公开处理动态暂时无法读取。",
        ),
      );
      await readReservationDetail(activeReservationId);
      setJourneyAttempt((attempt) => attempt + 1);
    } catch (error) {
      setRepairFailure(
        error instanceof Error
          ? error.message
          : "文字报修暂时无法保存；已保留输入。",
      );
    } finally {
      setRepairSubmitting(false);
    }
  }

  function restartReservation() {
    setView("conditions");
    setCreatedReservation(null);
    setReservationDetail(null);
    setActiveReservationId(null);
    setSelectedSeat("");
    setSelectedCouponId(null);
    setDetailFailure("");
    setPaymentFailure("");
    paymentKeyRef.current = null;
    cancelKeyRef.current = null;
  }

  function openJourneyReservation(reservationId: string) {
    setReservationDetail(null);
    setDetailFailure("");
    setDetailPriceExpanded(false);
    setActiveReservationId(reservationId);
    setDetailReturnView("journey");
    setView("detail");
    void readReservationDetail(reservationId);
  }

  if (!catalog) {
    return (
      <main className="customer-h5 customer-loading" data-testid="customer-h5">
        <div className="customer-loading-mark">
          {catalogFailure ? <Warning weight="duotone" /> : <ArrowClockwise />}
        </div>
        <span>演示数据 · Web 沙箱</span>
        <h1>{catalogFailure ? "三店资料暂时不可用" : "正在准备顾客 H5"}</h1>
        <p>{catalogFailure || "正在从服务端读取三店、座位和价格计划。"}</p>
        {catalogFailure ? (
          <button
            className="customer-primary-button"
            onClick={() => setCatalogAttempt((attempt) => attempt + 1)}
            type="button"
          >
            <ArrowClockwise />
            重新读取
          </button>
        ) : null}
      </main>
    );
  }

  const minimumFutureStart = shanghaiInputValue(catalog.currentTime, true);
  const maximumFutureStart = shanghaiInputValue(
    new Date(
      Date.parse(catalog.currentTime) + 7 * 24 * 60 * 60 * 1_000,
    ).toISOString(),
  );
  const selectedCoupon =
    availability?.coupons.find((coupon) => coupon.id === selectedCouponId) ??
    null;
  const selectedDiscountCents =
    selectedCoupon?.eligibility.status === "eligible"
      ? selectedCoupon.eligibility.discountCents
      : 0;
  const selectedPayableCents =
    selectedCoupon?.eligibility.status === "eligible"
      ? selectedCoupon.eligibility.payableCents
      : (availability?.price.totalCents ?? 0);
  const holdRemainingSeconds = reservationDetail?.holdExpiresAt
    ? Math.max(
        0,
        Math.ceil(
          (Date.parse(reservationDetail.holdExpiresAt) -
            Date.parse(reservationDetail.currentTime) -
            Math.max(0, Date.now() - detailObservedAt)) /
            1_000,
        ),
      )
    : null;
  const holdCountdown =
    holdRemainingSeconds === null
      ? "—"
      : `${String(Math.floor(holdRemainingSeconds / 60)).padStart(2, "0")}:${String(holdRemainingSeconds % 60).padStart(2, "0")}`;
  const activeSnapshot =
    reservationDetail?.reservationId === activeReservationId
      ? reservationDetail.snapshot
      : createdReservation?.reservationId === activeReservationId
        ? createdReservation.snapshot
        : null;
  const orderCartLines =
    orderCatalog?.products.flatMap((product) => {
      const quantity = orderCart[product.id] ?? 0;
      return quantity > 0 ? [{ product, quantity }] : [];
    }) ?? [];
  const visibleOrderProducts =
    orderCatalog?.products.filter(
      (product) =>
        orderCategory === "all" || product.category === orderCategory,
    ) ?? [];
  const orderCartCount = orderCartLines.reduce(
    (total, line) => total + line.quantity,
    0,
  );
  const orderSubtotalCents = orderCartLines.reduce(
    (total, line) => total + line.product.unitPriceCents * line.quantity,
    0,
  );
  const selectedOrderCoupon =
    orderCatalog?.coupons.find(
      (coupon) => coupon.id === selectedOrderCouponId,
    ) ?? null;
  const orderCouponApplies =
    selectedOrderCoupon?.eligibility.status === "eligible" &&
    orderSubtotalCents >= selectedOrderCoupon.minimumSpendCents;
  const orderDiscountCents = orderCouponApplies
    ? Math.min(selectedOrderCoupon.discountCents, orderSubtotalCents)
    : 0;
  const orderPayableCents = orderSubtotalCents - orderDiscountCents;
  const orderRemainingSeconds =
    orderDetail?.status === "pending-simulated-payment"
      ? Math.max(
          0,
          Math.ceil(
            (Date.parse(orderDetail.holdExpiresAt) -
              Date.parse(orderDetail.currentTime) -
              Math.max(0, Date.now() - orderObservedAt)) /
              1_000,
          ),
        )
      : null;
  const orderCountdown =
    orderRemainingSeconds === null
      ? "—"
      : `${String(Math.floor(orderRemainingSeconds / 60)).padStart(2, "0")}:${String(orderRemainingSeconds % 60).padStart(2, "0")}`;
  const journeyItems =
    journeyGroup === "history" && historyFilter === "refunds"
      ? (journey?.groups.history.filter((item) => item.refund !== null) ?? [])
      : (journey?.groups[journeyGroup] ?? []);
  const visibleCoupons =
    membership?.coupons.filter((coupon) => coupon.status === couponStatus) ??
    [];
  const memberProgress = membership
    ? membership.profile.tier.code === "gold"
      ? 100
      : (membership.profile.growthPoints /
          (membership.profile.nextTier?.threshold ?? 1)) *
        100
    : 0;

  return (
    <main
      className="customer-h5"
      data-testid="customer-h5"
      ref={customerRootRef}
    >
      <header className="customer-mobile-header">
        <div>
          <span>
            {view === "payment"
              ? "WEB-C02 / MP-08"
              : view.startsWith("repair-")
                ? "WEB-C02 / MP-13 · MP-15"
                : view.startsWith("order-")
                  ? "WEB-C04 / MP-10 · MP-12"
                  : view === "journey" || view === "membership"
                    ? "WEB-C03 / MP-16 · MP-17"
                    : "WEB-C00 / C02"}
          </span>
          <strong>
            {view === "seats"
              ? "选择座位"
              : view === "confirm"
                ? "确认预约"
                : view === "held"
                  ? "预约已保留"
                  : view === "payment"
                    ? "模拟支付"
                    : view === "detail"
                      ? "预约详情"
                      : view === "repair-create"
                        ? "创建报修"
                        : view === "repair-detail"
                          ? "报修详情"
                          : view === "order-catalog"
                            ? "柜台商品"
                            : view === "order-confirm"
                              ? "确认订单"
                              : view === "order-detail"
                                ? "商品订单"
                                : view === "order-payment"
                                  ? "模拟支付结果"
                                  : view === "journey"
                                    ? "统一行程"
                                    : view === "membership"
                                      ? "会员与体验券"
                                      : "预约座位"}
          </strong>
        </div>
        <span className="customer-demo-badge">演示数据</span>
      </header>

      {view === "repair-create" && reservationDetail ? (
        <div className="customer-scroll-content customer-repair-page has-repair-action">
          <button
            className="customer-back-button"
            onClick={() => setView("detail")}
            type="button"
          >
            <CaretLeft />
            返回预约详情
          </button>
          <section className="customer-repair-context-card">
            <Wrench weight="duotone" />
            <span>
              <small>当前座位 · 机型自动带出</small>
              <strong>
                {reservationDetail.snapshot.seat.code} ·{" "}
                {reservationDetail.snapshot.machineProfile.displayName}
              </strong>
              <em>{reservationDetail.snapshot.store.displayName}</em>
            </span>
          </section>
          <section className="customer-repair-heading">
            <span className="customer-eyebrow">REPAIR INTAKE</span>
            <h1>描述设备故障</h1>
            <p>提交只会创建新报修，不会立即把座位改为维护中。</p>
          </section>
          <label className="customer-repair-description">
            <span>
              <strong>故障描述</strong>
              <small>{repairDescription.length} / 500</small>
            </span>
            <textarea
              autoFocus
              maxLength={500}
              onChange={(event) => {
                setRepairDescription(event.target.value);
                repairKeyRef.current = null;
                setRepairFailure("");
              }}
              placeholder="例如：耳机右声道无声"
              rows={5}
              value={repairDescription}
            />
            <em>
              <Lock /> 请勿填写真实姓名、手机号、住址或其他个人信息
            </em>
          </label>
          <section className="customer-repair-images">
            <div className="customer-section-title">
              <div>
                <span>OPTIONAL EVIDENCE</span>
                <h2>故障图片（可选）</h2>
              </div>
              <ImageSquare />
            </div>
            <p>最多 3 张，每张不超过 5 MB；保存前会重新编码并移除元数据。</p>
            {repairFiles.length > 0 || repairSampleSelected ? (
              <div className="customer-repair-previews">
                {repairFiles.map((item) => (
                  <figure key={item.id}>
                    <img alt="待净化故障图片预览" src={item.previewUrl} />
                    <button
                      aria-label="删除这张待上传图片"
                      onClick={() => removeRepairFile(item.id)}
                      type="button"
                    >
                      <Trash />
                    </button>
                    <figcaption>待安全净化</figcaption>
                  </figure>
                ))}
                {repairSampleSelected ? (
                  <figure>
                    <img alt="耳机故障内置样例图" src={repairSample.src} />
                    <button
                      aria-label="删除内置样例图"
                      onClick={() => setRepairSampleSelected(false)}
                      type="button"
                    >
                      <Trash />
                    </button>
                    <figcaption>内置虚构样例</figcaption>
                  </figure>
                ) : null}
              </div>
            ) : null}
            <div className="customer-repair-image-actions">
              <label
                className={
                  repairFiles.length + (repairSampleSelected ? 1 : 0) >= 3
                    ? "is-disabled"
                    : ""
                }
              >
                <Camera />
                选择单张图片
                <input
                  accept="image/jpeg,image/png,image/webp"
                  disabled={
                    repairFiles.length + (repairSampleSelected ? 1 : 0) >= 3
                  }
                  multiple
                  onChange={(event) => {
                    chooseRepairFiles(event.target.files);
                    event.target.value = "";
                  }}
                  type="file"
                />
              </label>
              <button
                disabled={
                  repairSampleSelected ||
                  repairFiles.length + (repairSampleSelected ? 1 : 0) >= 3
                }
                onClick={() => {
                  setRepairSampleSelected(true);
                  setRepairPermissionNotice(
                    "已使用内置虚构样例；相册或相机权限不是提交报修的前提。",
                  );
                }}
                type="button"
              >
                <ImageSquare />
                使用内置样例图
              </button>
            </div>
            <button
              className="customer-repair-permission-link"
              onClick={() =>
                setRepairPermissionNotice(
                  "图片权限被拒绝也没关系：可继续提交文字，或选择内置虚构样例图。",
                )
              }
              type="button"
            >
              相册或相机权限被拒绝？
            </button>
            {repairPermissionNotice ? (
              <div className="customer-repair-image-notice" role="status">
                <Info /> {repairPermissionNotice}
              </div>
            ) : null}
          </section>
          {repairFailure ? (
            <section className="customer-feedback is-error" role="alert">
              <Warning />
              <span>
                <strong>文字报修尚未保存</strong>
                {repairFailure}
              </span>
            </section>
          ) : null}
          <div className="customer-repair-submit-bar">
            <span>图片失败不会阻塞文字报修</span>
            <button
              className="customer-primary-button"
              disabled={repairSubmitting || repairDescription.trim().length < 1}
              onClick={() => void createRepair()}
              type="button"
            >
              <Wrench />
              {repairSubmitting ? "正在保存报修…" : "提交报修"}
            </button>
          </div>
        </div>
      ) : view === "repair-detail" && createdRepair ? (
        <div className="customer-scroll-content customer-repair-page customer-repair-result">
          <button
            className="customer-back-button"
            onClick={() => setView("detail")}
            type="button"
          >
            <CaretLeft />
            返回预约详情
          </button>
          <section className="customer-repair-result-hero">
            <div>
              <CheckCircle weight="fill" />
            </div>
            <span className="customer-eyebrow">REPAIR PUBLIC STATUS</span>
            <h1>
              {repairDetail?.status === "processing"
                ? "设备正在检修"
                : repairDetail?.status === "verification"
                  ? "维修结果等待验证"
                  : repairDetail?.status === "closed"
                    ? "故障已验证并关闭"
                    : createdRepair.duplicate
                      ? "已打开现有报修"
                      : "报修已创建"}
            </h1>
            <p>{repairUploadNotice}</p>
          </section>
          <section className="customer-repair-ticket-card">
            <div>
              <span className="is-active">
                {repairDetail?.status === "assigned"
                  ? "已分派"
                  : repairDetail?.status === "processing"
                    ? "处理中"
                    : repairDetail?.status === "verification"
                      ? "待验证"
                      : repairDetail?.status === "closed"
                        ? "已关闭"
                        : "新建"}
              </span>
              <small>报修单 {createdRepair.repairId.slice(0, 8)}</small>
            </div>
            <h2>{repairDetail?.description ?? createdRepair.description}</h2>
            <dl>
              <div>
                <dt>座位</dt>
                <dd>{createdRepair.seat.code}</dd>
              </div>
              <div>
                <dt>机型</dt>
                <dd>{createdRepair.machineProfile.displayName}</dd>
              </div>
              <div>
                <dt>座位状态</dt>
                <dd>
                  {(repairDetail?.seat.operationalStatus ??
                    createdRepair.seat.operationalStatus) === "maintenance"
                    ? "维护中 · 不会自动换座"
                    : repairDetail?.status === "closed"
                      ? "正常 · 已完成验证并恢复"
                      : "正常 · 尚未进入维护"}
                </dd>
              </div>
            </dl>
          </section>
          {repairDetail?.seat.operationalStatus === "maintenance" ? (
            <section className="customer-repair-impact-notice">
              <Warning />
              <span>
                <strong>本座位已进入维护</strong>
                系统不会自动换座；你的预约影响与模拟退款如下，均不涉及真实资金。
              </span>
            </section>
          ) : null}
          {repairDetail?.resolution ? (
            <section className="customer-repair-public-result">
              <div>
                <CheckCircle />
                <span>
                  <strong>门店已提交解决说明</strong>
                  <small>
                    {new Date(
                      repairDetail.resolution.submittedAt,
                    ).toLocaleString("zh-CN")}
                  </small>
                </span>
              </div>
              <p>{repairDetail.resolution.note}</p>
            </section>
          ) : null}
          {repairDetail?.latestVerification ? (
            <section
              className={`customer-repair-public-result is-${repairDetail.latestVerification.outcome}`}
            >
              <div>
                {repairDetail.latestVerification.outcome === "success" ? (
                  <CheckCircle />
                ) : (
                  <Warning />
                )}
                <span>
                  <strong>
                    {repairDetail.latestVerification.outcome === "success"
                      ? "独立验证通过，座位已恢复"
                      : "验证未通过，门店继续处理"}
                  </strong>
                  <small>
                    {new Date(
                      repairDetail.latestVerification.verifiedAt,
                    ).toLocaleString("zh-CN")}
                  </small>
                </span>
              </div>
              <p>{repairDetail.latestVerification.reason}</p>
            </section>
          ) : null}
          {repairDetail?.impacts.length ? (
            <section className="customer-repair-public-impact">
              <div className="customer-section-title">
                <div>
                  <span>YOUR RESERVATION IMPACT</span>
                  <h2>我的预约与模拟退款</h2>
                </div>
                <CurrencyCny />
              </div>
              {repairDetail.impacts.map((impact) => (
                <article key={impact.reservationId}>
                  <span>
                    <strong>
                      {impact.outcome === "completed"
                        ? "预约已提前完成"
                        : "预约已取消"}
                    </strong>
                    <small>
                      原状态{" "}
                      {reservationStatusLabels[impact.beforeStatus].label} ·
                      {formatFullWindow(
                        impact.window.startsAt,
                        impact.window.endsAt,
                      )}
                    </small>
                  </span>
                  <em>{formatMoney(impact.simulatedRefundCents)}</em>
                  <small>
                    模拟退款 · 不对应真实资金
                    {impact.couponRestored ? " · 体验券已恢复" : ""}
                  </small>
                </article>
              ))}
            </section>
          ) : null}
          {savedRepairImages.length > 0 ? (
            <section className="customer-repair-saved-images">
              <div className="customer-section-title">
                <div>
                  <span>SANITIZED IMAGES</span>
                  <h2>已安全保存的图片</h2>
                </div>
                <ShieldCheck />
              </div>
              <div>
                {savedRepairImages.map((image) => (
                  <figure key={image.imageId}>
                    <img
                      alt={
                        image.source === "sample"
                          ? "内置耳机故障样例图"
                          : "已净化故障图片"
                      }
                      src={
                        image.source === "sample"
                          ? repairSample.src
                          : image.readUrl
                      }
                    />
                    <figcaption>
                      <ShieldCheck />
                      {image.source === "sample" ? "内置样例" : "已移除元数据"}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          ) : null}
          {savedRepairImages.length < 3 ? (
            <section className="customer-repair-evidence-recovery">
              <div>
                <ShieldCheck />
                <span>
                  <strong>补充或恢复故障图片</strong>
                  <small>
                    可重试失败单图，或改用内置样例；文字报修不会重复创建。
                  </small>
                </span>
              </div>
              {repairFiles.length > 0 || repairSampleSelected ? (
                <p>
                  待保存 {repairFiles.length + (repairSampleSelected ? 1 : 0)}
                  张；失败原文件只保留在当前页面内存中。
                </p>
              ) : null}
              <div>
                <label>
                  <Camera /> 选择单张图片
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    disabled={repairImageRetrying}
                    onChange={(event) => {
                      chooseRepairFiles(event.target.files);
                      event.target.value = "";
                    }}
                    type="file"
                  />
                </label>
                <button
                  disabled={repairImageRetrying}
                  onClick={() => void retryRepairEvidence(true)}
                  type="button"
                >
                  <ImageSquare /> 改用内置样例
                </button>
              </div>
              {repairFiles.length > 0 || repairSampleSelected ? (
                <button
                  className="customer-secondary-button"
                  disabled={repairImageRetrying}
                  onClick={() => void retryRepairEvidence()}
                  type="button"
                >
                  {repairImageRetrying ? "正在安全净化…" : "保存所选图片"}
                </button>
              ) : null}
            </section>
          ) : null}
          <section className="customer-lifecycle-card">
            <div className="customer-section-title">
              <div>
                <span>PUBLIC TIMELINE</span>
                <h2>公开处理动态</h2>
              </div>
              <Clock />
            </div>
            <ol className="customer-lifecycle-timeline">
              {repairDetail?.publicUpdates.length ? (
                repairDetail.publicUpdates.map((update) => (
                  <li key={`${update.type}-${update.occurredAt}`}>
                    <i />
                    <span>
                      <strong>{update.note}</strong>
                      <small>
                        {new Date(update.occurredAt).toLocaleString("zh-CN")}
                      </small>
                    </span>
                  </li>
                ))
              ) : (
                <li>
                  <i />
                  <span>
                    <strong>报修已创建，等待门店确认</strong>
                    <small>{formatWindow(createdRepair.createdAt)}</small>
                  </span>
                </li>
              )}
            </ol>
          </section>
          {repairDetailFailure ? (
            <section className="customer-feedback is-error" role="alert">
              <Warning />
              <span>
                <strong>公开动态刷新未完成</strong>
                {repairDetailFailure}
              </span>
            </section>
          ) : null}
          <button
            className="customer-secondary-button"
            onClick={() =>
              void readRepairPublicDetail(createdRepair.repairId).catch(
                (error) =>
                  setRepairDetailFailure(
                    error instanceof Error
                      ? error.message
                      : "公开处理动态暂时无法读取。",
                  ),
              )
            }
            type="button"
          >
            <ArrowClockwise /> 刷新公开动态
          </button>
          <button
            className="customer-primary-button"
            onClick={() => setView("detail")}
            type="button"
          >
            查看关联预约 <CaretRight />
          </button>
        </div>
      ) : view === "order-catalog" ? (
        <div className="customer-scroll-content customer-order-page has-order-action">
          <button
            className="customer-back-button"
            onClick={() => setView("detail")}
            type="button"
          >
            <CaretLeft />
            返回预约详情
          </button>
          {orderCatalogLoading ? (
            <section className="customer-lifecycle-loading" aria-live="polite">
              <ArrowClockwise />
              <strong>正在读取柜台商品</strong>
              <span>只展示当前门店可售商品与服务端库存。</span>
            </section>
          ) : orderCatalog ? (
            <>
              <section className="customer-order-link-card">
                <Storefront weight="duotone" />
                <span>
                  <strong>关联座位 {orderCatalog.reservation.seat.code}</strong>
                  {orderCatalog.reservation.store.displayName} ·
                  到店后专属柜台目录
                </span>
              </section>
              <section className="customer-order-heading">
                <span className="customer-eyebrow">STORE CATALOG</span>
                <h1>柜台商品</h1>
                <p>库存与门店价均由服务端确认，整单提交才会排他保留。</p>
              </section>
              <div
                aria-label="商品分类"
                className="customer-order-categories"
                role="tablist"
              >
                {[
                  ["all", "全部"],
                  ["drink", "饮品"],
                  ["snack", "零食"],
                  ["meal", "餐食"],
                  ["supply", "便利用品"],
                ].map(([value, label]) => (
                  <button
                    aria-selected={orderCategory === value}
                    className={orderCategory === value ? "is-active" : ""}
                    key={value}
                    onClick={() =>
                      setOrderCategory(value as typeof orderCategory)
                    }
                    role="tab"
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="customer-order-products">
                {visibleOrderProducts.map((product) => {
                  const quantity = orderCart[product.id] ?? 0;
                  return (
                    <article
                      className="customer-order-product"
                      key={product.id}
                    >
                      <div className="customer-order-product-icon">
                        <Package weight="duotone" />
                      </div>
                      <span>
                        <strong>{product.name}</strong>
                        <small>{product.description}</small>
                        <em className={product.lowStock ? "is-low" : ""}>
                          {product.lowStock
                            ? `仅余 ${product.availableQuantity}`
                            : `可售 ${product.availableQuantity}`}
                        </em>
                      </span>
                      <div className="customer-order-product-controls">
                        <strong>{formatMoney(product.unitPriceCents)}</strong>
                        <div>
                          <button
                            aria-label={`减少${product.name}`}
                            disabled={quantity === 0}
                            onClick={() => changeOrderQuantity(product.id, -1)}
                            type="button"
                          >
                            <Minus />
                          </button>
                          <span>{quantity}</span>
                          <button
                            aria-label={`增加${product.name}`}
                            disabled={quantity >= product.availableQuantity}
                            onClick={() => changeOrderQuantity(product.id, 1)}
                            type="button"
                          >
                            <Plus />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <section className="customer-lifecycle-loading is-error">
              <Warning />
              <strong>柜台商品暂时不可用</strong>
              <span>{orderCatalogFailure}</span>
              {activeReservationId ? (
                <button
                  className="customer-primary-button"
                  onClick={() => void openOrderCatalog(activeReservationId)}
                  type="button"
                >
                  重新读取
                </button>
              ) : null}
            </section>
          )}
          <div className="customer-order-action-bar">
            <span>
              <small>{orderCartCount} 件商品</small>
              <strong>{formatMoney(orderSubtotalCents)}</strong>
            </span>
            <button
              disabled={orderCartCount === 0}
              onClick={() => {
                setOrderSubmissionFailure("");
                setView("order-confirm");
              }}
              type="button"
            >
              确认购物车
            </button>
          </div>
        </div>
      ) : view === "order-confirm" && orderCatalog ? (
        <div className="customer-scroll-content customer-order-page has-order-action">
          <button
            className="customer-back-button"
            onClick={() => setView("order-catalog")}
            type="button"
          >
            <CaretLeft />
            返回商品目录
          </button>
          <section className="customer-order-heading">
            <span className="customer-eyebrow">CONFIRM ORDER</span>
            <h1>确认商品订单</h1>
            <p>
              {orderCatalog.reservation.store.displayName} · 座位
              {orderCatalog.reservation.seat.code}
            </p>
          </section>
          <section className="customer-order-confirm-card">
            <div className="customer-section-title">
              <div>
                <span>WHOLE CART</span>
                <h2>商品明细</h2>
              </div>
              <Receipt />
            </div>
            <div className="customer-order-confirm-lines">
              {orderCartLines.map(({ product, quantity }) => (
                <span key={product.id}>
                  <strong>
                    {product.name} × {quantity}
                  </strong>
                  <small>
                    {formatMoney(product.unitPriceCents)} × {quantity}
                  </small>
                  <em>{formatMoney(product.unitPriceCents * quantity)}</em>
                </span>
              ))}
            </div>
          </section>
          {orderCatalog.coupons.map((coupon) => {
            const selected = selectedOrderCouponId === coupon.id;
            const applies =
              selected &&
              coupon.eligibility.status === "eligible" &&
              orderSubtotalCents >= coupon.minimumSpendCents;
            return (
              <button
                aria-pressed={selected}
                className={`customer-order-coupon ${
                  applies ? "is-applied" : ""
                }`}
                key={coupon.id}
                onClick={() => {
                  setSelectedOrderCouponId((current) =>
                    current === coupon.id ? null : coupon.id,
                  );
                  setOrderSubmissionFailure("");
                  orderCreateKeyRef.current = null;
                }}
                type="button"
              >
                <Ticket weight="duotone" />
                <span>
                  <strong>{coupon.displayName}</strong>
                  <small>
                    满 {formatMoney(coupon.minimumSpendCents)} 减{" "}
                    {formatMoney(coupon.discountCents)}
                  </small>
                </span>
                <em>
                  {!selected ? "未使用" : applies ? "已使用" : "未达门槛"}
                </em>
              </button>
            );
          })}
          <section className="customer-order-price-card">
            <span>
              商品小计<strong>{formatMoney(orderSubtotalCents)}</strong>
            </span>
            <span>
              体验券
              <strong>−{formatMoney(orderDiscountCents)}</strong>
            </span>
            <span>
              应付模拟金额<strong>{formatMoney(orderPayableCents)}</strong>
            </span>
            <small>模拟支付，不会扣款，也不需要真实支付凭证。</small>
          </section>
          {orderSubmissionFailure ? (
            <section className="customer-feedback is-error" role="alert">
              <Warning />
              <span>
                <strong>整单库存不足</strong>
                {orderSubmissionFailure}
              </span>
            </section>
          ) : null}
          <section className="customer-order-atomic-note">
            <ShieldCheck />
            <span>
              <strong>整单原子保留</strong>
              任一商品不足都会回滚全部库存；购物车内容仍会保留。
            </span>
          </section>
          <div className="customer-order-action-bar">
            <span>
              <small>本单模拟应付</small>
              <strong>{formatMoney(orderPayableCents)}</strong>
            </span>
            <button
              disabled={orderCartCount === 0 || orderSubmitting}
              onClick={() => void createOrder()}
              type="button"
            >
              {orderSubmitting ? "正在保留库存…" : "创建待模拟支付订单"}
            </button>
          </div>
        </div>
      ) : view === "order-detail" && activeOrderId ? (
        <div className="customer-scroll-content customer-order-page">
          <button
            className="customer-back-button"
            onClick={() => {
              if (orderCatalog?.reservation.reservationId) {
                setView("detail");
                void readReservationDetail(
                  orderCatalog.reservation.reservationId,
                );
              } else {
                setView("journey");
              }
            }}
            type="button"
          >
            <CaretLeft />
            返回预约详情
          </button>
          {orderDetailLoading && !orderDetail ? (
            <section className="customer-lifecycle-loading" aria-live="polite">
              <ArrowClockwise />
              <strong>正在读取商品订单</strong>
              <span>以服务端库存保留和支付结果为准。</span>
            </section>
          ) : orderDetail ? (
            <>
              <section className="customer-order-status-card">
                <span className="customer-eyebrow">ORDER STATUS</span>
                <div>
                  <Package weight="duotone" />
                  <span>
                    <strong>{orderStatusLabels[orderDetail.status]}</strong>
                    <small>
                      {orderDetail.status === "pending-simulated-payment"
                        ? `库存保留倒计时 ${orderCountdown}`
                        : "状态已由服务端确认"}
                    </small>
                  </span>
                </div>
              </section>
              <ol className="customer-order-progress" aria-label="商品订单进度">
                {["待支付", "已支付", "制作中", "待取", "完成"].map(
                  (label, index) => (
                    <li
                      className={
                        index <=
                        orderProgressIndex(
                          orderDetail.status,
                          orderDetail.timeline,
                        )
                          ? "is-active"
                          : ""
                      }
                      key={label}
                    >
                      <i>{index + 1}</i>
                      <span>{label}</span>
                    </li>
                  ),
                )}
              </ol>
              <section className="customer-order-confirm-card">
                <div className="customer-section-title">
                  <div>
                    <span>IMMUTABLE SNAPSHOT</span>
                    <h2>订单快照</h2>
                  </div>
                  <Receipt />
                </div>
                <div className="customer-order-confirm-lines">
                  {orderDetail.snapshot.lines.map((line) => (
                    <span key={line.productId}>
                      <strong>
                        {line.productName} × {line.quantity}
                      </strong>
                      <small>单价快照 {formatMoney(line.unitPriceCents)}</small>
                      <em>{formatMoney(line.lineTotalCents)}</em>
                    </span>
                  ))}
                </div>
                <div className="customer-order-snapshot-total">
                  <span>优惠</span>
                  <strong>
                    −{formatMoney(orderDetail.snapshot.discountCents)}
                  </strong>
                  <span>模拟应付</span>
                  <strong>
                    {formatMoney(orderDetail.snapshot.payableCents)}
                  </strong>
                </div>
              </section>
              {orderDetail.refund ? (
                <section className="customer-feedback">
                  <CurrencyCny />
                  <span>
                    <strong>模拟退款已记录</strong>
                    {formatMoney(orderDetail.refund.amountCents)} ·
                    {formatWindow(orderDetail.refund.occurredAt)} ·
                    {orderDetail.refund.reason}
                  </span>
                </section>
              ) : null}
              <section className="customer-order-confirm-card">
                <div className="customer-section-title">
                  <div>
                    <span>IMMUTABLE TIMELINE</span>
                    <h2>业务事件</h2>
                  </div>
                  <Clock />
                </div>
                <ol className="customer-lifecycle-timeline">
                  {orderDetail.timeline.map((event, index) => (
                    <li key={`${event.occurredAt}-${event.type}-${index}`}>
                      <i />
                      <span>
                        <strong>
                          {orderTimelineLabels[event.type] ?? event.type}
                        </strong>
                        <small>{formatWindow(event.occurredAt)}</small>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
              {orderPaymentFailure ||
              orderCancelFailure ||
              orderDetailFailure ? (
                <section className="customer-feedback is-error" role="alert">
                  <Warning />
                  <span>
                    <strong>当前操作未完成</strong>
                    {orderPaymentFailure ||
                      orderCancelFailure ||
                      orderDetailFailure}
                  </span>
                </section>
              ) : null}
              <div className="customer-lifecycle-actions">
                {orderDetail.actions.canSimulatePayment ? (
                  <button
                    className="customer-primary-button"
                    disabled={orderPaymentLoading}
                    onClick={() => void simulateOrderPayment()}
                    type="button"
                  >
                    {orderPaymentLoading
                      ? "正在确认模拟支付…"
                      : "确认模拟支付（不扣款）"}
                  </button>
                ) : null}
                {orderDetail.actions.canCancel ? (
                  <button
                    className="customer-danger-button"
                    disabled={orderCancelLoading}
                    onClick={() => void cancelOrder()}
                    type="button"
                  >
                    {orderCancelLoading ? "正在取消…" : "取消商品订单"}
                  </button>
                ) : null}
                <button
                  className="customer-payment-secondary"
                  disabled={orderDetailLoading}
                  onClick={() => void readOrderDetail(activeOrderId)}
                  type="button"
                >
                  <ArrowClockwise />
                  {orderDetailLoading ? "正在刷新…" : "刷新当前状态"}
                </button>
              </div>
            </>
          ) : (
            <section className="customer-lifecycle-loading is-error">
              <Warning />
              <strong>商品订单暂时不可用</strong>
              <span>{orderDetailFailure}</span>
              <button
                className="customer-primary-button"
                onClick={() => void readOrderDetail(activeOrderId)}
                type="button"
              >
                重新读取
              </button>
            </section>
          )}
        </div>
      ) : view === "order-payment" && orderPaymentResult ? (
        <div className="customer-scroll-content customer-order-success">
          <div className="customer-order-success-icon">
            <CheckCircle weight="fill" />
          </div>
          <span className="customer-eyebrow">SIMULATED PAID</span>
          <h1>模拟支付成功</h1>
          <p>订单已由服务端确认；全程没有扣款，也不需要真实支付凭证。</p>
          <section className="customer-order-success-amount">
            <span>模拟支付金额</span>
            <strong>
              {formatMoney(orderPaymentResult.payment.amountCents)}
            </strong>
            <small>{formatWindow(orderPaymentResult.payment.occurredAt)}</small>
          </section>
          <section className="customer-order-atomic-note">
            <ShieldCheck />
            <span>
              <strong>库存归属订单，后续独立履约</strong>
              即使关联预约随后结束，已支付商品订单仍保留其独立结果。
            </span>
          </section>
          <button
            className="customer-primary-button"
            onClick={() => {
              setView("order-detail");
              void readOrderDetail(orderPaymentResult.orderId);
            }}
            type="button"
          >
            查看商品订单
          </button>
          <button
            className="customer-payment-secondary"
            onClick={() => setView("journey")}
            type="button"
          >
            返回统一行程
          </button>
        </div>
      ) : view === "journey" ? (
        <div className="customer-scroll-content customer-story-page">
          <section className="customer-demo-strip">
            <ShieldCheck weight="duotone" />
            <span>
              <strong>Web 独立沙箱 · 演示行程</strong>
              只展示当前顾客在三店中的合成预约与关联记录；不对应真实身份资料或资金。
            </span>
          </section>
          <section className="customer-story-hero">
            <span className="customer-eyebrow">ONE CUSTOMER JOURNEY</span>
            <h1>一条行程，看清完整结果</h1>
            <p>
              预约、模拟退款与成长发放按同一顾客聚合，点击任一记录可回到权威详情。
            </p>
          </section>
          <div
            aria-label="行程分组"
            className="customer-story-tabs"
            role="tablist"
          >
            {(Object.keys(journeyGroupLabels) as JourneyGroup[]).map(
              (group) => (
                <button
                  aria-selected={journeyGroup === group}
                  className={journeyGroup === group ? "is-active" : ""}
                  key={group}
                  onClick={() => setJourneyGroup(group)}
                  role="tab"
                  type="button"
                >
                  {journeyGroupLabels[group]}
                  <small>{journey?.groups[group].length ?? 0}</small>
                </button>
              ),
            )}
          </div>
          {journeyGroup === "history" ? (
            <div className="customer-history-filters" aria-label="历史筛选">
              <button
                aria-pressed={historyFilter === "all"}
                className={historyFilter === "all" ? "is-active" : ""}
                onClick={() => setHistoryFilter("all")}
                type="button"
              >
                全部历史
              </button>
              <button
                aria-pressed={historyFilter === "refunds"}
                className={historyFilter === "refunds" ? "is-active" : ""}
                onClick={() => setHistoryFilter("refunds")}
                type="button"
              >
                含模拟退款
              </button>
            </div>
          ) : null}
          {journeyLoading && !journey ? (
            <section className="customer-story-loading" aria-live="polite">
              <ArrowClockwise />
              <strong>正在聚合统一行程</strong>
              <span>以当前顾客和服务端业务时钟为准。</span>
            </section>
          ) : journeyFailure ? (
            <section className="customer-feedback is-error" role="alert">
              <Warning />
              <span>
                <strong>行程暂时不可用</strong>
                {journeyFailure}
              </span>
              <button
                onClick={() => setJourneyAttempt((attempt) => attempt + 1)}
                type="button"
              >
                重新读取
              </button>
            </section>
          ) : journeyItems.length > 0 ? (
            <div className="customer-journey-list">
              {journeyItems.map((item) => (
                <JourneyReservationCard
                  item={item}
                  key={item.reservationId}
                  onOpen={openJourneyReservation}
                />
              ))}
            </div>
          ) : (
            <section className="customer-story-empty">
              <CalendarBlank weight="duotone" />
              <h2>{journeyGroupLabels[journeyGroup]}行程为空</h2>
              <p>
                {journeyGroup === "history" && historyFilter === "refunds"
                  ? "当前筛选下没有含模拟退款的历史行程。"
                  : journeyGroup === "history"
                    ? "当前顾客还没有已结束的预约记录。"
                    : `当前顾客没有${journeyGroupLabels[journeyGroup]}预约。`}
              </p>
              <button
                onClick={() =>
                  journeyGroup === "history" && historyFilter === "refunds"
                    ? setHistoryFilter("all")
                    : setView("conditions")
                }
                type="button"
              >
                {journeyGroup === "history" && historyFilter === "refunds" ? (
                  <ArrowClockwise />
                ) : (
                  <MagnifyingGlass />
                )}
                {journeyGroup === "history" && historyFilter === "refunds"
                  ? "查看全部历史"
                  : "去预约一个座位"}
              </button>
            </section>
          )}
        </div>
      ) : view === "membership" ? (
        <div className="customer-scroll-content customer-story-page">
          <section className="customer-demo-strip">
            <ShieldCheck weight="duotone" />
            <span>
              <strong>Web 独立沙箱 · 三店共享</strong>
              会员档案、成长值与体验券均为合成演示数据；不提供储值、转让、折现或手工调整。
            </span>
          </section>
          {membershipLoading && !membership ? (
            <section className="customer-story-loading" aria-live="polite">
              <ArrowClockwise />
              <strong>正在读取会员档案</strong>
              <span>只读取当前顾客的一份经营方级档案。</span>
            </section>
          ) : membershipFailure ? (
            <section className="customer-feedback is-error" role="alert">
              <Warning />
              <span>
                <strong>会员档案暂时不可用</strong>
                {membershipFailure}
              </span>
              <button
                onClick={() => setMembershipAttempt((attempt) => attempt + 1)}
                type="button"
              >
                重新读取
              </button>
            </section>
          ) : membership ? (
            <>
              <section className="customer-member-hero">
                <div className="customer-member-hero-head">
                  <span>
                    <Crown weight="duotone" />
                    {membership.profile.tier.label}会员
                  </span>
                  <small>{membership.profile.operatorScope}</small>
                </div>
                <strong>{membership.profile.growthPoints}</strong>
                <p>累计成长值 · 终身不降级</p>
                <div className="customer-member-progress">
                  <span
                    style={{ width: `${Math.min(100, memberProgress)}%` }}
                  />
                </div>
                <div className="customer-member-thresholds">
                  <span>
                    {membership.profile.tier.code === "bronze" ? "0" : "500"}
                    <small>{membership.profile.tier.label}</small>
                  </span>
                  <span>
                    {membership.profile.nextTier?.threshold ?? "已达最高等级"}
                    <small>
                      {membership.profile.nextTier
                        ? `还差 ${membership.profile.nextTier.remainingGrowthPoints} 成长值`
                        : "黄金会员"}
                    </small>
                  </span>
                </div>
              </section>

              <section className="customer-member-section">
                <div className="customer-section-title">
                  <div>
                    <span>EXPERIENCE COUPONS</span>
                    <h2>体验券</h2>
                  </div>
                  <Ticket />
                </div>
                <div
                  aria-label="体验券状态"
                  className="customer-coupon-tabs"
                  role="tablist"
                >
                  {couponStatusOrder.map((status) => (
                    <button
                      aria-selected={couponStatus === status}
                      className={couponStatus === status ? "is-active" : ""}
                      key={status}
                      onClick={() => setCouponStatus(status)}
                      role="tab"
                      type="button"
                    >
                      {couponStatusLabels[status]}
                      <small>
                        {
                          membership.coupons.filter(
                            (coupon) => coupon.status === status,
                          ).length
                        }
                      </small>
                    </button>
                  ))}
                </div>
                {visibleCoupons.length > 0 ? (
                  <div className="customer-member-coupon-list">
                    {visibleCoupons.map((coupon) => (
                      <article
                        className={`is-${coupon.status}`}
                        key={coupon.id}
                      >
                        <div className="customer-member-coupon-value">
                          <Ticket weight="fill" />
                          <strong>{formatMoney(coupon.discountCents)}</strong>
                          <small>
                            {coupon.businessKind === "reservation"
                              ? "预约体验券"
                              : "商品体验券"}
                          </small>
                        </div>
                        <div className="customer-member-coupon-copy">
                          <div>
                            <h3>{coupon.displayName}</h3>
                            <span>{couponStatusLabels[coupon.status]}</span>
                          </div>
                          <p>
                            {coupon.store?.displayName ?? "三店通用"} · 满{" "}
                            {formatMoney(coupon.minimumSpendCents)} 可用
                          </p>
                          <small>
                            有效至 {formatWindow(coupon.validUntil)}
                          </small>
                          <p className="customer-member-release">
                            {coupon.releaseCondition}
                          </p>
                          {coupon.transaction ? (
                            coupon.transaction.kind === "reservation" ? (
                              <button
                                onClick={() =>
                                  openJourneyReservation(coupon.transaction!.id)
                                }
                                type="button"
                              >
                                <Receipt />
                                <span>
                                  <strong>{coupon.transaction.label}</strong>
                                  <small>{coupon.transaction.status}</small>
                                </span>
                                <CaretRight />
                              </button>
                            ) : (
                              <div className="customer-member-transaction">
                                <Package />
                                <span>{coupon.transaction.label}</span>
                              </div>
                            )
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <section className="customer-story-empty is-compact">
                    <Ticket weight="duotone" />
                    <h2>暂无{couponStatusLabels[couponStatus]}体验券</h2>
                    <p>切换上方状态，可查看体验券的占用、使用与失效记录。</p>
                    <button
                      onClick={() => setCouponStatus("available")}
                      type="button"
                    >
                      查看可用体验券
                    </button>
                  </section>
                )}
              </section>

              <section className="customer-member-section">
                <div className="customer-section-title">
                  <div>
                    <span>LIFETIME GROWTH</span>
                    <h2>成长记录</h2>
                  </div>
                  <TrendUp />
                </div>
                <div className="customer-growth-list">
                  {membership.growthEvents.map((event) =>
                    event.source.kind === "reservation" && event.source.id ? (
                      <button
                        key={event.id}
                        onClick={() => openJourneyReservation(event.source.id!)}
                        type="button"
                      >
                        <Star weight="fill" />
                        <span>
                          <strong>{event.label}</strong>
                          <small>
                            {formatWindow(event.businessOccurredAt)} ·
                            最终模拟金额{" "}
                            {formatMoney(event.finalSimulatedAmountCents)}
                          </small>
                        </span>
                        <em>+{event.growthPoints}</em>
                        <CaretRight />
                      </button>
                    ) : (
                      <div key={event.id}>
                        <Star weight="fill" />
                        <span>
                          <strong>{event.label}</strong>
                          <small>
                            {formatWindow(event.businessOccurredAt)}
                          </small>
                        </span>
                        <em>+{event.growthPoints}</em>
                      </div>
                    ),
                  )}
                </div>
              </section>
            </>
          ) : null}
        </div>
      ) : view === "conditions" ? (
        <div className="customer-scroll-content">
          <section className="customer-demo-strip">
            <ShieldCheck weight="duotone" />
            <span>
              <strong>Web 独立沙箱</strong>
              三店、人物、座位与金额均为合成演示数据；不与小程序同步。
            </span>
          </section>

          <section className="customer-reservation-hero">
            <span className="customer-eyebrow">RESERVATION FIRST</span>
            <h1>预约一个明确座位</h1>
            <p>先选门店、时段、区域和机型，再查看服务端推导的可订性。</p>
            <div className="customer-step-rail" aria-label="预约进度">
              <span className="is-active">
                <i>1</i>选时段
              </span>
              <span>
                <i>2</i>选座位
              </span>
              <span>
                <i>3</i>确认
              </span>
            </div>
          </section>

          <section
            className="customer-section"
            aria-labelledby="stores-heading"
          >
            <div className="customer-section-title">
              <div>
                <span>{catalog.city} · 虚构地点</span>
                <h2 id="stores-heading">三店浏览</h2>
              </div>
              <MapPin />
            </div>
            <div className="customer-store-list">
              {catalog.stores.map((item, index) => (
                <button
                  aria-pressed={item.code === storeCode}
                  className={item.code === storeCode ? "is-selected" : ""}
                  key={item.code}
                  onClick={() => chooseStore(item.code)}
                  type="button"
                >
                  <span className="customer-store-index">0{index + 1}</span>
                  <span className="customer-store-copy">
                    <small>
                      {item.code === "prism-flagship"
                        ? "主演示门店"
                        : "固定虚构门店"}
                      {" · "}
                      {item.fictitiousCity}
                    </small>
                    <strong>{item.displayName}</strong>
                    <span>
                      <Clock />
                      {item.businessHours}
                      <Armchair />
                      {item.seatCount} 座
                    </span>
                    <em className="customer-store-introduction">
                      {item.introduction}
                    </em>
                    <em aria-label="门店区域">
                      {item.areas
                        .map((storeArea) => storeArea.displayName)
                        .join(" · ")}
                    </em>
                  </span>
                  {item.code === storeCode ? (
                    <CheckCircle weight="fill" />
                  ) : (
                    <CaretRight />
                  )}
                </button>
              ))}
            </div>
          </section>

          <section className="customer-section">
            <div className="customer-section-title">
              <div>
                <span>1–8 小时 · 上海时间</span>
                <h2>预约条件</h2>
              </div>
              <CalendarBlank />
            </div>
            <div className="customer-segmented">
              <button
                aria-pressed={mode === "immediate"}
                className={mode === "immediate" ? "is-active" : ""}
                onClick={() => setMode("immediate")}
                type="button"
              >
                <Lightning />
                立即预约
              </button>
              <button
                aria-pressed={mode === "future"}
                className={mode === "future" ? "is-active" : ""}
                onClick={() => setMode("future")}
                type="button"
              >
                <CalendarBlank />
                未来七天
              </button>
            </div>
            {mode === "future" ? (
              <label className="customer-field">
                <span>开始时间</span>
                <input
                  max={maximumFutureStart}
                  min={minimumFutureStart}
                  onChange={(event) => setFutureStart(event.target.value)}
                  step="1800"
                  type="datetime-local"
                  value={futureStart}
                />
              </label>
            ) : (
              <div className="customer-inline-note">
                <Clock />
                {catalog?.bookingRules
                  .immediateSelectsNearestArrivalEligibleSegment
                  ? "服务端会选择到店窗口仍有效的最近半小时片段。"
                  : "当前半小时片段起点由该沙箱创建时的服务端业务时钟确定。"}
              </div>
            )}
            <div className="customer-duration-control">
              <span>使用时长</span>
              <button
                aria-label="减少一小时"
                disabled={durationHours === 1}
                onClick={() =>
                  setDurationHours((value) => Math.max(1, value - 1))
                }
                type="button"
              >
                <Minus />
              </button>
              <strong>{durationHours} 小时</strong>
              <button
                aria-label="增加一小时"
                disabled={durationHours === 8}
                onClick={() =>
                  setDurationHours((value) => Math.min(8, value + 1))
                }
                type="button"
              >
                <Plus />
              </button>
            </div>
          </section>

          <section className="customer-section">
            <div className="customer-section-title">
              <div>
                <span>{store?.seatCount} 座 · 局部分区导航</span>
                <h2>区域与机型</h2>
              </div>
              <Monitor />
            </div>
            <div
              className="customer-area-tabs"
              role="radiogroup"
              aria-label="区域"
            >
              {store?.areas.map((item) => (
                <button
                  aria-checked={item.code === areaCode}
                  className={item.code === areaCode ? "is-active" : ""}
                  key={item.code}
                  onClick={() => setAreaCode(item.code)}
                  role="radio"
                  type="button"
                >
                  {item.displayName}
                  <small>{item.seatCount} 座</small>
                </button>
              ))}
            </div>
            <div
              className="customer-machine-list"
              role="radiogroup"
              aria-label="机型档案"
            >
              {store?.machineProfiles.map((profile) => {
                const Icon = profileIcons[profile.code];
                return (
                  <button
                    aria-checked={profile.code === machineCode}
                    className={profile.code === machineCode ? "is-active" : ""}
                    key={profile.code}
                    onClick={() => setMachineCode(profile.code)}
                    role="radio"
                    type="button"
                  >
                    <Icon />
                    <span>
                      <strong>{profile.displayName}</strong>
                      <small>
                        {profile.experienceDescription} · {profile.seatCount} 座
                      </small>
                    </span>
                    <em>{formatMoney(profile.baseHourlyCents)}/小时起</em>
                  </button>
                );
              })}
            </div>
          </section>

          {availabilityFailure ? (
            <section className="customer-feedback is-error" role="alert">
              <Warning />
              <span>
                <strong>当前条件不可用</strong>
                {availabilityFailure}
              </span>
              <button
                onClick={() => setAvailabilityAttempt((attempt) => attempt + 1)}
                type="button"
              >
                重新查询
              </button>
            </section>
          ) : null}
          {selectionNotice ? (
            <section className="customer-feedback" role="status">
              <Info />
              <span>
                <strong>已重新查询</strong>
                {selectionNotice}
              </span>
            </section>
          ) : null}

          <section className="customer-price-preview" aria-live="polite">
            <span>
              <CurrencyCny />
              预计模拟金额
            </span>
            <strong>
              {availability ? formatMoney(availability.price.totalCents) : "—"}
            </strong>
            <small>
              {availabilityLoading
                ? "正在重新查询可订性与价格…"
                : availability
                  ? `${availability.price.segments.length} 个半小时片段 · 整数分计算`
                  : "调整条件后重试"}
            </small>
          </section>

          <div className="customer-find-action">
            <button
              className="customer-primary-button customer-find-seats"
              disabled={!availability || availabilityLoading}
              onClick={() => setView("seats")}
              type="button"
            >
              <MagnifyingGlass />
              查找可订座位
            </button>
            <p className="customer-payment-boundary">
              后续为模拟支付（不扣款）
            </p>
          </div>
        </div>
      ) : view === "seats" ? (
        <div className="customer-scroll-content has-seat-action">
          <button
            className="customer-back-button"
            onClick={() => setView("conditions")}
            type="button"
          >
            <CaretLeft />
            返回修改时段、区域或机型
          </button>
          <section className="customer-seat-summary">
            <div>
              <CalendarBlank />
              <span>
                <small>
                  {availability?.window.mode === "immediate"
                    ? "立即预约"
                    : "未来预约"}
                </small>
                <strong>
                  {availability
                    ? `${formatWindow(availability.window.startsAt)}–${formatWindow(availability.window.endsAt)}`
                    : "—"}
                </strong>
              </span>
            </div>
            <div>
              <Monitor />
              <span>
                <small>{availability?.machineProfile.displayName}</small>
                <strong>
                  {availability?.machineProfile.experienceDescription}
                </strong>
              </span>
            </div>
          </section>
          <div
            className="customer-step-rail is-seat-step"
            aria-label="预约进度"
          >
            <span>
              <i>
                <CheckCircle weight="fill" />
              </i>
              选时段
            </span>
            <span className="is-active">
              <i>2</i>选座位
            </span>
            <span>
              <i>3</i>确认
            </span>
          </div>
          <section className="customer-seat-map">
            <div className="customer-seat-map-title">
              <div>
                <span>
                  {availability?.area.displayName} ·{" "}
                  {availability?.seats.length ?? 0} 个匹配座位
                </span>
                <h1>请选择一个座位</h1>
              </div>
              <small>屏幕方向 ↑</small>
            </div>
            <div
              className="customer-seat-grid"
              aria-label={`${availability?.area.displayName ?? "区域"}座位图`}
            >
              {availability?.seats.map((seat) => {
                const selected = seat.code === selectedSeat;
                const disabled = seat.availability !== "available";
                return (
                  <button
                    aria-label={`${seat.code}，${availability.machineProfile.displayName}，${selected ? "已选" : availabilityLabels[seat.availability]}`}
                    className={`is-${seat.availability} ${selected ? "is-selected" : ""}`}
                    disabled={disabled}
                    key={seat.code}
                    onClick={() => {
                      setSelectedSeat(seat.code);
                      setSelectionNotice("");
                    }}
                    type="button"
                  >
                    {seat.availability === "maintenance" ? (
                      <Wrench />
                    ) : seat.availability === "reserved" ||
                      seat.availability === "in-use" ? (
                      <Lock />
                    ) : (
                      <Armchair weight={selected ? "fill" : "regular"} />
                    )}
                    <strong>{seat.code.replace(/^[A-Z]-/u, "")}</strong>
                    <small>
                      {selected
                        ? "已选"
                        : availabilityLabels[seat.availability]}
                    </small>
                  </button>
                );
              })}
            </div>
            {availability?.seats.length === 0 ? (
              <div className="customer-inline-note">
                <Info />
                当前区域没有匹配该机型的座位，请返回更换区域或机型。
              </div>
            ) : null}
            <div className="customer-seat-legend" aria-label="座位图例">
              <span>
                <Armchair />
                可订
              </span>
              <span>
                <CheckCircle weight="fill" />
                已选
              </span>
              <span>
                <Lock />
                已预留 / 使用中
              </span>
              <span>
                <Wrench />
                维护中
              </span>
            </div>
            <div className="customer-inline-note">
              <Info />
              “维护中”是座位运营状态；其他结果按当前查询时段与预约记录推导。
            </div>
          </section>
          <section className="customer-price-segments">
            <div className="customer-section-title">
              <div>
                <span>半小时整数分片段</span>
                <h2>价格依据</h2>
              </div>
              <CurrencyCny />
            </div>
            {availability?.price.segments.map((segment) => (
              <div key={segment.startsAt}>
                <span>
                  <strong>
                    {formatWindow(segment.startsAt)}–
                    {formatWindow(segment.endsAt)}
                  </strong>
                  <small>{priceRuleLabels[segment.rule]}</small>
                </span>
                <strong>{formatMoney(segment.amountCents)}</strong>
              </div>
            ))}
            <div className="customer-price-total">
              <span>预计模拟总额</span>
              <strong>
                {availability
                  ? formatMoney(availability.price.totalCents)
                  : "—"}
              </strong>
            </div>
          </section>
          <div className="customer-seat-action">
            <span>
              <small>
                {selectionNotice ||
                  (selectedSeat
                    ? `已选 · ${availability?.area.displayName}`
                    : "请选择一个可订座位")}
              </small>
              <strong>
                {selectionNotice
                  ? "未创建预约 · 未发生扣款"
                  : selectedSeat
                    ? `${selectedSeat} · ${formatMoney(availability?.price.totalCents ?? 0)}`
                    : "价格预览不会创建预约"}
              </strong>
            </span>
            <button
              disabled={!selectedSeat}
              onClick={openConfirmation}
              type="button"
            >
              继续确认
              <CaretRight />
            </button>
          </div>
        </div>
      ) : view === "confirm" && availability ? (
        <div className="customer-scroll-content has-confirm-action">
          <button
            className="customer-back-button"
            onClick={returnToSeats}
            type="button"
          >
            <CaretLeft />
            返回选座
          </button>
          <div
            className="customer-step-rail is-confirm-step"
            aria-label="预约进度"
          >
            <span>
              <i>
                <CheckCircle weight="fill" />
              </i>
              选时段
            </span>
            <span>
              <i>
                <CheckCircle weight="fill" />
              </i>
              选座位
            </span>
            <span className="is-active">
              <i>3</i>
              确认
            </span>
          </div>
          <section className="customer-confirmation-hero">
            <span className="customer-eyebrow">RESERVATION SNAPSHOT</span>
            <div>
              <h1>
                {formatSeatTitle(availability.area.displayName, selectedSeat)}
              </h1>
              <em>
                {availability.window.mode === "immediate"
                  ? "立即预约"
                  : "未来时段"}
              </em>
            </div>
            <p>
              {availability.store.displayName} ·{" "}
              {availability.machineProfile.displayName} ·{" "}
              {availability.machineProfile.experienceDescription}
            </p>
            <div className="customer-confirmation-time">
              <Clock />
              <span>
                <strong>
                  {formatFullWindow(
                    availability.window.startsAt,
                    availability.window.endsAt,
                  )}
                </strong>
                <small>{durationHours} 小时 · 上海时间</small>
              </span>
            </div>
          </section>
          <section className="customer-section customer-confirm-money">
            <div className="customer-section-title">
              <div>
                <span>创建后保持不变</span>
                <h2>模拟金额</h2>
              </div>
              <CurrencyCny />
            </div>
            <div className="customer-money-summary">
              <div>
                <span>
                  {availability.price.segments.length} 个半小时价格片段
                </span>
                <strong>{formatMoney(availability.price.totalCents)}</strong>
              </div>
              <div>
                <span>预约体验券</span>
                <strong className="is-discount">
                  {selectedCoupon
                    ? "−" + formatMoney(selectedDiscountCents)
                    : "未使用"}
                </strong>
              </div>
              <div className="is-total">
                <span>应付模拟金额</span>
                <strong>{formatMoney(selectedPayableCents)}</strong>
              </div>
            </div>
            <button
              aria-expanded={priceExpanded}
              className="customer-price-expand"
              onClick={() => setPriceExpanded((value) => !value)}
              type="button"
            >
              半小时价格明细
              <span>
                {priceExpanded ? "收起" : "展开"}
                <CaretDown className={priceExpanded ? "is-rotated" : ""} />
              </span>
            </button>
            {priceExpanded ? (
              <div className="customer-confirm-segments">
                {availability.price.segments.map((segment) => (
                  <div key={segment.startsAt}>
                    <span>
                      <strong>
                        {formatWindow(segment.startsAt)}–
                        {formatWindow(segment.endsAt)}
                      </strong>
                      <small>{priceRuleLabels[segment.rule]}</small>
                    </span>
                    <strong>{formatMoney(segment.amountCents)}</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
          <section className="customer-section customer-coupon-section">
            <div className="customer-section-title">
              <div>
                <span>同一事务最多占用一张</span>
                <h2>体验券</h2>
              </div>
              <Ticket />
            </div>
            <button
              aria-pressed={selectedCouponId === null}
              className={
                selectedCouponId === null
                  ? "customer-no-coupon is-selected"
                  : "customer-no-coupon"
              }
              onClick={() => {
                setSelectedCouponId(null);
                reservationKeyRef.current = null;
              }}
              type="button"
            >
              <Circle weight={selectedCouponId === null ? "fill" : "regular"} />
              <span>
                <strong>不使用体验券</strong>
                <small>按价格片段原价创建保留</small>
              </span>
            </button>
            {availability.coupons.length === 0 ? (
              <div className="customer-coupon-empty">
                <Info />
                当前没有预约体验券，仍可按原价继续。
              </div>
            ) : (
              <div className="customer-coupon-list">
                {availability.coupons.map((coupon) => {
                  const eligible = coupon.eligibility.status === "eligible";
                  const selected = coupon.id === selectedCouponId;
                  return (
                    <button
                      aria-pressed={selected}
                      className={[
                        selected ? "is-selected" : "",
                        eligible ? "" : "is-unavailable",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={coupon.id}
                      onClick={() => {
                        if (!eligible) return;
                        setSelectedCouponId(selected ? null : coupon.id);
                        reservationKeyRef.current = null;
                      }}
                      type="button"
                    >
                      <Ticket weight="fill" />
                      <span>
                        <strong>
                          {coupon.displayName} ·{" "}
                          {formatMoney(coupon.discountCents)}
                        </strong>
                        <small>
                          {eligible
                            ? "满 " +
                              formatMoney(coupon.minimumSpendCents) +
                              " 可用 · 当前适用"
                            : couponReasonLabels[coupon.eligibility.reason]}
                        </small>
                      </span>
                      {selected ? <CheckCircle weight="fill" /> : <Circle />}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
          <section className="customer-no-charge-notice">
            <ShieldCheck weight="duotone" />
            <span>
              <strong>模拟支付不会扣款</strong>
              本步只创建十分钟预约保留，并保存价格与体验券快照；不调用真实支付。
            </span>
          </section>
          {submissionFailure ? (
            <section className="customer-feedback is-error" role="alert">
              <Warning />
              <span>
                <strong>
                  {conflictInvalidated ? "当前选择已失效" : "尚未创建保留"}
                </strong>
                {submissionFailure}
              </span>
              <button
                onClick={
                  conflictInvalidated ? returnToSeats : createReservation
                }
                type="button"
              >
                {conflictInvalidated ? "返回选座" : "安全重试"}
              </button>
            </section>
          ) : null}
          <div className="customer-confirm-action">
            <span>
              <small>十分钟排他保留 · 不扣款</small>
              <strong>
                {conflictInvalidated
                  ? "选择已失效"
                  : selectedSeat + " · 确认快照后创建"}
              </strong>
            </span>
            <button
              disabled={submitting || conflictInvalidated}
              onClick={createReservation}
              type="button"
            >
              {submitting ? "正在创建…" : "创建十分钟保留"}
              <CaretRight />
            </button>
          </div>
        </div>
      ) : view === "payment" && activeReservationId && activeSnapshot ? (
        <div className="customer-scroll-content customer-payment-flow">
          {paymentStage === "confirm" ? (
            <>
              <button
                className="customer-back-button"
                onClick={() =>
                  setView(
                    createdReservation?.reservationId === activeReservationId
                      ? "held"
                      : "detail",
                  )
                }
                type="button"
              >
                <CaretLeft />
                返回预约保留
              </button>
              <section className="customer-payment-stage">
                <div className="customer-payment-stage-icon">
                  <ShieldCheck weight="duotone" />
                </div>
                <span className="customer-eyebrow">SIMULATED PAYMENT</span>
                <h1>确认模拟支付</h1>
                <p>本次不会扣款，也不需要任何真实支付凭证。</p>
                <strong>
                  {formatMoney(activeSnapshot.price.payableCents)}
                </strong>
                <div className="customer-payment-brief">
                  <span>
                    {activeSnapshot.store.displayName} ·{" "}
                    {activeSnapshot.seat.code}
                  </span>
                  <span>
                    {formatFullWindow(
                      activeSnapshot.window.startsAt,
                      activeSnapshot.window.endsAt,
                    )}
                  </span>
                </div>
                <button
                  className="customer-primary-button"
                  onClick={simulatePayment}
                  type="button"
                >
                  确认模拟支付（不扣款）
                </button>
                <button
                  className="customer-payment-secondary"
                  onClick={() => setView("detail")}
                  type="button"
                >
                  查看预约详情与状态
                </button>
              </section>
            </>
          ) : paymentStage === "processing" ? (
            <section
              aria-live="polite"
              className="customer-payment-stage is-processing"
            >
              <div className="customer-payment-stage-icon">
                <Hourglass />
              </div>
              <span className="customer-eyebrow">PROCESSING</span>
              <h1>正在完成模拟支付</h1>
              <p>只更新演示预约，不会扣款，也不会接触真实支付凭证。</p>
              <div className="customer-payment-progress" />
              <small>请勿重复提交；超时后可使用原提交标识安全重试。</small>
            </section>
          ) : paymentStage === "success" ? (
            <section
              aria-live="polite"
              className="customer-payment-stage is-success"
            >
              <div className="customer-payment-stage-icon">
                <CheckCircle weight="fill" />
              </div>
              <span className="customer-eyebrow">SIMULATION SUCCEEDED</span>
              <h1>模拟支付成功</h1>
              <p>预约已确认。全程没有扣款，也没有使用真实支付凭证。</p>
              <strong>
                {formatMoney(paymentResult?.payment.amountCents ?? 0)}
              </strong>
              <section className="customer-no-charge-notice">
                <ShieldCheck weight="duotone" />
                <span>
                  <strong>本次为模拟结果</strong>
                  金额只来自预约快照，不代表真实交易或真实退款。
                </span>
              </section>
              <button
                className="customer-primary-button"
                onClick={() => setView("detail")}
                type="button"
              >
                查看预约详情
                <CaretRight />
              </button>
            </section>
          ) : (
            <section
              aria-live="assertive"
              className="customer-payment-stage is-failure"
            >
              <div className="customer-payment-stage-icon">
                <Warning weight="duotone" />
              </div>
              <span className="customer-eyebrow">SIMULATION NOT COMPLETED</span>
              <h1>模拟支付尚未完成</h1>
              <p>{paymentFailure}</p>
              <section className="customer-no-charge-notice">
                <ShieldCheck weight="duotone" />
                <span>
                  <strong>确认没有扣款</strong>
                  可使用原提交标识安全重试，不需要输入任何真实支付凭证。
                </span>
              </section>
              <button
                className="customer-primary-button"
                onClick={simulatePayment}
                type="button"
              >
                <ArrowClockwise />
                使用原提交标识安全重试
              </button>
              <button
                className="customer-payment-secondary"
                onClick={() => setView("detail")}
                type="button"
              >
                先查看当前预约状态
              </button>
            </section>
          )}
        </div>
      ) : view === "detail" && activeReservationId ? (
        <div className="customer-scroll-content customer-lifecycle-detail">
          <button
            className="customer-back-button"
            onClick={() => setView(detailReturnView)}
            type="button"
          >
            <CaretLeft />
            {detailReturnView === "journey" ? "返回统一行程" : "返回预约保留"}
          </button>
          {detailLoading && !reservationDetail ? (
            <section className="customer-lifecycle-loading" aria-live="polite">
              <ArrowClockwise />
              <strong>正在读取预约详情</strong>
              <span>以服务端状态和不可变时间线为准。</span>
            </section>
          ) : reservationDetail ? (
            <>
              <section className="customer-arrival-card">
                <div>
                  <span className="customer-eyebrow">ARRIVAL WINDOW</span>
                  <strong>
                    到店窗口{" "}
                    {formatWindow(reservationDetail.arrivalWindow.opensAt)}–
                    {formatWindow(reservationDetail.arrivalWindow.closesAt)}
                  </strong>
                  <small>请在窗口内到店；以服务端业务时钟为准。</small>
                </div>
                <Armchair weight="duotone" />
              </section>
              <div className="customer-lifecycle-status-row">
                <span
                  className={`is-${reservationStatusLabels[reservationDetail.status].tone}`}
                >
                  {reservationStatusLabels[reservationDetail.status].label}
                </span>
                {reservationDetail.status === "pending-confirmation" ? (
                  <strong>
                    <Timer /> 保留倒计时 {holdCountdown}
                  </strong>
                ) : (
                  <strong>状态已由服务端确认</strong>
                )}
              </div>
              <ol
                aria-label="预约生命周期进度"
                className="customer-lifecycle-progress"
              >
                {lifecycleProgressSteps.map((step, index) => {
                  const progressIndex = lifecycleProgressIndex(
                    reservationDetail.status,
                    reservationDetail.timeline,
                  );
                  const isComplete =
                    reservationDetail.status === "completed" ||
                    index < progressIndex;
                  const isCurrent = index === progressIndex && !isComplete;
                  return (
                    <li
                      className={
                        isComplete
                          ? "is-complete"
                          : isCurrent
                            ? "is-current"
                            : undefined
                      }
                      key={step.status}
                    >
                      <i aria-hidden="true">{isComplete ? "✓" : index + 1}</i>
                      <span>{step.label}</span>
                    </li>
                  );
                })}
              </ol>
              <section className="customer-lifecycle-card">
                <div className="customer-section-title">
                  <div>
                    <span>RESERVATION SNAPSHOT</span>
                    <h2>预约信息</h2>
                  </div>
                  <CalendarBlank />
                </div>
                <dl className="customer-lifecycle-facts">
                  <div>
                    <dt>门店</dt>
                    <dd>{reservationDetail.snapshot.store.displayName}</dd>
                  </div>
                  <div>
                    <dt>座位</dt>
                    <dd>
                      {formatSeatTitle(
                        reservationDetail.snapshot.area.displayName,
                        reservationDetail.snapshot.seat.code,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>机型</dt>
                    <dd>
                      {reservationDetail.snapshot.machineProfile.displayName} ·{" "}
                      {
                        reservationDetail.snapshot.machineProfile
                          .experienceDescription
                      }
                    </dd>
                  </div>
                  <div>
                    <dt>时段</dt>
                    <dd>
                      {formatFullWindow(
                        reservationDetail.snapshot.window.startsAt,
                        reservationDetail.snapshot.window.endsAt,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>快照金额</dt>
                    <dd>
                      {formatMoney(
                        reservationDetail.snapshot.price.payableCents,
                      )}
                    </dd>
                  </div>
                </dl>
                <button
                  aria-expanded={detailPriceExpanded}
                  className="customer-price-expand"
                  onClick={() =>
                    setDetailPriceExpanded((expanded) => !expanded)
                  }
                  type="button"
                >
                  价格与体验券快照
                  <span>
                    {detailPriceExpanded ? "收起" : "展开"}
                    <CaretDown
                      className={detailPriceExpanded ? "is-rotated" : ""}
                    />
                  </span>
                </button>
                {detailPriceExpanded ? (
                  <div className="customer-lifecycle-price-detail">
                    <span>
                      原价
                      <strong>
                        {formatMoney(
                          reservationDetail.snapshot.price.subtotalCents,
                        )}
                      </strong>
                    </span>
                    <span>
                      体验券
                      <strong>
                        {reservationDetail.snapshot.coupon
                          ? `${reservationDetail.snapshot.coupon.displayName} −${formatMoney(reservationDetail.snapshot.price.discountCents)}`
                          : "未使用"}
                      </strong>
                    </span>
                    <span>
                      当前券状态
                      <strong>
                        {reservationDetail.coupon?.status ?? "无体验券"}
                      </strong>
                    </span>
                  </div>
                ) : null}
              </section>
              {reservationDetail.refund ? (
                <section className="customer-refund-card">
                  <CurrencyCny />
                  <span>
                    <strong>模拟退款已记录</strong>
                    {formatMoney(reservationDetail.refund.amountCents)} ·{" "}
                    {reservationDetail.refund.reason}
                  </span>
                  <em>不对应真实资金</em>
                </section>
              ) : null}
              <section className="customer-lifecycle-card">
                <div className="customer-section-title">
                  <div>
                    <span>IMMUTABLE TIMELINE</span>
                    <h2>业务事件</h2>
                  </div>
                  <Clock />
                </div>
                <ol className="customer-lifecycle-timeline">
                  {reservationDetail.timeline.map((event, index) => (
                    <li key={`${event.occurredAt}-${event.type}-${index}`}>
                      <i />
                      <span>
                        <strong>
                          {timelineLabels[event.type] ?? event.type}
                        </strong>
                        <small>{formatWindow(event.occurredAt)}</small>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
              {reservationDetail.related.orders.length > 0 ||
              reservationDetail.related.repairs.length > 0 ? (
                <section className="customer-related-records">
                  <div className="customer-section-title">
                    <div>
                      <span>RELATED RECORDS</span>
                      <h2>相关单据</h2>
                    </div>
                    <Receipt />
                  </div>
                  {reservationDetail.related.orders.map((order) => (
                    <button
                      key={order.id}
                      onClick={() => openRelatedOrder(order.id)}
                      type="button"
                    >
                      <Package />
                      <span>
                        <strong>{order.label}</strong>
                        <small>{orderStatusLabels[order.status]}</small>
                      </span>
                      <CaretRight />
                    </button>
                  ))}
                  {reservationDetail.related.repairs.map((repair) => (
                    <button
                      key={repair.id}
                      onClick={() => openExistingRepair(repair)}
                      type="button"
                    >
                      <Wrench />
                      <span>
                        <strong>{repair.label}</strong>
                        <small>
                          {repair.status === "new" ? "新建" : repair.status}
                        </small>
                      </span>
                      <CaretRight />
                    </button>
                  ))}
                </section>
              ) : (
                <section className="customer-related-empty">
                  <Info />
                  <span>
                    <strong>相关单据</strong>
                    当前没有关联订单或报修记录。
                  </span>
                </section>
              )}
              {detailFailure ? (
                <section className="customer-feedback is-error" role="alert">
                  <Warning />
                  <span>
                    <strong>刷新未完成</strong>
                    {detailFailure}
                  </span>
                </section>
              ) : null}
              <div className="customer-lifecycle-actions">
                {reservationDetail.status === "in-use" ? (
                  <button
                    className="customer-primary-button"
                    onClick={() => {
                      const existing = reservationDetail.related.repairs[0];
                      if (existing) openExistingRepair(existing);
                      else openRepairCreate();
                    }}
                    type="button"
                  >
                    <Wrench />
                    {reservationDetail.related.repairs.length > 0
                      ? "查看现有报修"
                      : "为当前座位报修"}
                  </button>
                ) : null}
                {reservationDetail.status === "arrived" ||
                reservationDetail.status === "in-use" ? (
                  <button
                    className="customer-primary-button"
                    onClick={() =>
                      void openOrderCatalog(reservationDetail.reservationId)
                    }
                    type="button"
                  >
                    <Storefront />
                    购买柜台商品
                  </button>
                ) : null}
                {reservationDetail.actions.canSimulatePayment ? (
                  <button
                    className="customer-primary-button"
                    onClick={openPayment}
                    type="button"
                  >
                    继续模拟支付（不扣款）
                  </button>
                ) : null}
                {reservationDetail.actions.canCancel ? (
                  <button
                    className="customer-danger-button"
                    onClick={() => {
                      setCancelFailure("");
                      setCancelOpen(true);
                    }}
                    type="button"
                  >
                    取消预约
                  </button>
                ) : null}
                {!reservationDetail.actions.canCancel &&
                !reservationDetail.actions.canSimulatePayment ? (
                  <button
                    className="customer-primary-button"
                    onClick={restartReservation}
                    type="button"
                  >
                    再次预约
                  </button>
                ) : null}
                <button
                  className="customer-payment-secondary"
                  disabled={detailLoading}
                  onClick={() =>
                    void readReservationDetail(activeReservationId)
                  }
                  type="button"
                >
                  <ArrowClockwise />
                  {detailLoading ? "正在刷新…" : "刷新当前状态"}
                </button>
              </div>
              {cancelOpen ? (
                <div className="customer-cancel-backdrop" role="presentation">
                  <section
                    aria-labelledby="customer-cancel-title"
                    aria-modal="true"
                    className="customer-cancel-dialog"
                    role="dialog"
                  >
                    <span className="customer-eyebrow">CANCEL RESERVATION</span>
                    <h2 id="customer-cancel-title">确认取消预约？</h2>
                    <p>
                      待支付预约不退款；已确认且未开始的预约会全额模拟退款并恢复体验券。
                    </p>
                    <label>
                      <span>取消原因</span>
                      <textarea
                        maxLength={200}
                        onChange={(event) => {
                          setCancelReason(event.target.value);
                          cancelKeyRef.current = null;
                        }}
                        placeholder="请输入 1–200 字原因"
                        rows={3}
                        value={cancelReason}
                      />
                    </label>
                    {cancelFailure ? (
                      <div className="customer-cancel-error" role="alert">
                        {cancelFailure}
                      </div>
                    ) : null}
                    <div>
                      <button
                        disabled={cancelSubmitting}
                        onClick={() => setCancelOpen(false)}
                        type="button"
                      >
                        返回
                      </button>
                      <button
                        disabled={
                          cancelSubmitting || cancelReason.trim().length === 0
                        }
                        onClick={cancelReservation}
                        type="button"
                      >
                        {cancelSubmitting ? "正在取消…" : "确认取消预约"}
                      </button>
                    </div>
                  </section>
                </div>
              ) : null}
            </>
          ) : (
            <section className="customer-lifecycle-loading is-error">
              <Warning />
              <strong>预约详情暂时不可用</strong>
              <span>{detailFailure}</span>
              <button
                className="customer-primary-button"
                onClick={() => void readReservationDetail(activeReservationId)}
                type="button"
              >
                重新读取
              </button>
            </section>
          )}
        </div>
      ) : createdReservation ? (
        <div className="customer-scroll-content customer-held-state">
          <div className="customer-held-icon">
            <CheckCircle weight="fill" />
          </div>
          <span className="customer-eyebrow">PENDING CONFIRMATION</span>
          <h1>预约已排他保留十分钟</h1>
          <p>
            到 {formatWindow(createdReservation.holdExpiresAt)}{" "}
            前，该座位时段只为你保留。
          </p>
          <section className="customer-held-snapshot">
            <span>
              {createdReservation.snapshot.store.displayName} ·{" "}
              {formatSeatTitle(
                createdReservation.snapshot.area.displayName,
                createdReservation.snapshot.seat.code,
              )}
            </span>
            <strong>
              {formatFullWindow(
                createdReservation.snapshot.window.startsAt,
                createdReservation.snapshot.window.endsAt,
              )}
            </strong>
            <span>
              {createdReservation.snapshot.machineProfile.displayName} ·{" "}
              {createdReservation.snapshot.machineProfile.experienceDescription}
            </span>
            <div>
              <span>
                {createdReservation.snapshot.coupon
                  ? createdReservation.snapshot.coupon.displayName +
                    " −" +
                    formatMoney(createdReservation.snapshot.price.discountCents)
                  : "未使用预约体验券"}
              </span>
              <strong>
                {formatMoney(createdReservation.snapshot.price.payableCents)}
              </strong>
            </div>
          </section>
          <section className="customer-no-charge-notice">
            <ShieldCheck weight="duotone" />
            <span>
              <strong>没有发生扣款</strong>
              预约、价格与体验券结果已形成快照；后续模拟支付由下一旅程继续。
            </span>
          </section>
          <div className="customer-held-actions">
            <button
              className="customer-primary-button"
              onClick={openPayment}
              type="button"
            >
              继续模拟支付（不扣款）
              <CaretRight />
            </button>
            <button
              className="customer-payment-secondary"
              disabled={detailLoading && !reservationDetail}
              onClick={() => setView("detail")}
              type="button"
            >
              {detailLoading && !reservationDetail
                ? "正在读取详情…"
                : "查看预约详情"}
            </button>
          </div>
        </div>
      ) : null}

      {["conditions", "journey", "membership", "seats"].includes(view) ? (
        <nav className="customer-bottom-nav" aria-label="顾客 H5 导航">
          <button
            className={
              view === "conditions" || view === "seats" ? "is-active" : ""
            }
            onClick={() => setView("conditions")}
            type="button"
          >
            <House weight="fill" />
            <span>预约</span>
          </button>
          <button
            onClick={() => {
              setView("conditions");
              window.setTimeout(
                () =>
                  document
                    .getElementById("stores-heading")
                    ?.scrollIntoView({ behavior: "smooth" }),
                0,
              );
            }}
            type="button"
          >
            <Storefront />
            <span>门店</span>
          </button>
          <button
            className={view === "journey" ? "is-active" : ""}
            onClick={() => setView("journey")}
            type="button"
          >
            <CalendarBlank weight={view === "journey" ? "fill" : "regular"} />
            <span>行程</span>
          </button>
          <button
            className={view === "membership" ? "is-active" : ""}
            onClick={() => setView("membership")}
            type="button"
          >
            <User weight={view === "membership" ? "fill" : "regular"} />
            <span>会员</span>
          </button>
        </nav>
      ) : null}
    </main>
  );
}
