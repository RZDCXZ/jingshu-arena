export const PUBLIC_SANDBOX_SCHEMA_VERSION = "22";
export const PUBLIC_SANDBOX_SEED_VERSION = "2026-08-11.6";
export const SANDBOX_BUSINESS_TIME_ZONE = "Asia/Shanghai";
export const SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS = 24 * 60 * 60 * 1_000;

export function isSafePlainTextReason(value: string, maxLength = 200) {
  const reason = value.trim();
  return (
    reason.length > 0 &&
    reason.length <= maxLength &&
    !Array.from(reason).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (
        code < 32 || code === 127 || character === "<" || character === ">"
      );
    })
  );
}

export function normalizeRepairDescription(value: string) {
  const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  return isSafePlainTextReason(normalized, 500) ? normalized : null;
}

export const HANDOVER_EXCEPTION_GRACE_MS = 30 * 60 * 1_000;

export type HandoverExceptionKind =
  "confirmation-overdue" | "late-submission" | "submission-overdue";

export function normalizeHandoverNote(value: string): string | null {
  const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) return "";
  if (/(现金盘点|真实支付|支付对账)/u.test(normalized)) return null;
  return isSafePlainTextReason(normalized, 500) ? normalized : null;
}

export function classifyHandoverExceptions(input: {
  readonly confirmedAt: Date | null;
  readonly currentTime: Date;
  readonly shiftEndsAt: Date;
  readonly submittedAt: Date | null;
}): ReadonlyArray<HandoverExceptionKind> {
  const deadline = input.shiftEndsAt.getTime() + HANDOVER_EXCEPTION_GRACE_MS;
  if (input.submittedAt === null) {
    return input.currentTime.getTime() >= deadline
      ? ["submission-overdue"]
      : [];
  }

  const exceptions: HandoverExceptionKind[] = [];
  if (input.submittedAt.getTime() > input.shiftEndsAt.getTime()) {
    exceptions.push("late-submission");
  }
  const confirmationReference = input.confirmedAt ?? input.currentTime;
  if (confirmationReference.getTime() >= deadline) {
    exceptions.push("confirmation-overdue");
  }
  return exceptions;
}

const HALF_HOUR_MS = 30 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const SHANGHAI_BUSINESS_DAY_START_MINUTES = 6 * 60;

interface ShanghaiDateParts {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly month: number;
  readonly year: number;
}

const shanghaiDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  timeZone: SANDBOX_BUSINESS_TIME_ZONE,
  year: "numeric",
});

function shanghaiDateParts(value: Date): ShanghaiDateParts {
  const parts = Object.fromEntries(
    shanghaiDateTimeFormatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    month: parts.month ?? 0,
    year: parts.year ?? 0,
  };
}

function localDaySerial(parts: ShanghaiDateParts): number {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
}

function dateKeyFromSerial(serial: number): string {
  const value = new Date(serial * DAY_MS);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function clockMinutes(value: string): number {
  const [hourText, minuteText] = value.split(":");
  return Number(hourText) * 60 + Number(minuteText);
}

export function businessDayKey(value: Date): string {
  const parts = shanghaiDateParts(value);
  const minutes = parts.hour * 60 + parts.minute;
  const serial =
    localDaySerial(parts) -
    (minutes < SHANGHAI_BUSINESS_DAY_START_MINUTES ? 1 : 0);
  return dateKeyFromSerial(serial);
}

export function businessDayRange(value: Date): {
  readonly endsAt: Date;
  readonly key: string;
  readonly startsAt: Date;
} {
  const key = businessDayKey(value);
  const startsAt = new Date(`${key}T06:00:00.000+08:00`);
  return {
    endsAt: new Date(startsAt.getTime() + DAY_MS),
    key,
    startsAt,
  };
}

export function managerDashboardBusinessDays(value: Date): ReadonlyArray<{
  readonly endsAt: Date;
  readonly key: string;
  readonly startsAt: Date;
}> {
  const currentKey = businessDayKey(value);
  const currentSerial = Math.floor(
    Date.parse(`${currentKey}T00:00:00.000Z`) / DAY_MS,
  );
  return Array.from({ length: 14 }, (_, index) => {
    const key = dateKeyFromSerial(currentSerial - 13 + index);
    const startsAt = new Date(`${key}T06:00:00.000+08:00`);
    return {
      endsAt: new Date(startsAt.getTime() + DAY_MS),
      key,
      startsAt,
    };
  });
}

export type ManagerDashboardOrderStatus = CustomerOrderStatus;

export interface ManagerDashboardMetricsInput {
  readonly activeSeatCount: number;
  readonly attendance: ReadonlyArray<{
    readonly businessOccurredAt: Date;
    readonly outcome: "absent" | "late" | "on-time";
  }>;
  readonly businessDays: ReadonlyArray<{
    readonly endsAt: Date;
    readonly key: string;
    readonly opensAt: Date;
    readonly startsAt: Date;
  }>;
  readonly currentTime: Date;
  readonly handoverExceptions: ReadonlyArray<{
    readonly businessOccurredAt: Date;
  }>;
  readonly inventory: { readonly lowStockCount: number };
  readonly orders: ReadonlyArray<{
    readonly completedAt: Date | null;
    readonly createdAt: Date;
    readonly paidCents: number | null;
    readonly refundCents: number;
    readonly status: ManagerDashboardOrderStatus;
    readonly terminalAt: Date | null;
    readonly wasteCents: number;
    readonly wasteQuantity: number;
  }>;
  readonly repairs: ReadonlyArray<{
    readonly closedAt: Date | null;
    readonly createdAt: Date;
    readonly priority: "high" | "normal" | "urgent";
    readonly processingAt: Date | null;
  }>;
  readonly reservations: ReadonlyArray<{
    readonly completedAt: Date | null;
    readonly paidCents: number;
    readonly priceSegments: ReadonlyArray<{
      readonly amountCents: number;
      readonly endsAt: Date;
      readonly startsAt: Date;
    }>;
    readonly refundCents: number;
    readonly refundFrom: Date | null;
    readonly startedAt: Date | null;
    readonly status:
      | "arrived"
      | "cancelled"
      | "completed"
      | "confirmed"
      | "expired"
      | "in-use"
      | "pending-confirmation";
  }>;
}

interface ManagerDashboardRevenueMetrics {
  readonly orderCents: number;
  readonly reservationCents: number;
  readonly totalCents: number;
}

interface ManagerDashboardSeatMetrics {
  readonly businessSeatMinutes: number;
  readonly maintenanceMinutes: number;
  readonly maintenanceRateBasisPoints: number;
  readonly normalSeatMinutes: number;
  readonly operationalUtilizationBasisPoints: number;
  readonly usedMinutes: number;
}

function overlapMinutes(
  firstStartsAt: Date,
  firstEndsAt: Date,
  secondStartsAt: Date,
  secondEndsAt: Date,
) {
  const startsAt = Math.max(firstStartsAt.getTime(), secondStartsAt.getTime());
  const endsAt = Math.min(firstEndsAt.getTime(), secondEndsAt.getTime());
  return Math.max(0, Math.round((endsAt - startsAt) / 60_000));
}

function basisPoints(numerator: number, denominator: number) {
  return denominator <= 0 ? 0 : Math.round((numerator * 10_000) / denominator);
}

function allocateCentsByWeight(
  totalCents: number,
  weights: ReadonlyArray<number>,
) {
  const weightTotal = weights.reduce((total, value) => total + value, 0);
  if (totalCents <= 0 || weightTotal <= 0) return weights.map(() => 0);
  let allocated = 0;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return totalCents - allocated;
    const value = Math.floor((totalCents * weight) / weightTotal);
    allocated += value;
    return value;
  });
}

export function attributeManagerReservationRevenue(reservation: {
  readonly completedAt: Date | null;
  readonly paidCents: number;
  readonly priceSegments: ReadonlyArray<{
    readonly amountCents: number;
    readonly endsAt: Date;
    readonly startsAt: Date;
  }>;
  readonly refundCents: number;
  readonly refundFrom: Date | null;
  readonly status: ManagerDashboardMetricsInput["reservations"][number]["status"];
}) {
  if (reservation.status !== "completed" || !reservation.completedAt) {
    return [];
  }
  const finalCents = Math.max(
    0,
    reservation.paidCents - reservation.refundCents,
  );
  const retainedSegments = reservation.priceSegments.filter(
    (segment) =>
      reservation.refundFrom === null ||
      segment.startsAt.getTime() < reservation.refundFrom.getTime(),
  );
  const allocations = allocateCentsByWeight(
    finalCents,
    retainedSegments.map((segment) => segment.amountCents),
  );
  return retainedSegments.map((segment, index) => ({
    amountCents: allocations[index] ?? 0,
    businessDayKey: businessDayKey(segment.startsAt),
    endsAt: segment.endsAt,
    startsAt: segment.startsAt,
  }));
}

