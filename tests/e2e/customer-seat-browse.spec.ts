import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import type {
  CustomerMachineProfileCode,
  CustomerPendingReservationResponse,
  CustomerReservationDetailResponse,
  CustomerReservationStatus,
  CustomerSeatAvailabilityResponse,
  CustomerStoreCatalogResponse,
  RoleContextReadyResponse,
} from "@jingshu/contracts";

const businessTime = "2026-08-10T11:47:23.000Z";

const customerContext: RoleContextReadyResponse = {
  capabilities: ["customer:manage-own-records"],
  contextVersion: 1,
  csrfToken: "csrf-customer-ticket-06-token-value",
  freshness: {
    mode: "manual",
    observedAt: new Date().toISOString(),
  },
  persona: { displayName: "林澈", protected: true },
  role: { id: "customer", label: "顾客" },
  sandbox: {
    businessClock: {
      advanceLimitMilliseconds: 86_400_000,
      advancedMilliseconds: 0,
      currentTime: businessTime,
      remainingAdvanceMilliseconds: 86_400_000,
      timeZone: "Asia/Shanghai",
    },
    expiresAt: "2026-08-11T11:47:23.000Z",
    schemaVersion: "8",
    seedVersion: "2026-08-10.3",
  },
  status: "ready",
  storeScope: {
    kind: "customer",
    label: "浏览三店 · 只管理自己的记录",
    stores: [
      { code: "prism-flagship", displayName: "棱镜旗舰店" },
      { code: "starbridge-standard", displayName: "星桥标准店" },
      { code: "apex-new", displayName: "极点新店" },
    ],
  },
};

const catalog: CustomerStoreCatalogResponse = {
  bookingRules: {
    durationHours: { maximum: 8, minimum: 1 },
    futureDays: 7,
    halfHourAligned: true,
    immediateUsesCurrentSegment: true,
  },
  city: "栖光市",
  currentTime: businessTime,
  status: "ready",
  stores: [
    {
      areas: [
        { code: "competitive-a", displayName: "竞技区 A", seatCount: 24 },
        { code: "competitive-b", displayName: "竞技区 B", seatCount: 24 },
        { code: "standard-zone", displayName: "标准区", seatCount: 24 },
        { code: "immersion-zone", displayName: "沉浸区", seatCount: 24 },
      ],
      businessHours: "24 小时",
      closesAt: "06:00",
      closesNextDay: true,
      code: "prism-flagship",
      displayName: "棱镜旗舰店",
      isOpen24Hours: true,
      machineProfiles: [
        {
          baseHourlyCents: 1_000,
          code: "standard",
          displayName: "标准型",
          experienceDescription: "稳定畅玩主流电竞项目",
          seatCount: 40,
        },
        {
          baseHourlyCents: 1_500,
          code: "competitive",
          displayName: "竞技型",
          experienceDescription: "高刷竞技与低延迟外设",
          seatCount: 40,
        },
        {
          baseHourlyCents: 2_200,
          code: "flagship",
          displayName: "旗舰型",
          experienceDescription: "沉浸画质与旗舰级设备",
          seatCount: 16,
        },
      ],
      opensAt: "06:00",
      seatCount: 96,
    },
    {
      areas: [
        { code: "front-hall", displayName: "前厅区", seatCount: 24 },
        { code: "competitive-lane", displayName: "竞技长廊", seatCount: 24 },
        { code: "quiet-zone", displayName: "安静区", seatCount: 16 },
      ],
      businessHours: "10:00–次日 02:00",
      closesAt: "02:00",
      closesNextDay: true,
      code: "starbridge-standard",
      displayName: "星桥标准店",
      isOpen24Hours: false,
      machineProfiles: [
        {
          baseHourlyCents: 800,
          code: "standard",
          displayName: "标准型",
          experienceDescription: "稳定畅玩主流电竞项目",
          seatCount: 32,
        },
        {
          baseHourlyCents: 1_200,
          code: "competitive",
          displayName: "竞技型",
          experienceDescription: "高刷竞技与低延迟外设",
          seatCount: 24,
        },
        {
          baseHourlyCents: 1_800,
          code: "flagship",
          displayName: "旗舰型",
          experienceDescription: "沉浸画质与旗舰级设备",
          seatCount: 8,
        },
      ],
      opensAt: "10:00",
      seatCount: 64,
    },
    {
      areas: [
        { code: "arrival-hall", displayName: "新锐前厅", seatCount: 16 },
        { code: "competitive-zone", displayName: "竞技区", seatCount: 12 },
        { code: "immersion-zone", displayName: "沉浸区", seatCount: 12 },
      ],
      businessHours: "12:00–24:00",
      closesAt: "24:00",
      closesNextDay: false,
      code: "apex-new",
      displayName: "极点新店",
      isOpen24Hours: false,
      machineProfiles: [
        {
          baseHourlyCents: 700,
          code: "standard",
          displayName: "标准型",
          experienceDescription: "稳定畅玩主流电竞项目",
          seatCount: 24,
        },
        {
          baseHourlyCents: 1_000,
          code: "competitive",
          displayName: "竞技型",
          experienceDescription: "高刷竞技与低延迟外设",
          seatCount: 12,
        },
        {
          baseHourlyCents: 1_500,
          code: "flagship",
          displayName: "旗舰型",
          experienceDescription: "沉浸画质与旗舰级设备",
          seatCount: 4,
        },
      ],
      opensAt: "12:00",
      seatCount: 40,
    },
  ],
};

