import { expect, test } from "@playwright/test";
import type { APIResponse, BrowserContext, Page } from "@playwright/test";
import type {
  DemoStoryResponse,
  PublicRole,
  RoleContextReadyResponse,
} from "@jingshu/contracts";

interface JsonResponse<T> {
  readonly body: T;
  readonly response: APIResponse;
  readonly text: string;
}

interface JsonRequest {
  readonly body?: Record<string, unknown>;
  readonly headers?: Record<string, string>;
  readonly method?: "GET" | "POST";
}

interface ReservationAvailability {
  readonly coupons: ReadonlyArray<{
    readonly displayName: string;
    readonly eligibility: { readonly status: "eligible" | "ineligible" };
    readonly id: string;
  }>;
  readonly seats: ReadonlyArray<{
    readonly availability: string;
    readonly code: string;
  }>;
}

interface ProductCatalog {
  readonly coupons: ReadonlyArray<{
    readonly eligibility: { readonly status: "eligible" | "ineligible" };
    readonly id: string;
  }>;
  readonly products: ReadonlyArray<{ readonly id: string }>;
}

function apiUrl(origin: string, path: string) {
  return new URL(path, origin).toString();
}

async function requestJson<T>(
  context: BrowserContext,
  origin: string,
  path: string,
  input: JsonRequest = {},
): Promise<JsonResponse<T>> {
  const response = await context.request.fetch(apiUrl(origin, path), {
    data: input.body === undefined ? undefined : JSON.stringify(input.body),
    headers: input.headers,
    method: input.method ?? "GET",
  });
  const text = await response.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON from ${path}, received: ${text}`);
  }
  return { body, response, text };
}

function expectStatus<T>(result: JsonResponse<T>, status: number): T {
  expect(result.response.status(), result.text).toBe(status);
  return result.body;
}

function writeHeaders(context: RoleContextReadyResponse, origin: string) {
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),
    Origin: origin,
    "X-CSRF-Token": context.csrfToken,
  };
}

async function readContext(context: BrowserContext, origin: string) {
  return expectStatus(
    await requestJson<RoleContextReadyResponse>(
      context,
      origin,
      "/api/v1/demo/context",
    ),
    200,
  );
}

async function switchRole(
  context: BrowserContext,
  origin: string,
  current: RoleContextReadyResponse,
  targetRole: PublicRole,
) {
  return expectStatus(
    await requestJson<RoleContextReadyResponse>(
      context,
      origin,
      "/api/v1/demo/context/switch",
      {
        body: { targetRole },
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          "X-CSRF-Token": current.csrfToken,
        },
        method: "POST",
      },
    ),
    200,
  );
}

function businessDay(instant: string, offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const day = new Date(
    Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)),
  );
  if (Number(values.hour) < 6) day.setUTCDate(day.getUTCDate() - 1);
  day.setUTCDate(day.getUTCDate() + offsetDays);
  return day.toISOString().slice(0, 10);
}

async function openFreshCustomerShell(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "从一次预约，看见四个角色如何共同经营。",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /进入顾客演示/u }).click();
  await expect(page.getByRole("button", { name: "进入顾客视图" })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "进入顾客视图" }).click();
  await expect(
    page.getByRole("button", { name: /打开主演示清单/u }),
  ).toBeVisible({ timeout: 60_000 });
}

async function switchRoleInShell(page: Page, roleName: string) {
  await page.getByRole("button", { name: "切换角色" }).click();
  await page
    .getByRole("button", { name: new RegExp(`^${roleName} .*虚构人物`, "u") })
    .click();
  await expect(page.getByRole("button", { name: "切换角色" })).toBeVisible();
}

async function completeCustomerReservationInShell(page: Page) {
  await page.getByRole("button", { name: "查找可订座位" }).click();
  await expect(
    page.getByRole("heading", { name: "请选择一个座位" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /A-\d+，.*可订/u })
    .first()
    .click();
  await page.getByRole("button", { name: "继续确认" }).click();
  await page.getByRole("button", { name: /预约立减体验券/u }).click();
  await page.getByRole("button", { name: "创建十分钟保留" }).click();
  await expect(
    page.getByRole("heading", { name: "预约已排他保留十分钟" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续模拟支付（不扣款）" }).click();
  await page.getByRole("button", { name: "确认模拟支付（不扣款）" }).click();
  await expect(
    page.getByRole("heading", { name: "模拟支付成功" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看预约详情" }).click();
  await expect(page.getByText("已确认", { exact: true }).first()).toBeVisible();
}

async function advanceHalfHourInShell(page: Page) {
  await page.getByRole("button", { name: /打开业务时间工具/u }).click();
  await page.getByRole("button", { name: /向前推进 30 分钟/u }).click();
  await page.getByRole("button", { name: "查看推进影响" }).click();
  await page.getByRole("button", { name: "确认并原子推进" }).click();
  await expect(
    page.getByRole("heading", { name: "业务时间已完整推进" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回当前角色" }).click();
}

async function readJourney(
  context: BrowserContext,
  origin: string,
): Promise<{
  readonly groups: {
    readonly current: ReadonlyArray<{
      readonly related: {
        readonly orders: ReadonlyArray<{ readonly id: string }>;
        readonly repairs: ReadonlyArray<{ readonly id: string }>;
      };
      readonly reservationId: string;
      readonly seat: { readonly code: string };
      readonly status: string;
    }>;
    readonly future: ReadonlyArray<{
      readonly related: {
        readonly orders: ReadonlyArray<{ readonly id: string }>;
        readonly repairs: ReadonlyArray<{ readonly id: string }>;
      };
      readonly reservationId: string;
      readonly seat: { readonly code: string };
      readonly status: string;
    }>;
    readonly history: ReadonlyArray<{
      readonly related: {
        readonly orders: ReadonlyArray<{ readonly id: string }>;
        readonly repairs: ReadonlyArray<{ readonly id: string }>;
      };
      readonly reservationId: string;
      readonly seat: { readonly code: string };
      readonly status: string;
    }>;
  };
}> {
  return expectStatus(
    await requestJson(context, origin, "/api/v1/customer/journey"),
    200,
  );
}

function allJourneyReservations(
  journey: Awaited<ReturnType<typeof readJourney>>,
) {
  return [
    ...journey.groups.current,
    ...journey.groups.future,
    ...journey.groups.history,
  ];
}

test("服务端证据回归：新鲜浏览器会话完成十二步并失效旧标签", async ({
  browser,
  context,
  page,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL)
    throw new Error("The demo-story browser test requires baseURL.");
  const origin = new URL(baseURL).origin;

  await openFreshCustomerShell(page);
  let current = await readContext(context, origin);
  expect(current.role.id).toBe("customer");

  const booking = expectStatus(
    await requestJson<ReservationAvailability>(
      context,
      origin,
      "/api/v1/customer/seat-availability?store=prism-flagship&area=competitive-a&machine=competitive&durationHours=2&mode=immediate",
    ),
    200,
  );
  const reservationCoupon = booking.coupons.find(
    (candidate) => candidate.eligibility.status === "eligible",
  );
  const availableSeat = booking.seats.find(
    (candidate) => candidate.availability === "available",
  );
  if (!reservationCoupon || !availableSeat) {
    throw new Error(
      "Fresh sandbox did not provide an eligible immediate booking.",
    );
  }

  const reservation = expectStatus(
    await requestJson<{ readonly reservationId: string }>(
      context,
      origin,
      "/api/v1/customer/reservations",
      {
        body: {
          areaCode: "competitive-a",
          couponId: reservationCoupon.id,
          durationHours: 2,
          machineProfileCode: "competitive",
          mode: "immediate",
          seatCode: availableSeat.code,
          storeCode: "prism-flagship",
        },
        headers: writeHeaders(current, origin),
        method: "POST",
      },
    ),
    201,
  );
  expectStatus(
    await requestJson<Record<string, never>>(
      context,
      origin,
      `/api/v1/customer/reservations/${reservation.reservationId}/simulated-payment`,
      { body: {}, headers: writeHeaders(current, origin), method: "POST" },
    ),
    200,
  );

  current = await switchRole(context, origin, current, "staff");
  expectStatus(
    await requestJson<Record<string, never>>(
      context,
      origin,
      `/api/v1/staff/reservations/${reservation.reservationId}/commands`,
      {
        body: { action: "arrive" },
        headers: writeHeaders(current, origin),
        method: "POST",
      },
    ),
    200,
  );
  const startUse = await requestJson<Record<string, never>>(
    context,
    origin,
    `/api/v1/staff/reservations/${reservation.reservationId}/commands`,
    {
      body: { action: "start-use" },
      headers: writeHeaders(current, origin),
      method: "POST",
    },
  );
  if (startUse.response.status() === 409) {
    expectStatus(
      await requestJson<Record<string, never>>(
        context,
        origin,
        "/api/v1/demo/time/advance",
        {
          body: { mode: "half-hour" },
          headers: writeHeaders(current, origin),
          method: "POST",
        },
      ),
      200,
    );
    expectStatus(
      await requestJson<Record<string, never>>(
        context,
        origin,
        `/api/v1/staff/reservations/${reservation.reservationId}/commands`,
        {
          body: { action: "start-use" },
          headers: writeHeaders(current, origin),
          method: "POST",
        },
      ),
      200,
    );
  } else {
    expectStatus(startUse, 200);
  }

  current = await switchRole(context, origin, current, "customer");
  const catalog = expectStatus(
    await requestJson<ProductCatalog>(
      context,
      origin,
      `/api/v1/customer/reservations/${reservation.reservationId}/products`,
    ),
    200,
  );
  const orderCoupon = catalog.coupons.find(
    (candidate) => candidate.eligibility.status === "eligible",
  );
  const product = catalog.products.at(0);
  if (!orderCoupon || !product) {
    throw new Error("Fresh sandbox did not provide an eligible product order.");
  }
  const order = expectStatus(
    await requestJson<{ readonly orderId: string }>(
      context,
      origin,
      "/api/v1/customer/orders",
      {
        body: {
          couponId: orderCoupon.id,
          lines: [{ productId: product.id, quantity: 2 }],
          reservationId: reservation.reservationId,
        },
        headers: writeHeaders(current, origin),
        method: "POST",
      },
    ),
    201,
  );
  expectStatus(
    await requestJson<Record<string, never>>(
      context,
      origin,
      `/api/v1/customer/orders/${order.orderId}/simulated-payment`,
      { body: {}, headers: writeHeaders(current, origin), method: "POST" },
    ),
    200,
  );

  current = await switchRole(context, origin, current, "staff");
  expectStatus(
    await requestJson<Record<string, never>>(
      context,
      origin,
      `/api/v1/staff/orders/${order.orderId}/commands`,
      {
        body: { action: "start-preparing" },
        headers: writeHeaders(current, origin),
        method: "POST",
      },
    ),
    200,
  );
  expectStatus(
    await requestJson<Record<string, never>>(
      context,
      origin,
      "/api/v1/demo/time/advance",
      {
        body: { mode: "half-hour" },
        headers: writeHeaders(current, origin),
        method: "POST",
      },
    ),
    200,
  );

  current = await switchRole(context, origin, current, "customer");
  const repair = expectStatus(
    await requestJson<{ readonly repairId: string }>(
      context,
      origin,
      "/api/v1/customer/repairs",
      {
        body: {
          description: "耳机右声道无声",
          reservationId: reservation.reservationId,
        },
        headers: writeHeaders(current, origin),
        method: "POST",
      },
    ),
    201,
  );

  current = await switchRole(context, origin, current, "staff");
  const intake = expectStatus(
    await requestJson<{
      readonly handlers: ReadonlyArray<{
        readonly displayName: string;
        readonly personaId: string;
      }>;
    }>(context, origin, "/api/v1/staff/repair-intake"),
    200,
  );
  const handler = intake.handlers.find(
    (candidate) => candidate.displayName === current.persona.displayName,
  );
  if (!handler)
    throw new Error("The protected staff persona is not a handler.");
  expectStatus(
    await requestJson<Record<string, never>>(
      context,
      origin,
      `/api/v1/staff/repairs/${repair.repairId}/assign`,
      {
        body: {
          assigneePersonaId: handler.personaId,
          internalNote: "复现右声道无声，检查耳机与接口。",
          priority: "high",
          publicNote: "门店已安排处理人。",
        },
        headers: writeHeaders(current, origin),
        method: "POST",
      },
    ),
    200,
  );
  expectStatus(
    await requestJson<Record<string, never>>(
      context,
      origin,
      `/api/v1/staff/repairs/${repair.repairId}/start`,
      {
        body: {
          internalNote: "已进入维护并开始检修。",
          publicNote: "设备已进入检修。",
        },
        headers: writeHeaders(current, origin),
        method: "POST",
      },
    ),
    200,
  );
  const repairDetail = expectStatus(
    await requestJson<{
      readonly spares: {
        readonly available: ReadonlyArray<{
          readonly displayName: string;
          readonly inventoryItemId: string;
        }>;
      };
    }>(context, origin, `/api/v1/repairs/${repair.repairId}`),
    200,
  );
  const headset = repairDetail.spares.available.find(
    (candidate) => candidate.displayName === "无品牌替换耳机",
  );
  if (!headset) throw new Error("The fresh repair has no replacement headset.");
  expectStatus(
    await requestJson<Record<string, never>>(
      context,
      origin,
      `/api/v1/staff/repairs/${repair.repairId}/spares/claim`,
      {
        body: { inventoryItemId: headset.inventoryItemId, quantity: 1 },
        headers: writeHeaders(current, origin),
        method: "POST",
      },
    ),
    200,
  );
  expectStatus(
    await requestJson<Record<string, never>>(
      context,
      origin,
      `/api/v1/staff/repairs/${repair.repairId}/resolution`,
      {
        body: { resolutionNote: "已更换无品牌替换耳机并完成左右声道试听。" },
        headers: writeHeaders(current, origin),
        method: "POST",
      },
    ),
    200,
  );

  current = await switchRole(context, origin, current, "manager");
  expectStatus(
    await requestJson<Record<string, never>>(
      context,
      origin,
      `/api/v1/staff/repairs/${repair.repairId}/verification`,
      {
        body: {
          outcome: "success",
          reason: "店长独立复核通过，座位恢复可用。",
        },
        headers: writeHeaders(current, origin),
        method: "POST",
      },
    ),
    200,
  );
  expectStatus(
    await requestJson<Record<string, unknown>>(
      context,
      origin,
      "/api/v1/manager/dashboard",
    ),
    200,
  );
  const managerAudits = expectStatus(
    await requestJson<{
      readonly events: ReadonlyArray<{ readonly objectId: string }>;
    }>(context, origin, "/api/v1/manager/audits?action=repair.verify-success"),
    200,
  );
  expect(managerAudits.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ objectId: repair.repairId }),
    ]),
  );

  current = await switchRole(context, origin, current, "hq");
  const chain = expectStatus(
    await requestJson<{
      readonly stores: ReadonlyArray<{
        readonly store: { readonly storeId: string };
      }>;
    }>(context, origin, "/api/v1/hq/dashboard"),
    200,
  );
  const toBusinessDay = businessDay(current.sandbox.businessClock.currentTime);
  const exportResponse = await context.request.post(
    apiUrl(origin, "/api/v1/hq/exports"),
    {
      data: JSON.stringify({
        dataType: "reservations",
        filters: {},
        fromBusinessDay: businessDay(
          current.sandbox.businessClock.currentTime,
          -13,
        ),
        sort: { direction: "asc", field: "businessOccurredAt" },
        storeIds: chain.stores.map((store) => store.store.storeId),
        toBusinessDay,
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "X-CSRF-Token": current.csrfToken,
      },
    },
  );
  const csv = await exportResponse.text();
  expect(exportResponse.status(), csv).toBe(200);
  expect(csv).toMatch(/^\uFEFF门店代码,门店,/u);
  expect(csv).toContain(reservation.reservationId);
  expect(exportResponse.headers()["x-export-row-count"]).toBeTruthy();

  const exportAudits = expectStatus(
    await requestJson<{
      readonly events: ReadonlyArray<{
        readonly store: { readonly code: string } | null;
      }>;
    }>(context, origin, "/api/v1/hq/audits?action=export.csv"),
    200,
  );
  expect(exportAudits.events.map((event) => event.store?.code)).toEqual(
    expect.arrayContaining([
      "prism-flagship",
      "starbridge-standard",
      "apex-new",
    ]),
  );
  const completeStory = expectStatus(
    await requestJson<DemoStoryResponse>(context, origin, "/api/v1/demo/story"),
    200,
  );
  expect(completeStory.completedCount).toBe(11);
  expect(
    completeStory.steps.find((step) => step.id === "repair-verified"),
  ).toEqual(
    expect.objectContaining({
      evidence: [expect.objectContaining({ kind: "business-event" })],
      state: "completed",
    }),
  );

  const oldContext = await browser.newContext();
  try {
    await oldContext.addCookies(await context.cookies());
    const reset = expectStatus(
      await requestJson<{ readonly context: RoleContextReadyResponse }>(
        context,
        origin,
        "/api/v1/demo/reset",
        {
          body: { confirm: true },
          headers: writeHeaders(current, origin),
          method: "POST",
        },
      ),
      201,
    );
    current = reset.context;

    const staleDashboard = await requestJson<Record<string, unknown>>(
      oldContext,
      origin,
      "/api/v1/hq/dashboard",
    );
    expect(staleDashboard.response.status(), staleDashboard.text).toBe(410);
    const oldPage = await oldContext.newPage();
    await oldPage.goto(origin);
    await expect(
      oldPage.getByRole("heading", { name: "此标签使用的旧沙箱已失效" }),
    ).toBeVisible();

    const resetStory = expectStatus(
      await requestJson<DemoStoryResponse>(
        context,
        origin,
        "/api/v1/demo/story",
      ),
      200,
    );
    expect(resetStory.completedCount).toBe(0);
    expect(resetStory.resetAt).toEqual(expect.any(String));
    const oldObject = await requestJson<Record<string, unknown>>(
      context,
      origin,
      `/api/v1/customer/reservations/${reservation.reservationId}`,
    );
    expect(oldObject.response.status(), oldObject.text).toBe(404);

    await page.reload();
    const storyTrigger = page.getByRole("button", {
      name: /打开主演示清单/u,
    });
    await expect(storyTrigger).toBeVisible();
    await storyTrigger.click();
    const drawer = page.getByRole("dialog", { name: "十二步主演示清单" });
    await expect(
      drawer.getByText("已完成 0 / 12", { exact: true }),
    ).toBeVisible();
    await expect(drawer.getByTestId("demo-story-step-1")).toHaveAttribute(
      "aria-current",
      "step",
    );
  } finally {
    await oldContext.close();
  }
});

test("新鲜访客可只通过页面完成跨四角色主演示", async ({
  browser,
  context,
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL) {
    throw new Error("The demo-story browser test requires baseURL.");
  }
  const origin = new URL(baseURL).origin;

  await openFreshCustomerShell(page);
  await completeCustomerReservationInShell(page);
  let journey = await readJourney(context, origin);
  const reservation = allJourneyReservations(journey).find(
    (item) => item.status === "confirmed",
  );
  if (!reservation) {
    throw new Error("The customer UI did not create the main reservation.");
  }

  await switchRoleInShell(page, "店员");
  await expect(page.getByRole("heading", { name: "现场脉冲" })).toBeVisible();
  const reservationRow = page
    .locator(".role-queue-row")
    .filter({ hasText: reservation.seat.code })
    .first();
  await expect(reservationRow).toBeVisible();
  await reservationRow.click();
  await page.getByRole("button", { name: "办理到店" }).click();
  await page.getByRole("button", { name: "确认办理到店" }).click();
  await expect(page.getByText("已到店", { exact: true }).first()).toBeVisible();

  let startUse = page.getByRole("button", { name: "开始使用" });
  if (!(await startUse.isVisible())) {
    await advanceHalfHourInShell(page);
    await expect(reservationRow).toBeVisible();
    await reservationRow.click();
    startUse = page.getByRole("button", { name: "开始使用" });
  }
  await startUse.click();
  await page.getByRole("button", { name: "确认开始使用" }).click();
  await expect(page.getByText("使用中", { exact: true }).first()).toBeVisible();

  await switchRoleInShell(page, "顾客");
  journey = await readJourney(context, origin);
  expect(
    allJourneyReservations(journey).find(
      (item) => item.reservationId === reservation.reservationId,
    )?.status,
  ).toBe("in-use");

  await page
    .getByTestId("role-sidebar")
    .getByRole("link", { name: "我的订单" })
    .click();
  await expect(page).toHaveURL(/\/customer\/journeys\/current\?type=order$/u);
  await page.locator(".customer-journey-main").first().click();
  await expect(page.getByRole("link", { name: "购买柜台商品" })).toBeVisible();
  await page.getByRole("link", { name: "购买柜台商品" }).click();
  await expect(page.getByRole("heading", { name: "柜台商品" })).toBeVisible();
  const addProductButtons = page.getByRole("button", { name: /^增加/u });
  await addProductButtons.nth(0).click();
  await addProductButtons.nth(1).click();
  await page.getByRole("button", { name: "确认购物车" }).click();
  const orderCoupon = page.getByRole("button", { name: /商品立减体验券/u });
  await expect(orderCoupon).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "创建待模拟支付订单" }).click();
  await page.getByRole("link", { name: "确认模拟支付（不扣款）" }).click();
  await page.getByRole("button", { name: "确认模拟支付（不扣款）" }).click();
  await expect(
    page.getByRole("heading", { name: "模拟支付成功" }),
  ).toBeVisible();
  journey = await readJourney(context, origin);
  const paidReservation = allJourneyReservations(journey).find(
    (item) => item.reservationId === reservation.reservationId,
  );
  const orderId = paidReservation?.related.orders.at(0)?.id;
  if (!orderId)
    throw new Error("The customer UI did not create the main order.");

  await switchRoleInShell(page, "店员");
  await page
    .getByTestId("role-sidebar")
    .getByRole("button", { name: "商品订单" })
    .click();
  const orderRow = page
    .locator(".staff-order-row")
    .filter({ hasText: "林澈 · 虚构人物" })
    .first();
  await expect(orderRow).toBeVisible();
  await orderRow.click();
  await page.getByRole("button", { name: "开始制作" }).click();
  await expect(page.getByText("制作中", { exact: true }).first()).toBeVisible();
  await advanceHalfHourInShell(page);

  await switchRoleInShell(page, "顾客");
  await page
    .getByTestId("role-sidebar")
    .getByRole("link", { name: "我的报修" })
    .click();
  await expect(page).toHaveURL(/\/customer\/journeys\/current\?type=repair$/u);
  await page.locator(".customer-journey-main").first().click();
  await expect(
    page.getByRole("link", { name: "为当前座位报修" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "为当前座位报修" }).click();
  await page.getByPlaceholder("例如：耳机右声道无声").fill("耳机右声道无声");
  await page.getByRole("button", { name: "提交报修" }).click();
  await expect(page.getByRole("heading", { name: "报修已创建" })).toBeVisible();
  journey = await readJourney(context, origin);
  const repairId = allJourneyReservations(journey)
    .find((item) => item.reservationId === reservation.reservationId)
    ?.related.repairs.at(0)?.id;
  if (!repairId)
    throw new Error("The customer UI did not create the main repair.");

  await switchRoleInShell(page, "店员");
  await page
    .getByTestId("role-sidebar")
    .getByRole("button", { name: "报修" })
    .click();
  const repairRow = page
    .locator(".staff-repair-table button")
    .filter({ hasText: "耳机右声道无声" })
    .first();
  await expect(repairRow).toBeVisible();
  await repairRow.click();
  await page.getByRole("button", { name: "分派报修" }).click();
  await page
    .getByLabel(/内部处理说明/u)
    .fill("复现右声道无声，检查耳机与接口。");
  await page.getByRole("button", { name: "确认分派" }).click();
  await page.getByRole("button", { name: "开始处理" }).click();
  await page.getByLabel(/内部处理说明/u).fill("已进入维护并开始检修。");
  await page.getByRole("button", { name: "确认影响并开始" }).click();
  await page.getByRole("button", { name: "领用备件" }).click();
  const spareSelect = page.getByLabel("本店可用备件");
  const headsetOption = spareSelect
    .locator("option")
    .filter({ hasText: "无品牌替换耳机" });
  await spareSelect.selectOption(
    (await headsetOption.getAttribute("value")) ?? "",
  );
  await page.getByRole("button", { name: "确认提交" }).click();
  await page.getByRole("button", { name: "提交解决说明" }).click();
  await page
    .getByRole("dialog", { name: "提交解决说明" })
    .getByLabel("解决说明")
    .fill("已更换无品牌替换耳机并完成左右声道试听。");
  await page.getByRole("button", { name: "确认提交" }).click();
  await expect(page.getByText("待验证", { exact: true }).first()).toBeVisible();

  await switchRoleInShell(page, "店长");
  await page
    .getByTestId("role-sidebar")
    .getByRole("button", { name: "报修" })
    .click();
  await expect(repairRow).toBeVisible();
  await repairRow.click();
  await page.getByRole("button", { name: "验证成功并关闭" }).click();
  await page.getByRole("button", { name: "确认提交" }).click();
  await expect(page.getByText("已关闭", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "查看单店经营看板" }).click();
  await expect(page.getByRole("heading", { name: "经营看板" })).toBeVisible();
  await page.getByRole("button", { name: "审计与导出" }).click();
  await expect(page.getByRole("heading", { name: "审计与导出" })).toBeVisible();

  await switchRoleInShell(page, "总部运营");
  await page
    .getByTestId("role-sidebar")
    .getByRole("button", { name: "门店比较" })
    .click();
  await expect(page.getByRole("heading", { name: "门店比较" })).toBeVisible();
  await page
    .getByTestId("role-sidebar")
    .getByRole("button", { name: "审计与导出" })
    .click();
  await expect(page.getByRole("heading", { name: "审计与导出" })).toBeVisible();
  await page.getByRole("button", { name: "导出 CSV" }).click();
  const exportDialog = page.getByRole("dialog", { name: "导出三店数据" });
  await expect(exportDialog).toBeVisible();
  await exportDialog.getByLabel("导出数据类型").selectOption("reservations");
  await exportDialog.getByLabel("导出搜索").fill(reservation.reservationId);
  await expect(exportDialog.getByText(reservation.reservationId)).toBeVisible();
  const exportResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/hq/exports"),
  );
  await exportDialog.getByRole("button", { name: "生成并下载 CSV" }).click();
  const csvResponse = await exportResponse;
  expect(csvResponse.status()).toBe(200);
  expect(csvResponse.headers()["x-export-row-count"]).toBe("1");
  await expect(exportDialog.getByText(/导出完成/u)).toBeVisible();
  await exportDialog.getByRole("button", { name: "完成" }).click();
  await expect(exportDialog).toBeHidden();

  const oldContext = await browser.newContext();
  try {
    await oldContext.addCookies(await context.cookies());
    await page.getByRole("button", { name: "重置为全新标准沙箱" }).click();
    await page.getByRole("button", { name: "继续二次确认" }).click();
    await page
      .getByRole("checkbox", {
        name: /我了解顾客、店员、店长与总部运营/u,
      })
      .check();
    await page
      .getByRole("button", { name: "创建新沙箱并使旧沙箱失效" })
      .click();
    await expect(
      page.getByRole("heading", { name: "全新标准沙箱已就绪" }),
    ).toBeVisible();
    const oldPage = await oldContext.newPage();
    await oldPage.goto(origin);
    await expect(
      oldPage.getByRole("heading", { name: "此标签使用的旧沙箱已失效" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "回到主演示起点" }).click();
    const resetStory = expectStatus(
      await requestJson<DemoStoryResponse>(
        context,
        origin,
        "/api/v1/demo/story",
      ),
      200,
    );
    expect(resetStory.completedCount).toBe(0);
    const oldObject = await requestJson<Record<string, unknown>>(
      context,
      origin,
      `/api/v1/customer/reservations/${reservation.reservationId}`,
    );
    expect(oldObject.response.status()).toBe(404);
  } finally {
    await oldContext.close();
  }
});