export function calculateManagerDashboardMetrics(
  input: ManagerDashboardMetricsInput,
) {
  const firstDay = input.businessDays[0];
  const lastDay = input.businessDays[input.businessDays.length - 1];
  if (!firstDay || !lastDay) {
    throw new Error("Manager dashboard metrics require a business-day range.");
  }
  const rangeStartsAt = firstDay.startsAt;
  const rangeEndsAt = new Date(lastDay.startsAt.getTime() + DAY_MS);
  const effectiveRangeEndsAt = new Date(
    Math.min(rangeEndsAt.getTime(), input.currentTime.getTime()),
  );
  const inRange = (value: Date) =>
    value.getTime() >= rangeStartsAt.getTime() &&
    value.getTime() < rangeEndsAt.getTime();

  const revenueByDay = new Map<string, ManagerDashboardRevenueMetrics>(
    input.businessDays.map((day) => [
      day.key,
      { orderCents: 0, reservationCents: 0, totalCents: 0 },
    ]),
  );
  for (const reservation of input.reservations) {
    attributeManagerReservationRevenue(reservation).forEach((segment) => {
      const day = revenueByDay.get(segment.businessDayKey);
      if (!day) return;
      const reservationCents = day.reservationCents + segment.amountCents;
      revenueByDay.set(segment.businessDayKey, {
        ...day,
        reservationCents,
        totalCents: reservationCents + day.orderCents,
      });
    });
  }
  for (const order of input.orders) {
    if (
      order.status !== "completed" ||
      order.paidCents === null ||
      !order.completedAt
    ) {
      continue;
    }
    const key = businessDayKey(order.completedAt);
    const day = revenueByDay.get(key);
    if (!day) continue;
    const orderCents =
      day.orderCents + Math.max(0, order.paidCents - order.refundCents);
    revenueByDay.set(key, {
      ...day,
      orderCents,
      totalCents: day.reservationCents + orderCents,
    });
  }

  const seatMetricsByDay = new Map<string, ManagerDashboardSeatMetrics>();
  for (const day of input.businessDays) {
    const businessMinutes = overlapMinutes(
      day.opensAt,
      day.endsAt,
      day.startsAt,
      new Date(day.startsAt.getTime() + DAY_MS),
    );
    const maintenanceMinutes = input.repairs.reduce((total, repair) => {
      if (!repair.processingAt) return total;
      const repairEndsAt = repair.closedAt ?? input.currentTime;
      return (
        total +
        overlapMinutes(
          repair.processingAt,
          repairEndsAt,
          day.opensAt,
          day.endsAt,
        )
      );
    }, 0);
    const usedMinutes = input.reservations.reduce((total, reservation) => {
      if (!reservation.startedAt) return total;
      const reservationEndsAt =
        reservation.completedAt ??
        (reservation.status === "in-use" ? input.currentTime : null);
      if (!reservationEndsAt) return total;
      return (
        total +
        overlapMinutes(
          reservation.startedAt,
          reservationEndsAt,
          day.opensAt,
          day.endsAt,
        )
      );
    }, 0);
    const businessSeatMinutes = businessMinutes * input.activeSeatCount;
    const normalSeatMinutes = Math.max(
      0,
      businessSeatMinutes - maintenanceMinutes,
    );
    seatMetricsByDay.set(day.key, {
      businessSeatMinutes,
      maintenanceMinutes,
      maintenanceRateBasisPoints: basisPoints(
        maintenanceMinutes,
        businessSeatMinutes,
      ),
      normalSeatMinutes,
      operationalUtilizationBasisPoints: basisPoints(
        usedMinutes,
        normalSeatMinutes,
      ),
      usedMinutes,
    });
  }

  const revenue = [...revenueByDay.values()].reduce(
    (total, day) => ({
      orderCents: total.orderCents + day.orderCents,
      reservationCents: total.reservationCents + day.reservationCents,
      totalCents: total.totalCents + day.totalCents,
    }),
    { orderCents: 0, reservationCents: 0, totalCents: 0 },
  );
  const seatTotals = [...seatMetricsByDay.values()].reduce(
    (total, day) => ({
      businessSeatMinutes: total.businessSeatMinutes + day.businessSeatMinutes,
      maintenanceMinutes: total.maintenanceMinutes + day.maintenanceMinutes,
      normalSeatMinutes: total.normalSeatMinutes + day.normalSeatMinutes,
      usedMinutes: total.usedMinutes + day.usedMinutes,
    }),
    {
      businessSeatMinutes: 0,
      maintenanceMinutes: 0,
      normalSeatMinutes: 0,
      usedMinutes: 0,
    },
  );
  const seats: ManagerDashboardSeatMetrics = {
    ...seatTotals,
    maintenanceRateBasisPoints: basisPoints(
      seatTotals.maintenanceMinutes,
      seatTotals.businessSeatMinutes,
    ),
    operationalUtilizationBasisPoints: basisPoints(
      seatTotals.usedMinutes,
      seatTotals.normalSeatMinutes,
    ),
  };

  const eligibleOrders = input.orders.filter(
    (order) =>
      order.paidCents !== null &&
      order.terminalAt !== null &&
      inRange(order.terminalAt) &&
      (order.status === "cancelled" || order.status === "completed"),
  );
  const completedOrders = eligibleOrders.filter(
    (order) => order.status === "completed",
  );
  const openRepairs = input.repairs.filter(
    (repair) =>
      repair.createdAt.getTime() < effectiveRangeEndsAt.getTime() &&
      (repair.closedAt === null ||
        repair.closedAt.getTime() >= effectiveRangeEndsAt.getTime()),
  );
  const resolutionMinutes = input.repairs
    .flatMap((repair) =>
      repair.closedAt && inRange(repair.closedAt)
        ? [
            Math.round(
              (repair.closedAt.getTime() - repair.createdAt.getTime()) / 60_000,
            ),
          ]
        : [],
    )
    .sort((left, right) => left - right);
  const medianIndex = Math.floor(resolutionMinutes.length / 2);
  const medianResolutionMinutes =
    resolutionMinutes.length === 0
      ? null
      : resolutionMinutes.length % 2 === 1
        ? (resolutionMinutes[medianIndex] ?? 0)
        : Math.round(
            ((resolutionMinutes[medianIndex - 1] ?? 0) +
              (resolutionMinutes[medianIndex] ?? 0)) /
              2,
          );
  const attendance = input.attendance.filter((item) =>
    inRange(item.businessOccurredAt),
  );

  const dailyMetrics = input.businessDays.map((day) => {
    const dayStartsAt = day.startsAt;
    const dayEndsAt = new Date(day.startsAt.getTime() + DAY_MS);
    const effectiveDayEndsAt = new Date(
      Math.min(dayEndsAt.getTime(), input.currentTime.getTime()),
    );
    const inDay = (value: Date) =>
      value.getTime() >= dayStartsAt.getTime() &&
      value.getTime() < dayEndsAt.getTime();
    const eligibleDayOrders = input.orders.filter(
      (order) =>
        order.paidCents !== null &&
        order.terminalAt !== null &&
        inDay(order.terminalAt) &&
        (order.status === "cancelled" || order.status === "completed"),
    );
    const completedDayOrders = eligibleDayOrders.filter(
      (order) => order.status === "completed",
    );
    const openDayRepairs = input.repairs.filter(
      (repair) =>
        repair.createdAt.getTime() < effectiveDayEndsAt.getTime() &&
        (repair.closedAt === null ||
          repair.closedAt.getTime() >= effectiveDayEndsAt.getTime()),
    );
    const dayResolutionMinutes = input.repairs
      .flatMap((repair) =>
        repair.closedAt && inDay(repair.closedAt)
          ? [
              Math.round(
                (repair.closedAt.getTime() - repair.createdAt.getTime()) /
                  60_000,
              ),
            ]
          : [],
      )
      .sort((left, right) => left - right);
    const dayMedianIndex = Math.floor(dayResolutionMinutes.length / 2);
    const dayAttendance = input.attendance.filter((item) =>
      inDay(item.businessOccurredAt),
    );
    const seatsForDay = seatMetricsByDay.get(day.key)!;
    return {
      attendance: {
        absent: dayAttendance.filter((item) => item.outcome === "absent")
          .length,
        late: dayAttendance.filter((item) => item.outcome === "late").length,
        onTime: dayAttendance.filter((item) => item.outcome === "on-time")
          .length,
      },
      handoverExceptionCount: input.handoverExceptions.filter((item) =>
        inDay(item.businessOccurredAt),
      ).length,
      inventory: {
        lowStockCount:
          day.key === businessDayKey(input.currentTime)
            ? input.inventory.lowStockCount
            : null,
      },
      key: day.key,
      orders: {
        backlogCount: input.orders.filter(
          (order) =>
            order.createdAt.getTime() < effectiveDayEndsAt.getTime() &&
            (order.status === "preparing" ||
              order.status === "ready-for-pickup" ||
              order.status === "simulated-paid"),
        ).length,
        completedCount: completedDayOrders.length,
        completionRateBasisPoints: basisPoints(
          completedDayOrders.length,
          eligibleDayOrders.length,
        ),
        eligibleTerminalCount: eligibleDayOrders.length,
        wasteCents: eligibleDayOrders.reduce(
          (total, order) => total + order.wasteCents,
          0,
        ),
        wasteQuantity: eligibleDayOrders.reduce(
          (total, order) => total + order.wasteQuantity,
          0,
        ),
      },
      repairs: {
        maintenanceMinutes: seatsForDay.maintenanceMinutes,
        medianResolutionMinutes:
          dayResolutionMinutes.length === 0
            ? null
            : dayResolutionMinutes.length % 2 === 1
              ? (dayResolutionMinutes[dayMedianIndex] ?? 0)
              : Math.round(
                  ((dayResolutionMinutes[dayMedianIndex - 1] ?? 0) +
                    (dayResolutionMinutes[dayMedianIndex] ?? 0)) /
                    2,
                ),
        openByPriority: {
          high: openDayRepairs.filter((repair) => repair.priority === "high")
            .length,
          normal: openDayRepairs.filter(
            (repair) => repair.priority === "normal",
          ).length,
          urgent: openDayRepairs.filter(
            (repair) => repair.priority === "urgent",
          ).length,
        },
        openCount: openDayRepairs.length,
      },
      revenue: revenueByDay.get(day.key)!,
      seats: seatsForDay,
    };
  });

  return {
    days: dailyMetrics,
    summary: {
      attendance: {
        absent: attendance.filter((item) => item.outcome === "absent").length,
        late: attendance.filter((item) => item.outcome === "late").length,
        onTime: attendance.filter((item) => item.outcome === "on-time").length,
      },
      handoverExceptionCount: input.handoverExceptions.filter((item) =>
        inRange(item.businessOccurredAt),
      ).length,
      inventory: input.inventory,
      orders: {
        backlogCount: input.orders.filter(
          (order) =>
            order.createdAt.getTime() < effectiveRangeEndsAt.getTime() &&
            (order.status === "preparing" ||
              order.status === "ready-for-pickup" ||
              order.status === "simulated-paid"),
        ).length,
        completedCount: completedOrders.length,
        completionRateBasisPoints: basisPoints(
          completedOrders.length,
          eligibleOrders.length,
        ),
        eligibleTerminalCount: eligibleOrders.length,
        wasteCents: eligibleOrders.reduce(
          (total, order) => total + order.wasteCents,
          0,
        ),
        wasteQuantity: eligibleOrders.reduce(
          (total, order) => total + order.wasteQuantity,
          0,
        ),
      },
      repairs: {
        maintenanceMinutes: seats.maintenanceMinutes,
        medianResolutionMinutes,
        openByPriority: {
          high: openRepairs.filter((repair) => repair.priority === "high")
            .length,
          normal: openRepairs.filter((repair) => repair.priority === "normal")
            .length,
          urgent: openRepairs.filter((repair) => repair.priority === "urgent")
            .length,
        },
        openCount: openRepairs.length,
      },
      revenue,
      seats,
    },
  };
}