function availabilityFor(url: string): CustomerSeatAvailabilityResponse {
  const query = new URL(url).searchParams;
  const areaCode = query.get("area") ?? "competitive-a";
  const storeCode = query.get("store") ?? "prism-flagship";
  const machineCode = (query.get("machine") ??
    "competitive") as CustomerMachineProfileCode;
  const mode = query.get("mode") === "future" ? "future" : "immediate";
  const start =
    mode === "future"
      ? (query.get("start") ?? "2026-08-10T12:00:00.000Z")
      : "2026-08-10T11:30:00.000Z";
  const durationHours = Number(query.get("durationHours") ?? "2");
  const prefix = areaCode === "competitive-b" ? "B" : "A";
  const store = catalog.stores.find((item) => item.code === storeCode)!;
  const machineProfile = store.machineProfiles.find(
    (profile) => profile.code === machineCode,
  )!;
  const area = store.areas.find((item) => item.code === areaCode)!;
  const segmentCount = durationHours * 2;
  const startsAt = Date.parse(start);

  return {
    area: { code: areaCode, displayName: area.displayName },
    coupons: [
      {
        code: "reservation-six",
        discountCents: 600,
        displayName: "预约立减体验券",
        eligibility: {
          discountCents: 600,
          payableCents: Math.max(
            0,
            Math.round(machineProfile.baseHourlyCents * durationHours * 1.2) -
              600,
          ),
          status: "eligible",
        },
        id: "00000000-0000-4000-8000-000000000701",
        minimumSpendCents: 2_000,
        validUntil: "2026-08-31T00:00:00.000Z",
      },
      {
        code: "reservation-premium",
        discountCents: 1_000,
        displayName: "高额预约体验券",
        eligibility: { reason: "minimum-spend", status: "ineligible" },
        id: "00000000-0000-4000-8000-000000000702",
        minimumSpendCents: 5_000,
        validUntil: "2026-08-31T00:00:00.000Z",
      },
      {
        code: "reservation-zero",
        discountCents: 3_600,
        displayName: "零元应付体验券",
        eligibility: {
          discountCents: Math.round(
            machineProfile.baseHourlyCents * durationHours * 1.2,
          ),
          payableCents: 0,
          status: "eligible",
        },
        id: "00000000-0000-4000-8000-000000000703",
        minimumSpendCents: 0,
        validUntil: "2026-08-31T00:00:00.000Z",
      },
    ],
    machineProfile: {
      code: machineCode,
      displayName: machineProfile.displayName,
      experienceDescription: machineProfile.experienceDescription,
    },
    price: {
      baseHourlyCents: machineProfile.baseHourlyCents,
      segments: Array.from({ length: segmentCount }, (_, index) => ({
        amountCents: Math.round(machineProfile.baseHourlyCents * 0.6),
        endsAt: new Date(startsAt + (index + 1) * 30 * 60_000).toISOString(),
        multiplierBasisPoints: 12_000,
        rule: "weekday-evening" as const,
        startsAt: new Date(startsAt + index * 30 * 60_000).toISOString(),
      })),
      totalCents: Math.round(
        machineProfile.baseHourlyCents * durationHours * 1.2,
      ),
    },
    seats: Array.from({ length: 12 }, (_, index) => {
      const seatNumber = index + 1;
      const availability =
        seatNumber === 6
          ? "reserved"
          : seatNumber === 7
            ? "in-use"
            : seatNumber === 9
              ? "maintenance"
              : "available";
      return {
        availability,
        code: `${prefix}-${String(seatNumber).padStart(2, "0")}`,
        operationalStatus:
          availability === "maintenance" ? "maintenance" : "normal",
      } as const;
    }),
    status: "ready",
    store: { code: store.code, displayName: store.displayName },
    window: {
      endsAt: new Date(startsAt + durationHours * 60 * 60_000).toISOString(),
      mode,
      startsAt: new Date(startsAt).toISOString(),
    },
  };
}

