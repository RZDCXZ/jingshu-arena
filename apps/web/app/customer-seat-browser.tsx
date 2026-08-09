"use client";

import {
  Armchair,
  ArrowClockwise,
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Circle,
  Clock,
  CurrencyCny,
  GameController,
  House,
  Hourglass,
  Info,
  Lightning,
  Lock,
  MagnifyingGlass,
  MapPin,
  Minus,
  Monitor,
  Plus,
  ShieldCheck,
  Storefront,
  Ticket,
  Timer,
  User,
  Warning,
  Wrench,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ApiErrorResponse,
  CreateCustomerPendingReservationRequest,
  CustomerMachineProfileCode,
  CustomerSeatAvailability,
  CustomerSeatAvailabilityResponse,
  CustomerPendingReservationResponse,
  CustomerReservationCancellationResponse,
  CustomerReservationDetailResponse,
  CustomerReservationPaymentResponse,
  CustomerReservationStatus,
  CustomerStoreCatalogResponse,
} from "@jingshu/contracts";

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
  "conditions" | "confirm" | "detail" | "held" | "payment" | "seats";

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

const lifecycleProgressSteps = [
  { label: "已确认", status: "confirmed" },
  { label: "已到店", status: "arrived" },
  { label: "使用中", status: "in-use" },
] as const;

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

const LIFECYCLE_REQUEST_TIMEOUT_MS = 8_000;

export function CustomerSeatBrowser({ csrfToken }: { csrfToken: string }) {
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

  useEffect(() => {
    if (
      view !== "detail" ||
      reservationDetail?.status !== "pending-confirmation"
    ) {
      return;
    }
    const timer = window.setInterval(
      () => setCountdownTick((value) => value + 1),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [reservationDetail?.status, view]);

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
    if (!createdReservation || paymentStage === "processing") return;
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
        `/api/v1/customer/reservations/${createdReservation.reservationId}/simulated-payment`,
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
          await readReservationDetail(createdReservation.reservationId);
        }
        throw new Error(failure.error.message);
      }
      setPaymentResult(payload as CustomerReservationPaymentResponse);
      await readReservationDetail(createdReservation.reservationId);
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
      !createdReservation ||
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
        `/api/v1/customer/reservations/${createdReservation.reservationId}/cancel`,
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
          await readReservationDetail(createdReservation.reservationId);
        }
        throw new Error(failure.error.message);
      }
      await readReservationDetail(createdReservation.reservationId);
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

  function restartReservation() {
    setView("conditions");
    setCreatedReservation(null);
    setReservationDetail(null);
    setSelectedSeat("");
    setSelectedCouponId(null);
    setDetailFailure("");
    setPaymentFailure("");
    paymentKeyRef.current = null;
    cancelKeyRef.current = null;
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

  return (
    <main className="customer-h5" data-testid="customer-h5">
      <header className="customer-mobile-header">
        <div>
          <span>
            {view === "payment" ? "WEB-C02 / MP-08" : "WEB-C00 / C02"}
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
                      : "预约座位"}
          </strong>
        </div>
        <span className="customer-demo-badge">演示数据</span>
      </header>

      {view === "conditions" ? (
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
                    </small>
                    <strong>{item.displayName}</strong>
                    <span>
                      <Clock />
                      {item.businessHours}
                      <Armchair />
                      {item.seatCount} 座
                    </span>
                    <em>
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
                当前半小时片段起点由服务端业务时钟确定。
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
      ) : view === "payment" && createdReservation ? (
        <div className="customer-scroll-content customer-payment-flow">
          {paymentStage === "confirm" ? (
            <>
              <button
                className="customer-back-button"
                onClick={() => setView("held")}
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
                  {formatMoney(createdReservation.snapshot.price.payableCents)}
                </strong>
                <div className="customer-payment-brief">
                  <span>
                    {createdReservation.snapshot.store.displayName} ·{" "}
                    {createdReservation.snapshot.seat.code}
                  </span>
                  <span>
                    {formatFullWindow(
                      createdReservation.snapshot.window.startsAt,
                      createdReservation.snapshot.window.endsAt,
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
      ) : view === "detail" && createdReservation ? (
        <div className="customer-scroll-content customer-lifecycle-detail">
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
              <section className="customer-related-empty">
                <Info />
                <span>
                  <strong>相关单据</strong>
                  当前没有关联订单或报修记录。
                </span>
              </section>
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
                    void readReservationDetail(createdReservation.reservationId)
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
                onClick={() =>
                  void readReservationDetail(createdReservation.reservationId)
                }
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

      {view === "conditions" || view === "seats" ? (
        <nav className="customer-bottom-nav" aria-label="顾客 H5 导航">
          <button
            className="is-active"
            onClick={() => setView("conditions")}
            type="button"
          >
            <House weight="fill" />
            <span>预约</span>
          </button>
          <button
            onClick={() =>
              document
                .getElementById("stores-heading")
                ?.scrollIntoView({ behavior: "smooth" })
            }
            type="button"
          >
            <Storefront />
            <span>门店</span>
          </button>
          <button disabled type="button">
            <CalendarBlank />
            <span>行程</span>
          </button>
          <button disabled type="button">
            <User />
            <span>会员</span>
          </button>
        </nav>
      ) : null}
    </main>
  );
}