export type CustomerReservationMode = "future" | "immediate";

export interface StoreBusinessHours {
  readonly closesAt: string;
  readonly closesNextDay: boolean;
  readonly isOpen24Hours: boolean;
  readonly opensAt: string;
}

export type CustomerReservationWindowInvalidReason =
  | "duration"
  | "future-start"
  | "half-hour-alignment"
  | "outside-business-hours"
  | "seven-day-window";

interface ResolveCustomerReservationWindowInput {
  readonly businessHours: StoreBusinessHours;
  readonly durationHours: number;
  readonly mode: CustomerReservationMode;
  readonly now: Date;
  readonly requestedStartsAt?: Date;
}

export type CustomerReservationWindowResult =
  | {
      readonly endsAt: Date;
      readonly startsAt: Date;
      readonly status: "ready";
    }
  | {
      readonly reason: CustomerReservationWindowInvalidReason;
      readonly status: "invalid";
    };

function isInsideBusinessHours(
  startsAt: Date,
  endsAt: Date,
  businessHours: StoreBusinessHours,
): boolean {
  if (businessHours.isOpen24Hours) return true;

  const start = shanghaiDateParts(startsAt);
  const end = shanghaiDateParts(endsAt);
  const startMinutes = start.hour * 60 + start.minute;
  const startSerial = localDaySerial(start);
  const endScalar = localDaySerial(end) * 1_440 + end.hour * 60 + end.minute;
  const opensAt = clockMinutes(businessHours.opensAt);
  const closesAt = clockMinutes(businessHours.closesAt);

  if (businessHours.closesNextDay) {
    const openingDay = startMinutes < closesAt ? startSerial - 1 : startSerial;
    return (
      startSerial * 1_440 + startMinutes >= openingDay * 1_440 + opensAt &&
      endScalar <= (openingDay + 1) * 1_440 + closesAt
    );
  }

  const closingMinutes = closesAt === 0 ? 1_440 : closesAt;
  return (
    startMinutes >= opensAt && endScalar <= startSerial * 1_440 + closingMinutes
  );
}

export function resolveCustomerReservationWindow(
  input: ResolveCustomerReservationWindowInput,
): CustomerReservationWindowResult {
  if (
    !Number.isInteger(input.durationHours) ||
    input.durationHours < 1 ||
    input.durationHours > 8
  ) {
    return { reason: "duration", status: "invalid" };
  }

  const currentSegmentStart = new Date(
    Math.floor(input.now.getTime() / HALF_HOUR_MS) * HALF_HOUR_MS,
  );
  const startsAt =
    input.mode === "immediate" ? currentSegmentStart : input.requestedStartsAt;
  if (
    !startsAt ||
    (input.mode === "future" && startsAt.getTime() <= input.now.getTime())
  ) {
    return { reason: "future-start", status: "invalid" };
  }
  if (startsAt.getTime() % HALF_HOUR_MS !== 0) {
    return { reason: "half-hour-alignment", status: "invalid" };
  }
  if (
    input.mode === "future" &&
    startsAt.getTime() > currentSegmentStart.getTime() + 7 * DAY_MS
  ) {
    return { reason: "seven-day-window", status: "invalid" };
  }

  const endsAt = new Date(startsAt.getTime() + input.durationHours * HOUR_MS);
  if (!isInsideBusinessHours(startsAt, endsAt, input.businessHours)) {
    return { reason: "outside-business-hours", status: "invalid" };
  }
  return { endsAt, startsAt, status: "ready" };
}

export type SeatOperationalStatus = "maintenance" | "normal";
export type SeatAvailability =
  "available" | "in-use" | "maintenance" | "reserved";
export type ReservationAvailabilityStatus =
  "arrived" | "confirmed" | "in-use" | "pending-confirmation";

interface ReservationAvailabilityRange {
  readonly endsAt: Date;
  readonly startsAt: Date;
  readonly status: ReservationAvailabilityStatus;
}

interface DeriveSeatAvailabilityInput {
  readonly endsAt: Date;
  readonly operationalStatus: SeatOperationalStatus;
  readonly reservations: ReadonlyArray<ReservationAvailabilityRange>;
  readonly startsAt: Date;
}

export function deriveSeatAvailability(
  input: DeriveSeatAvailabilityInput,
): SeatAvailability {
  if (input.operationalStatus === "maintenance") return "maintenance";
  const overlapping = input.reservations.filter(
    (reservation) =>
      reservation.startsAt.getTime() < input.endsAt.getTime() &&
      reservation.endsAt.getTime() > input.startsAt.getTime(),
  );
  if (overlapping.some((reservation) => reservation.status === "in-use")) {
    return "in-use";
  }
  return overlapping.length > 0 ? "reserved" : "available";
}

export type ReservationPriceRule =
  "weekday-base" | "weekday-evening" | "weekday-overnight" | "weekend";

export interface ReservationPriceSegment {
  readonly amountCents: number;
  readonly endsAt: Date;
  readonly multiplierBasisPoints: number;
  readonly rule: ReservationPriceRule;
  readonly startsAt: Date;
}

interface PriceReservationWindowInput {
  readonly baseHourlyCents: number;
  readonly endsAt: Date;
  readonly startsAt: Date;
}

export interface ReservationPricePreview {
  readonly segments: ReadonlyArray<ReservationPriceSegment>;
  readonly totalCents: number;
}

export interface PricePlanEffectiveRange {
  readonly effectiveFrom: Date;
  readonly effectiveUntil: Date | null;
}

export interface VersionedPricePlan extends PricePlanEffectiveRange {
  readonly status: "active" | "archived";
  readonly version: number;
}

export function pricePlanEffectiveRangesOverlap(
  left: PricePlanEffectiveRange,
  right: PricePlanEffectiveRange,
): boolean {
  const leftEnd = left.effectiveUntil?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightEnd = right.effectiveUntil?.getTime() ?? Number.POSITIVE_INFINITY;
  return (
    left.effectiveFrom.getTime() < rightEnd &&
    right.effectiveFrom.getTime() < leftEnd
  );
}

export function selectPricePlanVersion<T extends VersionedPricePlan>(
  plans: ReadonlyArray<T>,
  at: Date,
): T | null {
  const atTime = at.getTime();
  return (
    plans
      .filter(
        (plan) =>
          plan.status === "active" &&
          plan.effectiveFrom.getTime() <= atTime &&
          (plan.effectiveUntil === null ||
            plan.effectiveUntil.getTime() > atTime),
      )
      .toSorted(
        (left, right) =>
          right.effectiveFrom.getTime() - left.effectiveFrom.getTime() ||
          right.version - left.version,
      )[0] ?? null
  );
}

interface ExplicitPricePlanWindow {
  readonly endsAt: string;
  readonly endsNextDay: boolean;
  readonly startsAt: string;
  readonly weekdayHalfHourCents: number;
  readonly weekendHalfHourCents: number;
}