async function serveJson(route: Route, json: unknown) {
  await route.fulfill({ json, status: 200 });
}

async function openCustomerH5(
  page: Page,
  options: {
    conflict?: boolean;
    detailStatuses?: ReadonlyArray<CustomerReservationStatus>;
    paymentFailures?: number;
    transformAvailability?: (
      value: CustomerSeatAvailabilityResponse,
    ) => CustomerSeatAvailabilityResponse;
  } = {},
) {
  let lifecycleStatus: CustomerReservationStatus =
    options.detailStatuses?.[0] ?? "pending-confirmation";
  let detailStatusIndex = 0;
  let remainingPaymentFailures = options.paymentFailures ?? 0;
  let activeSnapshot: CustomerPendingReservationResponse["snapshot"] | null =
    null;
  let paymentOccurredAt: string | null = null;
  let refundOccurredAt: string | null = null;
  const timeline: CustomerReservationDetailResponse["timeline"] extends ReadonlyArray<
    infer Event
  >
    ? Event[]
    : never = [];
  await page.route("**/api/v1/demo/context", (route) =>
    serveJson(route, customerContext),
  );
  await page.route("**/api/v1/customer/stores", (route) =>
    serveJson(route, catalog),
  );
  await page.route("**/api/v1/customer/seat-availability?**", (route) => {
    const value = availabilityFor(route.request().url());
    return serveJson(
      route,
      options.transformAvailability
        ? options.transformAvailability(value)
        : value,
    );
  });
  await page.route("**/api/v1/customer/reservations", async (route) => {
    if (options.conflict) {
      await route.fulfill({
        json: {
          error: {
            code: "CUSTOMER_RESERVATION_SEAT_CONFLICT",
            message: "该座位刚刚被其他预约占用，请返回重新选座。",
            requestId: "00000000-0000-4000-8000-000000000707",
          },
        },
        status: 409,
      });
      return;
    }
    const body = route.request().postDataJSON() as {
      couponId: string | null;
      seatCode: string;
    };
    const preview = options.transformAvailability
      ? options.transformAvailability(
          availabilityFor(
            "http://localhost/api?area=competitive-a&durationHours=2&machine=competitive&mode=immediate&store=prism-flagship",
          ),
        )
      : availabilityFor(
          "http://localhost/api?area=competitive-a&durationHours=2&machine=competitive&mode=immediate&store=prism-flagship",
        );
    const coupon =
      preview.coupons.find((item) => item.id === body.couponId) ?? null;
    const discountCents =
      coupon?.eligibility.status === "eligible"
        ? coupon.eligibility.discountCents
        : 0;
    const snapshot: CustomerPendingReservationResponse["snapshot"] = {
      area: preview.area,
      coupon: coupon
        ? {
            code: coupon.code,
            discountCents,
            displayName: coupon.displayName,
          }
        : null,
      machineProfile: preview.machineProfile,
      price: {
        discountCents,
        payableCents: preview.price.totalCents - discountCents,
        segments: preview.price.segments,
        subtotalCents: preview.price.totalCents,
      },
      seat: { code: body.seatCode },
      store: preview.store,
      window: {
        endsAt: preview.window.endsAt,
        startsAt: preview.window.startsAt,
      },
    };
    activeSnapshot = snapshot;
    lifecycleStatus = options.detailStatuses?.[0] ?? "pending-confirmation";
    detailStatusIndex = 0;
    timeline.splice(0, timeline.length, {
      data: { holdExpiresAt: "2026-08-10T11:57:23.000Z" },
      occurredAt: businessTime,
      type: "reservation.pending-created",
    });
    await route.fulfill({
      json: {
        holdExpiresAt: "2026-08-10T11:57:23.000Z",
        replayed: false,
        reservationId: "00000000-0000-4000-8000-000000000708",
        snapshot,
        status: "pending-confirmation",
      },
      status: 201,
    });
  });
  await page.route(
    /\/api\/v1\/customer\/reservations\/[^/]+$/u,
    async (route) => {
      const snapshot = activeSnapshot;
      if (!snapshot) {
        await route.fulfill({ status: 404 });
        return;
      }
      const sequenceStatus = options.detailStatuses?.[detailStatusIndex];
      if (sequenceStatus) {
        lifecycleStatus = sequenceStatus;
        detailStatusIndex = Math.min(
          detailStatusIndex + 1,
          (options.detailStatuses?.length ?? 1) - 1,
        );
      }
      const terminal = ["cancelled", "completed", "expired"].includes(
        lifecycleStatus,
      );
      const canCancel =
        lifecycleStatus === "pending-confirmation" ||
        lifecycleStatus === "confirmed";
      const detail: CustomerReservationDetailResponse = {
        actions: {
          canCancel,
          canSimulatePayment: lifecycleStatus === "pending-confirmation",
        },
        arrivalWindow: {
          closesAt: "2026-08-10T12:45:00.000Z",
          opensAt: "2026-08-10T12:00:00.000Z",
        },
        cancelledAt: lifecycleStatus === "cancelled" ? refundOccurredAt : null,
        confirmedAt: paymentOccurredAt,
        coupon: snapshot.coupon
          ? {
              ...snapshot.coupon,
              status:
                lifecycleStatus === "cancelled" || lifecycleStatus === "expired"
                  ? "available"
                  : lifecycleStatus === "pending-confirmation"
                    ? "reserved"
                    : "redeemed",
            }
          : null,
        currentTime: businessTime,
        expiredAt: lifecycleStatus === "expired" ? businessTime : null,
        holdExpiresAt: "2026-08-10T11:57:23.000Z",
        payment: paymentOccurredAt
          ? {
              amountCents: snapshot.price.payableCents,
              occurredAt: paymentOccurredAt,
              simulated: true,
            }
          : null,
        refund: refundOccurredAt
          ? {
              amountCents: snapshot.price.payableCents,
              occurredAt: refundOccurredAt,
              reason: "customer-cancelled-before-start",
              simulated: true,
            }
          : null,
        related: { orders: [], repairs: [] },
        reservationId: "00000000-0000-4000-8000-000000000708",
        snapshot,
        status: lifecycleStatus,
        terminalReason: terminal ? "演示终态" : null,
        timeline,
      };
      await serveJson(route, detail);
    },
  );
  await page.route(
    "**/api/v1/customer/reservations/*/simulated-payment",
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (remainingPaymentFailures > 0) {
        remainingPaymentFailures -= 1;
        await route.fulfill({
          json: {
            error: {
              code: "CUSTOMER_RESERVATION_PAYMENT_FAILED",
              message: "模拟支付未完成；不会扣款，可使用原提交标识安全重试。",
              requestId: crypto.randomUUID(),
            },
          },
          status: 503,
        });
        return;
      }
      lifecycleStatus = "confirmed";
      paymentOccurredAt = "2026-08-10T11:48:00.000Z";
      timeline.push({
        data: { doesNotCharge: true },
        occurredAt: paymentOccurredAt,
        type: "reservation.simulated-payment-succeeded",
      });
      await route.fulfill({
        json: {
          notice: "模拟支付，不会扣款，也不需要真实支付凭证。",
          payment: {
            amountCents: activeSnapshot?.price.payableCents ?? 0,
            occurredAt: paymentOccurredAt,
            simulated: true,
          },
          replayed: false,
          reservationId: "00000000-0000-4000-8000-000000000708",
          status: "confirmed",
        },
        status: 200,
      });
    },
  );
  await page.route(
    "**/api/v1/customer/reservations/*/cancel",
    async (route) => {
      const body = route.request().postDataJSON() as { reason: string };
      lifecycleStatus = "cancelled";
      refundOccurredAt = "2026-08-10T11:49:00.000Z";
      timeline.push({
        data: { reason: body.reason },
        occurredAt: refundOccurredAt,
        type: "reservation.cancelled",
      });
      await route.fulfill({
        json: {
          cancelledAt: refundOccurredAt,
          couponRestored: true,
          refund: {
            amountCents: activeSnapshot?.price.payableCents ?? 0,
            occurredAt: refundOccurredAt,
            reason: "customer-cancelled-before-start",
            simulated: true,
          },
          replayed: false,
          reservationId: "00000000-0000-4000-8000-000000000708",
          status: "cancelled",
        },
        status: 200,
      });
    },
  );
  await page.goto("/");
  await expect(page.getByTestId("customer-h5")).toBeVisible();
}