export interface ReservationPricePlan extends ExplicitPricePlanWindow {
  readonly baseHourlyCents: number;
  readonly pricingModel: "explicit-half-hour" | "legacy";
}

type PricePlanClockRange = {
  readonly endsAt: string;
  readonly endsNextDay: boolean;
  readonly startsAt: string;
};

function clockRangeIntervals(range: PricePlanClockRange) {
  const startsMinutes = clockMinutes(range.startsAt);
  const endsMinutes = clockMinutes(range.endsAt);
  if (range.endsNextDay) {
    return [
      [startsMinutes, 24 * 60],
      [0, endsMinutes],
    ] as const;
  }
  return [[startsMinutes, endsMinutes]] as const;
}

export function pricePlanClockRangesOverlap(
  left: PricePlanClockRange,
  right: PricePlanClockRange,
): boolean {
  return clockRangeIntervals(left).some(([leftStart, leftEnd]) =>
    clockRangeIntervals(right).some(
      ([rightStart, rightEnd]) => leftStart < rightEnd && rightStart < leftEnd,
    ),
  );
}

function isPriceSegmentInsidePlan(
  segmentStart: Date,
  plan: ExplicitPricePlanWindow,
) {
  const parts = shanghaiDateParts(segmentStart);
  const segmentMinutes = parts.hour * 60 + parts.minute;
  const startsMinutes = clockMinutes(plan.startsAt);
  const endsMinutes = clockMinutes(plan.endsAt);
  if (plan.endsNextDay) {
    return segmentMinutes >= startsMinutes || segmentMinutes < endsMinutes;
  }
  return segmentMinutes >= startsMinutes && segmentMinutes < endsMinutes;
}

export function priceReservationWindowForPlan(input: {
  readonly endsAt: Date;
  readonly plan: ExplicitPricePlanWindow;
  readonly startsAt: Date;
}): ReservationPricePreview {
  const timePattern = /^(?:[01]\d|2[0-3]):(?:00|30)$/u;
  if (
    !Number.isInteger(input.plan.weekdayHalfHourCents) ||
    input.plan.weekdayHalfHourCents < 0 ||
    !Number.isInteger(input.plan.weekendHalfHourCents) ||
    input.plan.weekendHalfHourCents < 0 ||
    !timePattern.test(input.plan.startsAt) ||
    !timePattern.test(input.plan.endsAt) ||
    input.startsAt.getTime() % HALF_HOUR_MS !== 0 ||
    input.endsAt.getTime() <= input.startsAt.getTime() ||
    (input.endsAt.getTime() - input.startsAt.getTime()) % HALF_HOUR_MS !== 0
  ) {
    throw new RangeError(
      "Price-plan windows use aligned half-hours and non-negative integer cents.",
    );
  }

  const segments: ReservationPriceSegment[] = [];
  for (
    let segmentStart = input.startsAt.getTime();
    segmentStart < input.endsAt.getTime();
    segmentStart += HALF_HOUR_MS
  ) {
    const startsAt = new Date(segmentStart);
    if (!isPriceSegmentInsidePlan(startsAt, input.plan)) {
      throw new RangeError("The reservation extends outside the price plan.");
    }
    const businessDay = new Date(`${businessDayKey(startsAt)}T00:00:00.000Z`);
    const dayOfWeek = businessDay.getUTCDay();
    const weekend = dayOfWeek === 0 || dayOfWeek === 6;
    const parts = shanghaiDateParts(startsAt);
    const minutes = parts.hour * 60 + parts.minute;
    const rule: ReservationPriceRule = weekend
      ? "weekend"
      : minutes < 6 * 60
        ? "weekday-overnight"
        : minutes >= 18 * 60
          ? "weekday-evening"
          : "weekday-base";
    segments.push({
      amountCents: weekend
        ? input.plan.weekendHalfHourCents
        : input.plan.weekdayHalfHourCents,
      endsAt: new Date(segmentStart + HALF_HOUR_MS),
      multiplierBasisPoints: 10_000,
      rule,
      startsAt,
    });
  }
  return {
    segments,
    totalCents: segments.reduce(
      (total, segment) => total + segment.amountCents,
      0,
    ),
  };
}

export function priceReservationWindowFromPlans(input: {
  readonly endsAt: Date;
  readonly plans: ReadonlyArray<ReservationPricePlan>;
  readonly startsAt: Date;
}): ReservationPricePreview {
  if (
    input.startsAt.getTime() % HALF_HOUR_MS !== 0 ||
    input.endsAt.getTime() <= input.startsAt.getTime() ||
    (input.endsAt.getTime() - input.startsAt.getTime()) % HALF_HOUR_MS !== 0
  ) {
    throw new RangeError(
      "Reservation price windows use aligned positive half-hours.",
    );
  }

  const segments: ReservationPriceSegment[] = [];
  for (
    let segmentStart = input.startsAt.getTime();
    segmentStart < input.endsAt.getTime();
    segmentStart += HALF_HOUR_MS
  ) {
    const startsAt = new Date(segmentStart);
    const matchingPlans = input.plans.filter((plan) =>
      isPriceSegmentInsidePlan(startsAt, plan),
    );
    if (matchingPlans.length !== 1) {
      throw new RangeError(
        matchingPlans.length === 0
          ? "No price plan covers the reservation segment."
          : "Multiple price plans cover the reservation segment.",
      );
    }
    const plan = matchingPlans[0]!;
    const segmentPreview =
      plan.pricingModel === "explicit-half-hour"
        ? priceReservationWindowForPlan({
            endsAt: new Date(segmentStart + HALF_HOUR_MS),
            plan,
            startsAt,
          })
        : priceReservationWindow({
            baseHourlyCents: plan.baseHourlyCents,
            endsAt: new Date(segmentStart + HALF_HOUR_MS),
            startsAt,
          });
    segments.push(segmentPreview.segments[0]!);
  }

  return {
    segments,
    totalCents: segments.reduce(
      (total, segment) => total + segment.amountCents,
      0,
    ),
  };
}

export function priceReservationWindow(
  input: PriceReservationWindowInput,
): ReservationPricePreview {
  if (
    !Number.isInteger(input.baseHourlyCents) ||
    input.baseHourlyCents < 0 ||
    input.startsAt.getTime() % HALF_HOUR_MS !== 0 ||
    input.endsAt.getTime() <= input.startsAt.getTime() ||
    (input.endsAt.getTime() - input.startsAt.getTime()) % HALF_HOUR_MS !== 0
  ) {
    throw new RangeError(
      "Reservation price windows use aligned half-hours and integer cents.",
    );
  }

  const segments: ReservationPriceSegment[] = [];
  for (
    let segmentStart = input.startsAt.getTime();
    segmentStart < input.endsAt.getTime();
    segmentStart += HALF_HOUR_MS
  ) {
    const startsAt = new Date(segmentStart);
    const parts = shanghaiDateParts(startsAt);
    const dayOfWeek = new Date(
      Date.UTC(parts.year, parts.month - 1, parts.day),
    ).getUTCDay();
    const minutes = parts.hour * 60 + parts.minute;
    const weekend = dayOfWeek === 0 || dayOfWeek === 6;
    const rule: ReservationPriceRule = weekend
      ? "weekend"
      : minutes < 6 * 60
        ? "weekday-overnight"
        : minutes >= 18 * 60
          ? "weekday-evening"
          : "weekday-base";
    const multiplierBasisPoints =
      rule === "weekend"
        ? 11_500
        : rule === "weekday-overnight"
          ? 9_000
          : rule === "weekday-evening"
            ? 12_000
            : 10_000;
    const amountCents = Math.floor(
      (input.baseHourlyCents * multiplierBasisPoints + 10_000) / 20_000,
    );
    segments.push({
      amountCents,
      endsAt: new Date(segmentStart + HALF_HOUR_MS),
      multiplierBasisPoints,
      rule,
      startsAt,
    });
  }
  return {
    segments,
    totalCents: segments.reduce(
      (total, segment) => total + segment.amountCents,
      0,
    ),
  };
}

export type ReservationCouponIneligibleReason =
  | "business-kind"
  | "minimum-spend"
  | "store"
  | "time-window"
  | "unavailable"
  | "validity";

export type MemberTier = "bronze" | "gold" | "silver";

export interface MemberTierProgress {
  readonly growthPoints: number;
  readonly nextThreshold: 500 | 1_500 | null;
  readonly remainingToNext: number;
  readonly tier: MemberTier;
}

export function memberTierForGrowth(growthPoints: number): MemberTierProgress {
  if (!Number.isInteger(growthPoints) || growthPoints < 0) {
    throw new RangeError(
      "Lifetime growth points must be a non-negative integer.",
    );
  }
  if (growthPoints >= 1_500) {
    return {
      growthPoints,
      nextThreshold: null,
      remainingToNext: 0,
      tier: "gold",
    };
  }
  const nextThreshold = growthPoints >= 500 ? 1_500 : 500;
  return {
    growthPoints,
    nextThreshold,
    remainingToNext: nextThreshold - growthPoints,
    tier: growthPoints >= 500 ? "silver" : "bronze",
  };
}

export function applyGrowthAward(
  lifetimeGrowthPoints: number,
  awardedGrowthPoints: number,
): number {
  memberTierForGrowth(lifetimeGrowthPoints);
  if (!Number.isInteger(awardedGrowthPoints) || awardedGrowthPoints < 0) {
    throw new RangeError("Growth awards must be a non-negative integer.");
  }
  return lifetimeGrowthPoints + awardedGrowthPoints;
}

interface ReservationGrowthAwardInput {
  readonly alreadyAwarded: boolean;
  readonly payableCents: number;
  readonly refundedCents: number;
  readonly status: ReservationStatus;
}

export interface ReservationGrowthAward {
  readonly finalSimulatedAmountCents: number;
  readonly growthPoints: number;
}

export function reservationGrowthAward(
  input: ReservationGrowthAwardInput,
): ReservationGrowthAward | null {
  if (
    !Number.isInteger(input.payableCents) ||
    input.payableCents < 0 ||
    !Number.isInteger(input.refundedCents) ||
    input.refundedCents < 0
  ) {
    throw new RangeError("Reservation growth uses non-negative integer cents.");
  }
  if (input.status !== "completed" || input.alreadyAwarded) return null;
  const finalSimulatedAmountCents = Math.max(
    0,
    input.payableCents - input.refundedCents,
  );
  return {
    finalSimulatedAmountCents,
    growthPoints: Math.floor(finalSimulatedAmountCents / 100),
  };
}

export type CustomerOrderStatus =
  | "cancelled"
  | "completed"
  | "expired"
  | "pending-simulated-payment"
  | "preparing"
  | "ready-for-pickup"
  | "simulated-paid";

export type StaffOrderFulfillmentResult =
  | {
      readonly couponEffect: "none" | "restore";
      readonly growthPoints: number;
      readonly inventoryEffect: "release" | "retain" | "sale" | "waste";
      readonly nextStatus: CustomerOrderStatus;
      readonly simulatedRefundCents: number;
      readonly status: "applied";
    }
  | {
      readonly reason: "illegal-transition";
      readonly status: "invalid";
    };

export function decideStaffOrderFulfillment(input: {
  readonly action: "cancel" | "complete" | "mark-ready" | "start-preparing";
  readonly finalSimulatedAmountCents: number;
  readonly status: CustomerOrderStatus;
}): StaffOrderFulfillmentResult {
  if (
    !Number.isInteger(input.finalSimulatedAmountCents) ||
    input.finalSimulatedAmountCents < 0
  ) {
    throw new RangeError(
      "Order fulfillment uses a non-negative integer simulated amount.",
    );
  }
  if (input.action === "start-preparing" && input.status === "simulated-paid") {
    return {
      couponEffect: "none",
      growthPoints: 0,
      inventoryEffect: "retain",
      nextStatus: "preparing",
      simulatedRefundCents: 0,
      status: "applied",
    };
  }
  if (input.action === "mark-ready" && input.status === "preparing") {
    return {
      couponEffect: "none",
      growthPoints: 0,
      inventoryEffect: "retain",
      nextStatus: "ready-for-pickup",
      simulatedRefundCents: 0,
      status: "applied",
    };
  }
  if (input.action === "complete" && input.status === "ready-for-pickup") {
    return {
      couponEffect: "none",
      growthPoints: Math.floor(input.finalSimulatedAmountCents / 100),
      inventoryEffect: "sale",
      nextStatus: "completed",
      simulatedRefundCents: 0,
      status: "applied",
    };
  }
  if (
    input.action === "cancel" &&
    (input.status === "pending-simulated-payment" ||
      input.status === "simulated-paid")
  ) {
    return {
      couponEffect: "restore",
      growthPoints: 0,
      inventoryEffect: "release",
      nextStatus: "cancelled",
      simulatedRefundCents:
        input.status === "simulated-paid" ? input.finalSimulatedAmountCents : 0,
      status: "applied",
    };
  }
  if (
    input.action === "cancel" &&
    (input.status === "preparing" || input.status === "ready-for-pickup")
  ) {
    return {
      couponEffect: "none",
      growthPoints: 0,
      inventoryEffect: "waste",
      nextStatus: "cancelled",
      simulatedRefundCents: input.finalSimulatedAmountCents,
      status: "applied",
    };
  }
  return { reason: "illegal-transition", status: "invalid" };
}

export interface CustomerOrderPricingLineInput {
  readonly availableQuantity: number;
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
}

export type CustomerOrderPricingResult =
  | {
      readonly discountCents: number;
      readonly lines: ReadonlyArray<{
        readonly lineTotalCents: number;
        readonly productId: string;
        readonly productName: string;
        readonly quantity: number;
        readonly unitPriceCents: number;
      }>;
      readonly payableCents: number;
      readonly status: "ready";
      readonly subtotalCents: number;
    }
  | {
      readonly productId?: string;
      readonly reason:
        | "empty-cart"
        | "insufficient-inventory"
        | "invalid-amount"
        | "invalid-quantity";
      readonly status: "invalid";
    };

export function priceCustomerOrder(input: {
  readonly couponDiscountCents: number;
  readonly lines: ReadonlyArray<CustomerOrderPricingLineInput>;
}): CustomerOrderPricingResult {
  if (input.lines.length === 0) {
    return { reason: "empty-cart", status: "invalid" };
  }
  if (
    !Number.isInteger(input.couponDiscountCents) ||
    input.couponDiscountCents < 0
  ) {
    return { reason: "invalid-amount", status: "invalid" };
  }
  for (const line of input.lines) {
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity <= 0 ||
      !Number.isInteger(line.availableQuantity) ||
      line.availableQuantity < 0
    ) {
      return { reason: "invalid-quantity", status: "invalid" };
    }
    if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
      return { reason: "invalid-amount", status: "invalid" };
    }
    if (line.quantity > line.availableQuantity) {
      return {
        productId: line.productId,
        reason: "insufficient-inventory",
        status: "invalid",
      };
    }
  }
  const lines = input.lines.map((line) => ({
    lineTotalCents: line.unitPriceCents * line.quantity,
    productId: line.productId,
    productName: line.productName,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
  }));
  const subtotalCents = lines.reduce(
    (total, line) => total + line.lineTotalCents,
    0,
  );
  const discountCents = Math.min(input.couponDiscountCents, subtotalCents);
  return {
    discountCents,
    lines,
    payableCents: subtotalCents - discountCents,
    status: "ready",
    subtotalCents,
  };
}

export type CustomerOrderLifecycleResult =
  | {
      readonly couponEffect: "redeem" | "release";
      readonly inventoryEffect: "release" | "retain";
      readonly nextStatus: CustomerOrderStatus;
      readonly status: "applied";
    }
  | {
      readonly reason:
        "hold-expired" | "illegal-transition" | "paid-order-independent";
      readonly status: "invalid" | "unchanged";
    };

export function decideCustomerOrderLifecycle(input: {
  readonly action:
    "cancel" | "expire" | "reservation-terminal" | "simulate-payment";
  readonly businessTime: Date;
  readonly holdExpiresAt: Date;
  readonly status: CustomerOrderStatus;
}): CustomerOrderLifecycleResult {
  if (
    input.action === "reservation-terminal" &&
    input.status === "simulated-paid"
  ) {
    return { reason: "paid-order-independent", status: "unchanged" };
  }
  if (input.action === "cancel" && input.status === "simulated-paid") {
    return {
      couponEffect: "release",
      inventoryEffect: "release",
      nextStatus: "cancelled",
      status: "applied",
    };
  }
  if (input.status !== "pending-simulated-payment") {
    return { reason: "illegal-transition", status: "invalid" };
  }
  const holdExpired =
    input.businessTime.getTime() >= input.holdExpiresAt.getTime();
  if (input.action === "expire") {
    if (!holdExpired)
      return { reason: "illegal-transition", status: "invalid" };
    return {
      couponEffect: "release",
      inventoryEffect: "release",
      nextStatus: "expired",
      status: "applied",
    };
  }
  if (input.action === "simulate-payment" && holdExpired) {
    return { reason: "hold-expired", status: "invalid" };
  }
  if (input.action === "reservation-terminal") {
    return {
      couponEffect: "release",
      inventoryEffect: "release",
      nextStatus: "cancelled",
      status: "applied",
    };
  }
  if (input.action === "cancel") {
    return {
      couponEffect: "release",
      inventoryEffect: "release",
      nextStatus: "cancelled",
      status: "applied",
    };
  }
  return {
    couponEffect: "redeem",
    inventoryEffect: "retain",
    nextStatus: "simulated-paid",
    status: "applied",
  };
}

export type ExperienceCouponStatus =
  "available" | "expired" | "redeemed" | "reserved";

export function deriveExperienceCouponStatus(input: {
  readonly now: Date;
  readonly status: ExperienceCouponStatus;
  readonly validUntil: Date;
}): ExperienceCouponStatus {
  if (
    input.status !== "redeemed" &&
    input.now.getTime() >= input.validUntil.getTime()
  ) {
    return "expired";
  }
  return input.status;
}

interface EvaluateReservationCouponInput {
  readonly businessKind: "reservation";
  readonly coupon: {
    readonly businessKind: "order" | "reservation";
    readonly discountCents: number;
    readonly eligibleEndMinutes: number;
    readonly eligibleStartMinutes: number;
    readonly minimumSpendCents: number;
    readonly status: "available" | "expired" | "redeemed" | "reserved";
    readonly storeCode: string | null;
    readonly validFrom: Date;
    readonly validUntil: Date;
  };
  readonly endsAt: Date;
  readonly now: Date;
  readonly startsAt: Date;
  readonly storeCode: string;
  readonly subtotalCents: number;
}