test("mobile customer can browse three stores and inspect server-derived seats and prices", async ({
  page,
}) => {
  await page.setViewportSize({ height: 852, width: 393 });
  await openCustomerH5(page);

  await expect(page.getByRole("heading", { name: "三店浏览" })).toBeVisible();
  await expect(page.getByText("棱镜旗舰店", { exact: true })).toBeVisible();
  await expect(page.getByText("星桥标准店", { exact: true })).toBeVisible();
  await expect(page.getByText("极点新店", { exact: true })).toBeVisible();
  await expect(page.getByText("后续为模拟支付（不扣款）")).toBeVisible();
  await expect(page.getByText("¥36.00", { exact: true })).toBeVisible();

  await page
    .getByRole("button", { name: /02 固定虚构门店 星桥标准店/u })
    .click();
  await expect(
    page.getByRole("button", { name: /02 固定虚构门店 星桥标准店/u }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("radio", { name: /标准型/u })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByText("¥19.20", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /01 主演示门店 棱镜旗舰店/u }).click();
  await page.getByRole("radio", { name: /竞技型/u }).click();
  await expect(page.getByText("¥36.00", { exact: true })).toBeVisible();

  const availabilitySettledMilliseconds = await page.evaluate(() => {
    const entries = performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes("/customer/seat-availability"));
    const last = entries.at(-1);
    return last
      ? performance.now() - last.responseEnd
      : Number.POSITIVE_INFINITY;
  });
  expect(availabilitySettledMilliseconds).toBeLessThan(1_000);

  await page.getByRole("button", { name: "查找可订座位" }).click();
  await expect(
    page.getByRole("heading", { name: "请选择一个座位" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /A-06，.*已预留/u }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /A-07，.*使用中/u }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /A-09，.*维护中/u }),
  ).toBeDisabled();
  await expect(
    page.getByText("工作日 18:00–24:00 · 1.20 倍").first(),
  ).toBeVisible();

  const localSelectionMilliseconds = await page.evaluate(async () => {
    const target = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.getAttribute("aria-label")?.includes("A-05，"));
    if (!target) return Number.POSITIVE_INFINITY;
    const startedAt = performance.now();
    target.click();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    return performance.now() - startedAt;
  });
  expect(localSelectionMilliseconds).toBeLessThan(100);
  await expect(
    page.getByRole("button", { name: /A-05，.*已选/u }),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续确认" }).click();
  await expect(
    page.getByRole("heading", { name: "竞技区 A-05" }),
  ).toBeVisible();
  await expect(page.getByText("模拟支付不会扣款")).toBeVisible();
});