export type ReservationCouponEligibility =
  | {
      readonly discountCents: number;
      readonly payableCents: number;
      readonly status: "eligible";
    }
  | {
      readonly reason: ReservationCouponIneligibleReason;
      readonly status: "ineligible";
    };

export function evaluateReservationCoupon(
  input: EvaluateReservationCouponInput,
): ReservationCouponEligibility {
  if (input.coupon.status !== "available") {
    return { reason: "unavailable", status: "ineligible" };
  }
  if (input.coupon.businessKind !== input.businessKind) {
    return { reason: "business-kind", status: "ineligible" };
  }
  if (
    input.coupon.storeCode !== null &&
    input.coupon.storeCode !== input.storeCode
  ) {
    return { reason: "store", status: "ineligible" };
  }
  if (input.subtotalCents < input.coupon.minimumSpendCents) {
    return { reason: "minimum-spend", status: "ineligible" };
  }
  if (
    input.now.getTime() < input.coupon.validFrom.getTime() ||
    input.now.getTime() >= input.coupon.validUntil.getTime() ||
    input.endsAt.getTime() > input.coupon.validUntil.getTime()
  ) {
    return { reason: "validity", status: "ineligible" };
  }
  const start = shanghaiDateParts(input.startsAt);
  const end = shanghaiDateParts(input.endsAt);
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  const startSerial = localDaySerial(start);
  const endScalar = localDaySerial(end) * 1_440 + endMinutes;
  const allDay =
    input.coupon.eligibleStartMinutes === 0 &&
    input.coupon.eligibleEndMinutes === 24 * 60;
  const insideTimeWindow =
    allDay ||
    (input.coupon.eligibleEndMinutes > input.coupon.eligibleStartMinutes
      ? startMinutes >= input.coupon.eligibleStartMinutes &&
        endScalar <= startSerial * 1_440 + input.coupon.eligibleEndMinutes
      : (() => {
          const openingDay =
            startMinutes < input.coupon.eligibleEndMinutes
              ? startSerial - 1
              : startSerial;
          return (
            startSerial * 1_440 + startMinutes >=
              openingDay * 1_440 + input.coupon.eligibleStartMinutes &&
            endScalar <=
              (openingDay + 1) * 1_440 + input.coupon.eligibleEndMinutes
          );
        })());
  if (!insideTimeWindow) {
    return { reason: "time-window", status: "ineligible" };
  }
  const discountCents = Math.min(
    input.subtotalCents,
    Math.max(0, input.coupon.discountCents),
  );
  return {
    discountCents,
    payableCents: input.subtotalCents - discountCents,
    status: "eligible",
  };
}