test("condition changes requery automatically, clear stale selection, and remain usable at 360px", async ({
  page,
}) => {
  await page.setViewportSize({ height: 800, width: 360 });
  await openCustomerH5(page);
  await page.getByRole("button", { name: "查找可订座位" }).click();
  await page.getByRole("button", { name: /A-05，.*可订/u }).click();
  await page.getByRole("button", { name: /返回修改时段/u }).click();
  await page.getByRole("radio", { name: /竞技区 B/u }).click();

  await expect(
    page.getByText(/A-05 已不符合新的时段、区域或机型条件/u),
  ).toBeVisible();
  await page.getByRole("button", { name: "查找可订座位" }).click();
  await expect(
    page.getByRole("button", { name: /B-01，.*可订/u }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /A-05/u })).toHaveCount(0);

  const viewport = await page.evaluate(() => {
    const h5 = document.querySelector<HTMLElement>(".customer-h5");
    return {
      clientWidth: document.documentElement.clientWidth,
      h5ClientWidth: h5?.clientWidth ?? 0,
      h5ScrollWidth: h5?.scrollWidth ?? Number.POSITIVE_INFINITY,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
  expect(viewport.h5ScrollWidth).toBeLessThanOrEqual(viewport.h5ClientWidth);

  const undersizedControls = await page
    .locator(".customer-h5 button:visible:not(:disabled)")
    .evaluateAll((buttons) =>
      buttons
        .map((button) => ({
          height: button.getBoundingClientRect().height,
          label: button.getAttribute("aria-label") ?? button.textContent ?? "",
          width: button.getBoundingClientRect().width,
        }))
        .filter((button) => button.height < 44 || button.width < 44),
    );
  expect(undersizedControls).toEqual([]);
});

test("WEB-C01 confirmation supports price details, coupon states, zero payable and a real hold submit at 360px", async ({
  page,
}) => {
  await page.setViewportSize({ height: 800, width: 360 });
  await openCustomerH5(page);
  await page.getByRole("button", { name: "查找可订座位" }).click();
  await page.getByRole("button", { name: /A-05，.*可订/u }).click();
  await page.getByRole("button", { name: "继续确认" }).click();

  await expect(page.getByText("¥30.00", { exact: true })).toBeVisible();
  await expect(page.getByText("当前金额未达到最低使用门槛")).toBeVisible();
  await page.getByRole("button", { name: /半小时价格明细 展开/u }).click();
  await expect(
    page.getByText("工作日 18:00–24:00 · 1.20 倍").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: /不使用体验券/u }).click();
  await expect(
    page.locator(".customer-money-summary .is-total").getByText("¥36.00"),
  ).toBeVisible();
  await page.getByRole("button", { name: /零元应付体验券/u }).click();
  await expect(
    page.locator(".customer-money-summary .is-total").getByText("¥0.00"),
  ).toBeVisible();
  await page.getByRole("button", { name: /预约立减体验券/u }).click();

  const requestPromise = page.waitForRequest(
    (request) =>
      request.url().includes("/api/v1/customer/reservations") &&
      request.method() === "POST",
  );
  await page.getByRole("button", { name: "创建十分钟保留" }).click();
  const request = await requestPromise;
  expect(request.headers()["x-csrf-token"]).toBe(customerContext.csrfToken);
  expect(request.headers()["idempotency-key"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  expect(request.postDataJSON()).toMatchObject({
    areaCode: "competitive-a",
    couponId: "00000000-0000-4000-8000-000000000701",
    durationHours: 2,
    machineProfileCode: "competitive",
    mode: "immediate",
    seatCode: "A-05",
    storeCode: "prism-flagship",
  });
  await expect(
    page.getByRole("heading", { name: "预约已排他保留十分钟" }),
  ).toBeVisible();
  await expect(page.getByText("没有发生扣款")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "继续模拟支付（不扣款）" }),
  ).toBeEnabled();

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
});

test("WEB-C01 explains no-coupon state and invalidates a seat after a server conflict", async ({
  page,
}) => {
  await page.setViewportSize({ height: 800, width: 360 });
  await openCustomerH5(page, {
    conflict: true,
    transformAvailability: (value) => ({ ...value, coupons: [] }),
  });
  await page.getByRole("button", { name: "查找可订座位" }).click();
  await page.getByRole("button", { name: /A-05，.*可订/u }).click();
  await page.getByRole("button", { name: "继续确认" }).click();
  await expect(
    page.getByText("当前没有预约体验券，仍可按原价继续。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "创建十分钟保留" }).click();
  await expect(page.getByText("当前选择已失效")).toBeVisible();
  await expect(
    page.getByText("该座位刚刚被其他预约占用，请返回重新选座。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回选座" }).last().click();
  await expect(page.getByRole("button", { name: "继续确认" })).toBeDisabled();
});

test("catalog failure exposes an actionable retry", async ({ page }) => {
  await page.setViewportSize({ height: 800, width: 360 });
  await page.route("**/api/v1/demo/context", (route) =>
    serveJson(route, customerContext),
  );
  await page.route("**/api/v1/customer/stores", async (route) => {
    if (route.request().headers()["x-retry-attempt"] === "0") {
      await route.fulfill({
        json: {
          error: {
            code: "CUSTOMER_STORE_CATALOG_UNAVAILABLE",
            message: "三店资料暂时无法读取，请重试。",
            requestId: "00000000-0000-4000-8000-000000000606",
          },
        },
        status: 503,
      });
      return;
    }
    await serveJson(route, catalog);
  });
  await page.route("**/api/v1/customer/seat-availability?**", (route) =>
    serveJson(route, availabilityFor(route.request().url())),
  );

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "三店资料暂时不可用" }),
  ).toBeVisible();
  await expect(
    page.getByText("三店资料暂时无法读取，请重试。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重新读取" }).click();
  await expect(page.getByRole("heading", { name: "三店浏览" })).toBeVisible();
});

async function createHeldReservation(page: Page) {
  await page.getByRole("button", { name: "查找可订座位" }).click();
  await page.getByRole("button", { name: /A-05，.*可订/u }).click();
  await page.getByRole("button", { name: "继续确认" }).click();
  await page.getByRole("button", { name: "创建十分钟保留" }).click();
  await expect(
    page.getByRole("heading", { name: "预约已排他保留十分钟" }),
  ).toBeVisible();
}

test("WEB-C02 completes the no-charge payment, detail and full simulated refund journey at 360px", async ({
  page,
}) => {
  await page.setViewportSize({ height: 800, width: 360 });
  await openCustomerH5(page);
  await createHeldReservation(page);

  await page.getByRole("button", { name: "继续模拟支付（不扣款）" }).click();
  await expect(
    page.getByRole("heading", { name: "确认模拟支付" }),
  ).toBeVisible();
  await expect(
    page.getByText("本次不会扣款，也不需要任何真实支付凭证。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认模拟支付（不扣款）" }).click();
  await expect(
    page.getByRole("heading", { name: "正在完成模拟支付" }),
  ).toBeVisible();
  await expect(
    page.getByText(/不会扣款，也不会接触真实支付凭证/u),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "模拟支付成功" }),
  ).toBeVisible();
  await expect(page.getByText(/全程没有扣款/u)).toBeVisible();
  await page.getByRole("button", { name: "查看预约详情" }).click();

  await expect(
    page
      .locator(".customer-lifecycle-status-row")
      .getByText("已确认", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/到店窗口/u)).toBeVisible();
  const lifecycleProgress = page.getByRole("list", {
    name: "预约生命周期进度",
  });
  await expect(lifecycleProgress).toContainText("已确认");
  await expect(lifecycleProgress).toContainText("已到店");
  await expect(lifecycleProgress).toContainText("使用中");
  await expect(page.getByText("竞技区 A-05", { exact: true })).toBeVisible();
  await expect(page.getByText(/模拟支付成功（未扣款）/u)).toBeVisible();
  await page.getByRole("button", { name: "取消预约" }).click();
  await expect(
    page.getByRole("heading", { name: "确认取消预约？" }),
  ).toBeVisible();
  await page.getByPlaceholder("请输入 1–200 字原因").fill("行程变更");
  await page.getByRole("button", { name: "确认取消预约" }).click();
  await expect(page.getByText("已取消", { exact: true })).toBeVisible();
  await expect(page.getByText("模拟退款已记录")).toBeVisible();
  await expect(page.getByText("不对应真实资金")).toBeVisible();
  await expect(page.getByRole("button", { name: "再次预约" })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消预约" })).toHaveCount(0);

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  const undersizedControls = await page
    .locator(".customer-h5 button:visible:not(:disabled)")
    .evaluateAll((buttons) =>
      buttons
        .map((button) => ({
          height: button.getBoundingClientRect().height,
          label: button.textContent ?? "",
          width: button.getBoundingClientRect().width,
        }))
        .filter((button) => button.height < 44 || button.width < 44),
    );
  expect(undersizedControls).toEqual([]);
});