export const RESERVATION_STATUSES = [
  "pending-confirmation",
  "confirmed",
  "arrived",
  "in-use",
  "completed",
  "cancelled",
  "expired",
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
export type ReservationLifecycleAction =
  "cancel" | "expire-hold" | "expire-no-show" | "simulate-payment";
export type ReservationCouponEffect = "redeem" | "release" | "restore";

interface DecideReservationLifecycleInput {
  readonly action: ReservationLifecycleAction;
  readonly businessTime: Date;
  readonly hasCoupon: boolean;
  readonly holdExpiresAt: Date | null;
  readonly payableCents: number;
  readonly startsAt: Date;
  readonly status: ReservationStatus;
}

export type ReservationLifecycleDecision =
  | {
      readonly couponEffect: ReservationCouponEffect | null;
      readonly nextStatus: ReservationStatus;
      readonly simulatedPaymentCents: number;
      readonly simulatedRefundCents: number;
      readonly status: "ready";
    }
  | {
      readonly reason:
        | "hold-expired"
        | "illegal-transition"
        | "not-due"
        | "reservation-started";
      readonly status: "invalid";
    };

export function decideReservationLifecycle(
  input: DecideReservationLifecycleInput,
): ReservationLifecycleDecision {
  const couponEffect = (effect: ReservationCouponEffect) =>
    input.hasCoupon ? effect : null;

  if (input.action === "simulate-payment") {
    if (input.status !== "pending-confirmation") {
      return { reason: "illegal-transition", status: "invalid" };
    }
    if (
      !input.holdExpiresAt ||
      input.businessTime.getTime() >= input.holdExpiresAt.getTime()
    ) {
      return { reason: "hold-expired", status: "invalid" };
    }
    return {
      couponEffect: couponEffect("redeem"),
      nextStatus: "confirmed",
      simulatedPaymentCents: input.payableCents,
      simulatedRefundCents: 0,
      status: "ready",
    };
  }

  if (input.action === "expire-hold") {
    if (input.status !== "pending-confirmation") {
      return { reason: "illegal-transition", status: "invalid" };
    }
    if (
      !input.holdExpiresAt ||
      input.businessTime.getTime() < input.holdExpiresAt.getTime()
    ) {
      return { reason: "not-due", status: "invalid" };
    }
    return {
      couponEffect: couponEffect("release"),
      nextStatus: "expired",
      simulatedPaymentCents: 0,
      simulatedRefundCents: 0,
      status: "ready",
    };
  }

  if (input.action === "expire-no-show") {
    if (input.status !== "confirmed") {
      return { reason: "illegal-transition", status: "invalid" };
    }
    if (
      input.businessTime.getTime() <
      input.startsAt.getTime() + 15 * 60 * 1_000
    ) {
      return { reason: "not-due", status: "invalid" };
    }
    return {
      couponEffect: couponEffect("restore"),
      nextStatus: "expired",
      simulatedPaymentCents: 0,
      simulatedRefundCents: input.payableCents,
      status: "ready",
    };
  }

  if (input.status === "pending-confirmation") {
    if (
      !input.holdExpiresAt ||
      input.businessTime.getTime() >= input.holdExpiresAt.getTime()
    ) {
      return { reason: "hold-expired", status: "invalid" };
    }
    return {
      couponEffect: couponEffect("release"),
      nextStatus: "cancelled",
      simulatedPaymentCents: 0,
      simulatedRefundCents: 0,
      status: "ready",
    };
  }
  if (input.status === "confirmed") {
    if (input.businessTime.getTime() >= input.startsAt.getTime()) {
      return { reason: "reservation-started", status: "invalid" };
    }
    return {
      couponEffect: couponEffect("restore"),
      nextStatus: "cancelled",
      simulatedPaymentCents: 0,
      simulatedRefundCents: input.payableCents,
      status: "ready",
    };
  }
  return { reason: "illegal-transition", status: "invalid" };
}

export type FrontlineReservationAction =
  "arrive" | "cancel" | "complete-auto" | "complete-early" | "start-use";

interface DecideFrontlineReservationLifecycleInput {
  readonly action: FrontlineReservationAction;
  readonly businessTime: Date;
  readonly endsAt: Date;
  readonly hasCoupon: boolean;
  readonly holdExpiresAt: Date | null;
  readonly payableCents: number;
  readonly startsAt: Date;
  readonly status: ReservationStatus;
}

export type FrontlineReservationLifecycleDecision =
  | {
      readonly couponEffect: ReservationCouponEffect | null;
      readonly nextStatus: ReservationStatus;
      readonly simulatedRefundCents: number;
      readonly status: "ready";
    }
  | {
      readonly reason:
        | "arrival-window-closed"
        | "arrival-window-not-open"
        | "hold-expired"
        | "illegal-transition"
        | "not-due"
        | "reservation-ended"
        | "reservation-not-started";
      readonly status: "invalid";
    };

export function decideFrontlineReservationLifecycle(
  input: DecideFrontlineReservationLifecycleInput,
): FrontlineReservationLifecycleDecision {
  const now = input.businessTime.getTime();
  const startsAt = input.startsAt.getTime();
  const endsAt = input.endsAt.getTime();
  const couponEffect = (effect: ReservationCouponEffect) =>
    input.hasCoupon ? effect : null;
  const ready = (
    nextStatus: ReservationStatus,
    effect: ReservationCouponEffect | null = null,
    simulatedRefundCents = 0,
  ): FrontlineReservationLifecycleDecision => ({
    couponEffect: effect ? couponEffect(effect) : null,
    nextStatus,
    simulatedRefundCents,
    status: "ready",
  });

  if (input.action === "arrive") {
    if (input.status !== "confirmed") {
      return { reason: "illegal-transition", status: "invalid" };
    }
    if (now < startsAt - 30 * 60 * 1_000) {
      return { reason: "arrival-window-not-open", status: "invalid" };
    }
    if (now >= startsAt + 15 * 60 * 1_000) {
      return { reason: "arrival-window-closed", status: "invalid" };
    }
    return ready("arrived");
  }

  if (input.action === "start-use") {
    if (input.status !== "arrived") {
      return { reason: "illegal-transition", status: "invalid" };
    }
    if (now < startsAt) {
      return { reason: "reservation-not-started", status: "invalid" };
    }
    if (now >= endsAt) {
      return { reason: "reservation-ended", status: "invalid" };
    }
    return ready("in-use");
  }

  if (input.action === "complete-early") {
    if (input.status !== "in-use") {
      return { reason: "illegal-transition", status: "invalid" };
    }
    if (now >= endsAt) {
      return { reason: "reservation-ended", status: "invalid" };
    }
    return ready("completed");
  }

  if (input.action === "complete-auto") {
    if (input.status !== "in-use") {
      return { reason: "illegal-transition", status: "invalid" };
    }
    if (now < endsAt) {
      return { reason: "not-due", status: "invalid" };
    }
    return ready("completed");
  }

  if (input.status === "pending-confirmation") {
    if (!input.holdExpiresAt || now >= input.holdExpiresAt.getTime()) {
      return { reason: "hold-expired", status: "invalid" };
    }
    return ready("cancelled", "release");
  }
  if (input.status === "confirmed" || input.status === "arrived") {
    return ready("cancelled", "restore", input.payableCents);
  }
  return { reason: "illegal-transition", status: "invalid" };
}

export type ShiftScheduleValidationReason =
  "duration" | "half-hour-alignment" | "overlap";

interface ShiftWindow {
  readonly endsAt: Date;
  readonly startsAt: Date;
}

interface ShiftScheduleValidationInput extends ShiftWindow {
  readonly existingWindows: ReadonlyArray<ShiftWindow>;
}

export function validateShiftSchedule(input: ShiftScheduleValidationInput):
  | { readonly status: "valid" }
  | {
      readonly reason: ShiftScheduleValidationReason;
      readonly status: "invalid";
    } {
  const startsAt = input.startsAt.getTime();
  const endsAt = input.endsAt.getTime();
  const isHalfHourAligned = (value: Date) =>
    value.getUTCMinutes() % 30 === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0;

  if (!isHalfHourAligned(input.startsAt) || !isHalfHourAligned(input.endsAt)) {
    return { reason: "half-hour-alignment", status: "invalid" };
  }

  const durationMilliseconds = endsAt - startsAt;
  if (
    durationMilliseconds < 4 * 60 * 60 * 1_000 ||
    durationMilliseconds > 12 * 60 * 60 * 1_000
  ) {
    return { reason: "duration", status: "invalid" };
  }

  if (
    input.existingWindows.some(
      (window) =>
        startsAt < window.endsAt.getTime() &&
        endsAt > window.startsAt.getTime(),
    )
  ) {
    return { reason: "overlap", status: "invalid" };
  }

  return { status: "valid" };
}

export interface StaffCoverageWarning extends ShiftWindow {
  readonly actualStaff: number;
  readonly minimumStaff: number;
}

interface StaffCoverageInput {
  readonly minimumStaff: number;
  readonly range: ShiftWindow;
  readonly shifts: ReadonlyArray<ShiftWindow>;
}

export function evaluateStaffCoverage(
  input: StaffCoverageInput,
): ReadonlyArray<StaffCoverageWarning> {
  const halfHourMilliseconds = 30 * 60 * 1_000;
  const warnings: StaffCoverageWarning[] = [];

  for (
    let startsAt = input.range.startsAt.getTime();
    startsAt < input.range.endsAt.getTime();
    startsAt += halfHourMilliseconds
  ) {
    const endsAt = Math.min(
      startsAt + halfHourMilliseconds,
      input.range.endsAt.getTime(),
    );
    const actualStaff = input.shifts.filter(
      (shift) =>
        startsAt < shift.endsAt.getTime() && endsAt > shift.startsAt.getTime(),
    ).length;
    if (actualStaff >= input.minimumStaff) continue;

    const previous = warnings.at(-1);
    if (
      previous &&
      previous.actualStaff === actualStaff &&
      previous.endsAt.getTime() === startsAt
    ) {
      warnings[warnings.length - 1] = {
        ...previous,
        endsAt: new Date(endsAt),
      };
      continue;
    }
    warnings.push({
      actualStaff,
      endsAt: new Date(endsAt),
      minimumStaff: input.minimumStaff,
      startsAt: new Date(startsAt),
    });
  }

  return warnings;
}

export type AttendanceStatus = "absent" | "checked-in" | "checked-out";
export type AttendanceAction =
  "manual-check-out" | "mark-absent" | "simulated-check-in";
export type AttendanceActionInvalidReason =
  | "already-checked-in"
  | "attendance-finalized"
  | "not-checked-in"
  | "not-due"
  | "shift-ended"
  | "sign-in-window-not-open";

interface AttendanceActionInput extends ShiftWindow {
  readonly action: AttendanceAction;
  readonly businessTime: Date;
  readonly status: AttendanceStatus | null;
}

export function decideAttendanceAction(input: AttendanceActionInput):
  | {
      readonly nextStatus: AttendanceStatus;
      readonly outcome: "late" | "on-time" | null;
      readonly status: "ready";
    }
  | {
      readonly reason: AttendanceActionInvalidReason;
      readonly status: "invalid";
    } {
  const businessTime = input.businessTime.getTime();
  const startsAt = input.startsAt.getTime();
  const endsAt = input.endsAt.getTime();

  if (input.action === "simulated-check-in") {
    if (input.status === "checked-in") {
      return { reason: "already-checked-in", status: "invalid" };
    }
    if (input.status !== null) {
      return { reason: "attendance-finalized", status: "invalid" };
    }
    if (businessTime < startsAt - 30 * 60 * 1_000) {
      return { reason: "sign-in-window-not-open", status: "invalid" };
    }
    if (businessTime >= endsAt) {
      return { reason: "shift-ended", status: "invalid" };
    }
    return {
      nextStatus: "checked-in",
      outcome: businessTime > startsAt ? "late" : "on-time",
      status: "ready",
    };
  }

  if (input.action === "manual-check-out") {
    if (input.status !== "checked-in") {
      return {
        reason:
          input.status === null ? "not-checked-in" : "attendance-finalized",
        status: "invalid",
      };
    }
    return { nextStatus: "checked-out", outcome: null, status: "ready" };
  }

  if (input.status === "checked-in") {
    return { reason: "already-checked-in", status: "invalid" };
  }
  if (input.status !== null) {
    return { reason: "attendance-finalized", status: "invalid" };
  }
  if (businessTime < endsAt) {
    return { reason: "not-due", status: "invalid" };
  }
  return { nextStatus: "absent", outcome: null, status: "ready" };
}

export type SandboxBusinessTimeAdvanceMode = "next-event" | "half-hour";

interface SandboxBusinessTimeInput {
  readonly advancedMilliseconds: number;
  readonly businessAnchor: Date;
  readonly wallAnchor: Date;
  readonly wallTime: Date;
}

interface SandboxBusinessTimeAdvanceInput {
  readonly accumulatedAdvanceMilliseconds: number;
  readonly currentBusinessTime: Date;
  readonly mode: SandboxBusinessTimeAdvanceMode;
  readonly nextEventTime: Date | null;
}

export function sandboxBusinessTimeAt({
  advancedMilliseconds,
  businessAnchor,
  wallAnchor,
  wallTime,
}: SandboxBusinessTimeInput): Date {
  return new Date(
    businessAnchor.getTime() +
      (wallTime.getTime() - wallAnchor.getTime()) +
      advancedMilliseconds,
  );
}

export function planSandboxBusinessTimeAdvance(
  input: SandboxBusinessTimeAdvanceInput,
):
  | {
      readonly status: "ready";
      readonly accumulatedAdvanceMilliseconds: number;
      readonly advanceByMilliseconds: number;
      readonly afterBusinessTime: Date;
    }
  | { readonly status: "limit-reached"; readonly limitMilliseconds: number }
  | { readonly status: "no-next-event" } {
  const advanceByMilliseconds =
    input.mode === "half-hour"
      ? 30 * 60 * 1_000
      : (input.nextEventTime?.getTime() ?? 0) -
        input.currentBusinessTime.getTime();

  if (input.mode === "next-event" && advanceByMilliseconds <= 0) {
    return { status: "no-next-event" };
  }

  const accumulatedAdvanceMilliseconds =
    input.accumulatedAdvanceMilliseconds + advanceByMilliseconds;
  if (accumulatedAdvanceMilliseconds > SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS) {
    return {
      limitMilliseconds: SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS,
      status: "limit-reached",
    };
  }

  return {
    accumulatedAdvanceMilliseconds,
    advanceByMilliseconds,
    afterBusinessTime: new Date(
      input.currentBusinessTime.getTime() + advanceByMilliseconds,
    ),
    status: "ready",
  };
}

type PublicSandboxRole = "customer" | "staff" | "manager" | "hq";

export type MachineProfileCode = "competitive" | "flagship" | "standard";

interface MachineProfileSeed {
  readonly code: MachineProfileCode;
  readonly displayName: string;
  readonly experienceDescription: string;
}

interface StoreAreaSeed {
  readonly code: string;
  readonly displayName: string;
  readonly machineProfileSeatCounts: Readonly<
    Record<MachineProfileCode, number>
  >;
  readonly seatCount: number;
}

interface PublicSandboxStoreSeed {
  readonly areas: ReadonlyArray<StoreAreaSeed>;
  readonly baseHourlyCents: Readonly<Record<MachineProfileCode, number>>;
  readonly code: string;
  readonly displayName: string;
  readonly fictitiousCity: string;
  readonly introduction: string;
  readonly seatCount: number;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly closesNextDay: boolean;
  readonly isOpen24Hours: boolean;
  readonly machineProfileSeatCounts: Readonly<
    Record<MachineProfileCode, number>
  >;
}

interface PublicSandboxPersonaSeed {
  readonly role: PublicSandboxRole;
  readonly displayName: string;
  readonly employeeCode?: string;
  readonly scope: string;
  readonly protected: true;
  readonly storeCode?: PublicSandboxStoreSeed["code"];
}

interface PublicSandboxEmployeeSeed {
  readonly displayName: string;
  readonly employeeCode: string;
  readonly protected: boolean;
  readonly role: "manager" | "staff";
  readonly storeCode: PublicSandboxStoreSeed["code"];
}

export interface PublicSandboxSeed {
  readonly schemaVersion: string;
  readonly seedVersion: string;
  readonly operator: {
    readonly displayName: string;
    readonly city: string;
  };
  readonly machineProfiles: ReadonlyArray<MachineProfileSeed>;
  readonly stores: ReadonlyArray<PublicSandboxStoreSeed>;
  readonly personas: ReadonlyArray<PublicSandboxPersonaSeed>;
  readonly employees: ReadonlyArray<PublicSandboxEmployeeSeed>;
}

const machineProfileSeeds = [
  {
    code: "standard",
    displayName: "标准型",
    experienceDescription: "1080p / 144Hz",
  },
  {
    code: "competitive",
    displayName: "竞技型",
    experienceDescription: "2K / 180Hz",
  },
  {
    code: "flagship",
    displayName: "旗舰型",
    experienceDescription: "2K / 240Hz",
  },
] as const satisfies ReadonlyArray<MachineProfileSeed>;

const storeSeeds = [
  {
    areas: [
      {
        code: "competitive-a",
        displayName: "竞技区 A",
        machineProfileSeatCounts: { competitive: 16, flagship: 4, standard: 4 },
        seatCount: 24,
      },
      {
        code: "competitive-b",
        displayName: "竞技区 B",
        machineProfileSeatCounts: { competitive: 16, flagship: 4, standard: 4 },
        seatCount: 24,
      },
      {
        code: "standard-zone",
        displayName: "标准区",
        machineProfileSeatCounts: { competitive: 0, flagship: 0, standard: 24 },
        seatCount: 24,
      },
      {
        code: "immersion-zone",
        displayName: "沉浸区",
        machineProfileSeatCounts: { competitive: 8, flagship: 8, standard: 8 },
        seatCount: 24,
      },
    ],
    baseHourlyCents: {
      competitive: 1_500,
      flagship: 2_200,
      standard: 1_000,
    },
    code: "prism-flagship",
    displayName: "棱镜旗舰店",
    fictitiousCity: "栖光市（虚构）",
    introduction:
      "96 座、24 小时运营的主演示门店，用于展示跨角色预约、订单与维修联动。",
    seatCount: 96,
    opensAt: "00:00",
    closesAt: "00:00",
    closesNextDay: false,
    isOpen24Hours: true,
    machineProfileSeatCounts: {
      competitive: 40,
      flagship: 16,
      standard: 40,
    },
  },
  {
    areas: [
      {
        code: "front-hall",
        displayName: "星桥前厅",
        machineProfileSeatCounts: { competitive: 0, flagship: 4, standard: 20 },
        seatCount: 24,
      },
      {
        code: "competitive-lane",
        displayName: "竞技长廊",
        machineProfileSeatCounts: { competitive: 24, flagship: 0, standard: 0 },
        seatCount: 24,
      },
      {
        code: "quiet-zone",
        displayName: "静音区",
        machineProfileSeatCounts: { competitive: 0, flagship: 4, standard: 12 },
        seatCount: 16,
      },
    ],
    baseHourlyCents: {
      competitive: 1_200,
      flagship: 1_800,
      standard: 800,
    },
    code: "starbridge-standard",
    displayName: "星桥标准店",
    fictitiousCity: "栖光市（虚构）",
    introduction: "64 座跨午夜营业的固定虚构门店，用于展示标准门店经营。",
    seatCount: 64,
    opensAt: "10:00",
    closesAt: "02:00",
    closesNextDay: true,
    isOpen24Hours: false,
    machineProfileSeatCounts: {
      competitive: 24,
      flagship: 8,
      standard: 32,
    },
  },
  {
    areas: [
      {
        code: "arrival-hall",
        displayName: "跃点大厅",
        machineProfileSeatCounts: { competitive: 0, flagship: 0, standard: 16 },
        seatCount: 16,
      },
      {
        code: "competitive-zone",
        displayName: "竞速区",
        machineProfileSeatCounts: { competitive: 12, flagship: 0, standard: 0 },
        seatCount: 12,
      },
      {
        code: "immersion-zone",
        displayName: "沉浸区",
        machineProfileSeatCounts: { competitive: 0, flagship: 4, standard: 8 },
        seatCount: 12,
      },
    ],
    baseHourlyCents: {
      competitive: 1_000,
      flagship: 1_500,
      standard: 700,
    },
    code: "apex-new",
    displayName: "极点新店",
    fictitiousCity: "栖光市（虚构）",
    introduction: "40 座日间营业的固定虚构新店，用于展示成长阶段经营。",
    seatCount: 40,
    opensAt: "12:00",
    closesAt: "00:00",
    closesNextDay: false,
    isOpen24Hours: false,
    machineProfileSeatCounts: {
      competitive: 12,
      flagship: 4,
      standard: 24,
    },
  },
] as const satisfies ReadonlyArray<PublicSandboxStoreSeed>;

const employeeSeeds = [
  {
    displayName: "周宁",
    employeeCode: "PRISM-S001",
    protected: true,
    role: "staff",
    storeCode: "prism-flagship",
  },
  ...[
    "陈昊",
    "苏雨",
    "赵一航",
    "陆远",
    "顾辰",
    "韩青",
    "罗檬",
    "叶舟",
    "程野",
    "乔月",
    "唐宁",
    "林筱",
    "夏知",
  ].map((displayName, index) => ({
    displayName,
    employeeCode: `PRISM-S${String(index + 2).padStart(3, "0")}`,
    protected: false,
    role: "staff" as const,
    storeCode: "prism-flagship",
  })),
  {
    displayName: "许知远",
    employeeCode: "PRISM-M001",
    protected: true,
    role: "manager",
    storeCode: "prism-flagship",
  },
  {
    displayName: "周岚",
    employeeCode: "PRISM-M002",
    protected: false,
    role: "manager",
    storeCode: "prism-flagship",
  },
  ...[
    "方屿",
    "宋禾",
    "岳然",
    "彭越",
    "杜衡",
    "安夏",
    "江临",
    "余秋",
    "温然",
  ].map((displayName, index) => ({
    displayName,
    employeeCode: `STAR-S${String(index + 1).padStart(3, "0")}`,
    protected: false,
    role: "staff" as const,
    storeCode: "starbridge-standard",
  })),
  {
    displayName: "沈嘉",
    employeeCode: "STAR-M001",
    protected: false,
    role: "manager",
    storeCode: "starbridge-standard",
  },
  ...["顾言", "宁川", "沈星", "江澄", "白露", "夏至"].map(
    (displayName, index) => ({
      displayName,
      employeeCode: `APEX-S${String(index + 1).padStart(3, "0")}`,
      protected: false,
      role: "staff" as const,
      storeCode: "apex-new",
    }),
  ),
  {
    displayName: "楚云",
    employeeCode: "APEX-M001",
    protected: false,
    role: "manager",
    storeCode: "apex-new",
  },
] as const satisfies ReadonlyArray<PublicSandboxEmployeeSeed>;

const personaSeeds = [
  {
    role: "customer",
    displayName: "林澈",
    scope: "浏览三店 · 只管理自己的记录",
    protected: true,
  },
  {
    role: "staff",
    displayName: "周宁",
    employeeCode: "PRISM-S001",
    scope: "棱镜旗舰店",
    protected: true,
    storeCode: "prism-flagship",
  },
  {
    role: "manager",
    displayName: "许知远",
    employeeCode: "PRISM-M001",
    scope: "棱镜旗舰店",
    protected: true,
    storeCode: "prism-flagship",
  },
  {
    role: "hq",
    displayName: "沈微",
    scope: "固定三店",
    protected: true,
  },
] as const satisfies ReadonlyArray<PublicSandboxPersonaSeed>;

export function buildPublicSandboxSeed(): PublicSandboxSeed {
  return {
    schemaVersion: PUBLIC_SANDBOX_SCHEMA_VERSION,
    seedVersion: PUBLIC_SANDBOX_SEED_VERSION,
    operator: {
      displayName: "竞枢演示经营方",
      city: "栖光市",
    },
    machineProfiles: machineProfileSeeds.map((profile) => ({ ...profile })),
    stores: storeSeeds.map((store) => ({
      ...store,
      areas: store.areas.map((area) => ({
        ...area,
        machineProfileSeatCounts: { ...area.machineProfileSeatCounts },
      })),
      baseHourlyCents: { ...store.baseHourlyCents },
      machineProfileSeatCounts: { ...store.machineProfileSeatCounts },
    })),
    personas: personaSeeds.map((persona) => ({ ...persona })),
    employees: employeeSeeds.map((employee) => ({ ...employee })),
  };
}