test("WEB-C02 retries a recoverable payment failure with the original idempotency key", async ({
  page,
}) => {
  const paymentKeys: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/simulated-payment")) {
      paymentKeys.push(request.headers()["idempotency-key"] ?? "");
    }
  });
  await page.setViewportSize({ height: 800, width: 360 });
  await openCustomerH5(page, { paymentFailures: 1 });
  await createHeldReservation(page);
  await page.getByRole("button", { name: "继续模拟支付（不扣款）" }).click();
  await page.getByRole("button", { name: "确认模拟支付（不扣款）" }).click();

  await expect(
    page.getByRole("heading", { name: "模拟支付尚未完成" }),
  ).toBeVisible();
  await expect(page.getByText("确认没有扣款")).toBeVisible();
  await page.getByRole("button", { name: "使用原提交标识安全重试" }).click();
  await expect(
    page.getByRole("heading", { name: "模拟支付成功" }),
  ).toBeVisible();
  expect(paymentKeys).toHaveLength(2);
  expect(paymentKeys[1]).toBe(paymentKeys[0]);
});

test("WEB-C02 renders all seven reservation states without exposing illegal main actions", async ({
  page,
}) => {
  await page.setViewportSize({ height: 800, width: 360 });
  await openCustomerH5(page, {
    detailStatuses: [
      "pending-confirmation",
      "confirmed",
      "arrived",
      "in-use",
      "completed",
      "cancelled",
      "expired",
    ],
  });
  await createHeldReservation(page);
  await page.getByRole("button", { name: "查看预约详情" }).click();

  await expect(
    page.getByRole("list", { name: "预约生命周期进度" }),
  ).toBeVisible();

  const labels = [
    "待确认",
    "已确认",
    "已到店",
    "使用中",
    "已完成",
    "已取消",
    "已过期",
  ];
  const statusRow = page.locator(".customer-lifecycle-status-row");
  await expect(statusRow.getByText(labels[0]!, { exact: true })).toBeVisible();
  for (const label of labels.slice(1)) {
    await page.getByRole("button", { name: /刷新当前状态/u }).click();
    await expect(statusRow.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "再次预约" })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消预约" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "继续模拟支付（不扣款）" }),
  ).toHaveCount(0);
});
