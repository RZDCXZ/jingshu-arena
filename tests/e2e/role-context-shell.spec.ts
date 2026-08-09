import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import type {
  PublicRole,
  PublicSandboxReadyResponse,
  RoleContextReadyResponse,
} from "@jingshu/contracts";

const roleDetails = {
  customer: {
    capabilities: ["customer:manage-own-records"],
    label: "顾客",
    persona: "林澈",
    scope: "浏览三店 · 只管理自己的记录",
    scopeKind: "customer",
    stores: [
      { code: "prism-flagship", displayName: "棱镜旗舰店" },
      { code: "starbridge-standard", displayName: "星桥标准店" },
      { code: "apex-new", displayName: "极点新店" },
    ],
  },
  staff: {
    capabilities: ["store:perform-frontline"],
    label: "店员",
    persona: "周宁",
    scope: "棱镜旗舰店",
    scopeKind: "store",
    stores: [{ code: "prism-flagship", displayName: "棱镜旗舰店" }],
  },
  manager: {
    capabilities: [
      "store:perform-frontline",
      "store:adjust-inventory",
      "store:configure",
      "store:manage-people",
      "audit:view",
    ],
    label: "店长",
    persona: "许知远",
    scope: "棱镜旗舰店",
    scopeKind: "store",
    stores: [{ code: "prism-flagship", displayName: "棱镜旗舰店" }],
  },
  hq: {
    capabilities: [
      "store:configure",
      "chain:compare",
      "chain:configure",
      "audit:view",
    ],
    label: "总部运营",
    persona: "沈微",
    scope: "固定三店",
    scopeKind: "all-stores",
    stores: [
      { code: "prism-flagship", displayName: "棱镜旗舰店" },
      { code: "starbridge-standard", displayName: "星桥标准店" },
      { code: "apex-new", displayName: "极点新店" },
    ],
  },
} as const;

function roleContext(
  role: PublicRole,
  contextVersion: number,
  csrfToken: string,
  businessTime = "2026-08-09T11:30:00.000Z",
  advancedMilliseconds = 0,
): RoleContextReadyResponse {
  const details = roleDetails[role];
  return {
    status: "ready",
    csrfToken,
    contextVersion,
    role: { id: role, label: details.label },
    persona: { displayName: details.persona, protected: true },
    storeScope: {
      kind: details.scopeKind,
      label: details.scope,
      stores: [...details.stores],
    },
    capabilities: [...details.capabilities],
    sandbox: {
      schemaVersion: "4",
      seedVersion: "2026-08-09.1",
      expiresAt: "2026-08-10T12:00:00.000Z",
      businessClock: {
        advanceLimitMilliseconds: 86_400_000,
        advancedMilliseconds,
        currentTime: businessTime,
        remainingAdvanceMilliseconds: 86_400_000 - advancedMilliseconds,
        timeZone: "Asia/Shanghai",
      },
    },
    freshness: {
      mode: "manual",
      observedAt: new Date().toISOString(),
    },
  };
}

function sandboxReady(role: PublicRole): PublicSandboxReadyResponse {
  const details = roleDetails[role];
  return {
    status: "ready",
    replayed: false,
    role,
    persona: { displayName: details.persona, scope: details.scope },
    world: {
      schemaVersion: "4",
      seedVersion: "2026-08-09.1",
      expiresAt: "2026-08-10T12:00:00.000Z",
      operator: { displayName: "竞枢演示经营方", city: "栖光市" },
      stores: [
        {
          code: "prism-flagship",
          displayName: "棱镜旗舰店",
          seatCount: 96,
          businessHours: "24 小时",
        },
        {
          code: "starbridge-standard",
          displayName: "星桥标准店",
          seatCount: 64,
          businessHours: "10:00–次日 02:00",
        },
        {
          code: "apex-new",
          displayName: "极点新店",
          seatCount: 40,
          businessHours: "12:00–24:00",
        },
      ],
    },
  };
}

test.beforeEach(async ({ context }) => {
  let hasSession = false;
  let currentRole: PublicRole = "staff";
  let contextVersion = 1;
  let csrfToken = "csrf-context-version-1-token-value";
  let businessTime = "2026-08-09T11:30:00.000Z";
  let advancedMilliseconds = 0;

  await context.route("**/api/v1/customer/stores", async (route) => {
    await route.fulfill({
      json: {
        error: {
          code: "CUSTOMER_STORE_CATALOG_UNAVAILABLE",
          message: "共享壳层测试不加载顾客门店目录。",
          requestId: "00000000-0000-4000-8000-000000000607",
        },
      },
      status: 503,
    });
  });

  await context.route("**/api/v1/public/visitor", async (route) => {
    await route.fulfill({ status: 204 });
  });
  await context.route("**/api/v1/public/sandboxes", async (route) => {
    currentRole = route.request().postDataJSON().role as PublicRole;
    contextVersion = 1;
    csrfToken = "csrf-context-version-1-token-value";
    businessTime = "2026-08-09T11:30:00.000Z";
    advancedMilliseconds = 0;
    hasSession = true;
    await route.fulfill({ json: sandboxReady(currentRole), status: 201 });
  });
  const serveContext = async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.headers()["x-test-context-required"] === "1") {
      await route.fulfill({
        json: {
          error: {
            code: "ROLE_CONTEXT_REQUIRED",
            message: "演示角色上下文已失效，请返回公开入口重新选择。",
            requestId: "00000000-0000-4000-8000-000000000304",
          },
        },
        status: 401,
      });
      return;
    }
    if (pathname.endsWith("/switch")) {
      if (request.headers()["x-test-context-unavailable"] === "1") {
        await route.fulfill({
          json: {
            error: {
              code: "ROLE_CONTEXT_UNAVAILABLE",
              message: "当前演示角色或沙箱已失效，请返回公开入口重新选择。",
              requestId: "00000000-0000-4000-8000-000000000303",
            },
          },
          status: 401,
        });
        return;
      }
      expect(request.headers()["x-csrf-token"]).toBe(csrfToken);
      const body = request.postDataJSON() as { targetRole: PublicRole };
      currentRole = body.targetRole;
      contextVersion += 1;
      csrfToken = `csrf-context-version-${contextVersion}-token-value`;
      if (request.headers()["x-test-response-lost"] === "1") {
        await route.abort("failed");
        return;
      }
      if (request.headers()["x-test-result-unknown"] === "1") {
        await route.fulfill({
          json: {
            error: {
              code: "ROLE_CONTEXT_SWITCH_FAILED",
              message: "角色切换结果未确认；请刷新到服务端当前角色。",
              requestId: "00000000-0000-4000-8000-000000000302",
            },
          },
          status: 503,
        });
        return;
      }
      await route.fulfill({
        json: roleContext(
          currentRole,
          contextVersion,
          csrfToken,
          businessTime,
          advancedMilliseconds,
        ),
        status: 200,
      });
      return;
    }

    if (pathname.endsWith("/refresh")) {
      const refresh = request.postDataJSON() as {
        mode: "canonical" | "switch-outcome-unknown";
        pageContextVersion?: number;
      };
      expect(refresh.mode).toMatch(/canonical|switch-outcome-unknown/u);
      if (refresh.mode === "switch-outcome-unknown") {
        expect(refresh.pageContextVersion).toEqual(expect.any(Number));
      }
    }

    if (!hasSession) {
      await route.fulfill({
        json: {
          error: {
            code: "ROLE_CONTEXT_REQUIRED",
            message: "演示角色上下文已失效，请返回公开入口重新选择。",
            requestId: "00000000-0000-4000-8000-000000000301",
          },
        },
        status: 401,
      });
      return;
    }
    await route.fulfill({
      json: roleContext(
        currentRole,
        contextVersion,
        csrfToken,
        businessTime,
        advancedMilliseconds,
      ),
      status: 200,
    });
  };
  await context.route("**/api/v1/demo/context", serveContext);
  await context.route("**/api/v1/demo/context/refresh", serveContext);
  await context.route("**/api/v1/demo/context/switch", serveContext);
  await context.route("**/api/v1/demo/time", async (route) => {
    const current = new Date(businessTime);
    const halfHour = new Date(current.getTime() + 30 * 60_000).toISOString();
    const nextEvent = new Date(current.getTime() + 15 * 60_000).toISOString();
    await route.fulfill({
      json: {
        status: "ready",
        clock: {
          advanceLimitMilliseconds: 86_400_000,
          advancedMilliseconds,
          currentTime: businessTime,
          remainingAdvanceMilliseconds: 86_400_000 - advancedMilliseconds,
          timeZone: "Asia/Shanghai",
        },
        halfHour: {
          afterTime: halfHour,
          impacts: [{ count: 2, kind: "pending-order-expiration" }],
        },
        nextEvent: {
          afterTime: nextEvent,
          impacts: [{ count: 1, kind: "reservation-no-show" }],
        },
      },
      status: 200,
    });
  });
  await context.route("**/api/v1/demo/time/advance", async (route) => {
    const request = route.request();
    expect(request.headers()["x-csrf-token"]).toBe(csrfToken);
    expect(request.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/u);
    if (request.headers()["x-test-advance-failed"] === "1") {
      await route.fulfill({
        json: {
          error: {
            code: "DEMO_TIME_ADVANCE_FAILED",
            message:
              "到期处理未能全部完成，时钟和业务状态均未改变；可以安全重试。",
            requestId: "00000000-0000-4000-8000-000000000505",
          },
        },
        status: 503,
      });
      return;
    }
    const body = request.postDataJSON() as {
      mode: "half-hour" | "next-event";
    };
    const beforeTime = businessTime;
    const advanceBy = body.mode === "half-hour" ? 30 * 60_000 : 15 * 60_000;
    businessTime = new Date(
      new Date(businessTime).getTime() + advanceBy,
    ).toISOString();
    advancedMilliseconds += advanceBy;
    await route.fulfill({
      json: {
        status: "advanced",
        replayed: false,
        mode: body.mode,
        beforeTime,
        afterTime: businessTime,
        clock: {
          advanceLimitMilliseconds: 86_400_000,
          advancedMilliseconds,
          remainingAdvanceMilliseconds: 86_400_000 - advancedMilliseconds,
          timeZone: "Asia/Shanghai",
        },
        impacts:
          body.mode === "half-hour"
            ? [{ count: 2, kind: "pending-order-expiration" }]
            : [{ count: 1, kind: "reservation-no-show" }],
      },
      status: 200,
    });
  });
  await context.route("**/api/v1/demo/reset", async (route) => {
    const request = route.request();
    expect(request.headers()["x-csrf-token"]).toBe(csrfToken);
    expect(request.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/u);
    if (request.headers()["x-test-reset-failed"] === "1") {
      await route.fulfill({
        json: {
          error: {
            code: "SANDBOX_RESET_FAILED",
            message: "全新沙箱创建失败，当前沙箱仍完整保留；可以安全重试。",
            requestId: "00000000-0000-4000-8000-000000000506",
          },
        },
        status: 503,
      });
      return;
    }
    currentRole = "customer";
    contextVersion = 1;
    csrfToken = "csrf-reset-sandbox-version-1-token-value";
    businessTime = "2026-08-09T11:30:00.000Z";
    advancedMilliseconds = 0;
    await route.fulfill({
      json: {
        status: "ready",
        replayed: false,
        previousSandboxInvalidated: true,
        result: {
          targetRole: "customer",
          persona: { displayName: "林澈" },
          sandbox: {
            ...roleContext(
              currentRole,
              contextVersion,
              csrfToken,
              businessTime,
              advancedMilliseconds,
            ).sandbox,
          },
        },
        context: roleContext(
          currentRole,
          contextVersion,
          csrfToken,
          businessTime,
          advancedMilliseconds,
        ),
      },
      status: 201,
    });
  });
});

async function enterStaffShell(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /进入店员演示/u }).click();
  await expect(
    page.getByRole("heading", { name: "沙箱已准备完成" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "进入店员视图" }).click();
  await expect(page.getByRole("heading", { name: "现场脉冲" })).toBeVisible();
}

test("shared shell exposes the signed persona, role, scope, lifecycle, and freshness", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await enterStaffShell(page);

  await expect(page.getByText("演示数据", { exact: true })).toBeVisible();
  await expect(
    page.getByText("周宁 · 虚构人物", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("店员｜棱镜旗舰店", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("沙箱到期", { exact: true })).toBeVisible();
  await expect(page.getByText("手动刷新", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "现在" })
      .getByText("界面参考数据 · 业务写入待接线"),
  ).toBeVisible();
  for (const nav of [
    "工作台",
    "预约",
    "商品订单",
    "报修",
    "库存",
    "班次与交接",
  ]) {
    await expect(
      page.getByRole("button", { name: nav, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: /林澈.*查看任务/u }).click();
  await expect(
    page.getByText("当前为界面参考任务；服务端办理到店由 ticket 09 接入。"),
  ).toBeVisible();

  const roleTrigger = page.getByRole("button", { name: "切换角色" });
  await roleTrigger.click();
  await expect(
    page.getByRole("heading", { name: "切换演示角色" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "关闭角色切换" }),
  ).toBeFocused();
  for (const target of [
    "顾客 林澈 · 虚构人物 浏览三店 · 只管理自己的记录",
    "店员 周宁 · 虚构人物 棱镜旗舰店 当前角色",
    "店长 许知远 · 虚构人物 棱镜旗舰店",
    "总部运营 沈微 · 虚构人物 固定三店",
  ]) {
    await expect(page.getByRole("button", { name: target })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(roleTrigger).toBeFocused();
});

test("narrow workbench collapses the inspector without clipping the primary surface", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await enterStaffShell(page);
  await expect(
    page.getByRole("complementary", { name: "当前选中对象" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 883, height: 866 });

  await expect(
    page.getByRole("complementary", { name: "当前选中对象" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "展开当前对象" }),
  ).toBeVisible();

  const layout = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".role-workbench-main");
    const primary = document.querySelector<HTMLElement>(
      ".role-queue-row.is-primary",
    );
    const summary = document.querySelector<HTMLElement>(
      ".role-summary-stack button",
    );

    return {
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      mainWidth: main?.getBoundingClientRect().width ?? 0,
      primaryClientWidth: primary?.clientWidth ?? 0,
      primaryScrollWidth: primary?.scrollWidth ?? 0,
      primaryWidth: primary?.getBoundingClientRect().width ?? 0,
      summaryHeight: summary?.getBoundingClientRect().height ?? 0,
    };
  });

  expect(layout.bodyScrollWidth).toBe(layout.bodyClientWidth);
  expect(layout.primaryScrollWidth).toBe(layout.primaryClientWidth);
  expect(layout.mainWidth).toBeGreaterThan(layout.primaryWidth);
  expect(layout.summaryHeight).toBeLessThan(80);

  await page.setViewportSize({ width: 452, height: 413 });
  const compactLayout = await page.evaluate(() => {
    const title = document.querySelector<HTMLElement>(".role-page-title h1");
    const expand = document.querySelector<HTMLElement>(
      ".role-page-tools > button",
    );
    const primary = document.querySelector<HTMLElement>(
      ".role-queue-row.is-primary",
    );

    return {
      expandHeight: expand?.getBoundingClientRect().height ?? 0,
      primaryClientWidth: primary?.clientWidth ?? 0,
      primaryHeight: primary?.getBoundingClientRect().height ?? 0,
      primaryScrollWidth: primary?.scrollWidth ?? 0,
      titleHeight: title?.getBoundingClientRect().height ?? 0,
    };
  });

  expect(compactLayout.primaryScrollWidth).toBe(
    compactLayout.primaryClientWidth,
  );
  expect(compactLayout.primaryHeight).toBeGreaterThan(130);
  expect(compactLayout.primaryHeight).toBeLessThan(180);
  expect(compactLayout.expandHeight).toBeLessThan(50);
  expect(compactLayout.titleHeight).toBeLessThan(40);

  await page.setViewportSize({ width: 366, height: 866 });
  const compactSummary = await page.evaluate(() => {
    const summary = document.querySelector<HTMLElement>(
      ".role-summary-stack button",
    );
    const summaryText = summary?.querySelector<HTMLElement>("span");

    return {
      summaryClientWidth: summary?.clientWidth ?? 0,
      summaryHeight: summary?.getBoundingClientRect().height ?? 0,
      summaryScrollWidth: summary?.scrollWidth ?? 0,
      summaryTextDisplay: summaryText
        ? getComputedStyle(summaryText).display
        : "",
    };
  });

  expect(compactSummary.summaryTextDisplay).toBe("none");
  expect(compactSummary.summaryHeight).toBeLessThan(80);
  expect(compactSummary.summaryScrollWidth).toBe(
    compactSummary.summaryClientWidth,
  );

  await page.getByRole("button", { name: "展开当前对象" }).click();
  await expect(
    page.getByRole("complementary", { name: "当前选中对象" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "现场脉冲" })).toBeVisible();
});

test("narrow role switch dialog follows the single-column design", async ({
  page,
}) => {
  await page.setViewportSize({ width: 407, height: 866 });
  await enterStaffShell(page);
  await page.getByRole("button", { name: /打开角色切换/u }).click();

  await expect(
    page.getByRole("heading", { name: "切换演示角色" }),
  ).toBeVisible();

  const layout = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>(".role-switch-dialog");
    const grid = document.querySelector<HTMLElement>(".shell-role-grid");
    const cards = Array.from(
      grid?.querySelectorAll<HTMLElement>("button") ?? [],
    );
    const dialogRect = dialog?.getBoundingClientRect();

    return {
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      cardHeights: cards.map((card) => card.getBoundingClientRect().height),
      cardWidths: cards.map((card) => card.getBoundingClientRect().width),
      cardXs: cards.map((card) => card.getBoundingClientRect().x),
      dialogClientHeight: dialog?.clientHeight ?? 0,
      dialogHeight: dialogRect?.height ?? 0,
      dialogWidth: dialogRect?.width ?? 0,
      gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns : "",
    };
  });

  expect(layout.bodyScrollWidth).toBe(layout.bodyClientWidth);
  expect(layout.dialogWidth).toBeGreaterThan(370);
  expect(layout.dialogWidth).toBeLessThanOrEqual(383);
  expect(layout.dialogHeight).toBeLessThanOrEqual(842);
  expect(layout.dialogClientHeight).toBeGreaterThan(650);
  expect(layout.cardWidths).toHaveLength(4);
  expect(new Set(layout.cardXs).size).toBe(1);
  expect(layout.cardWidths.every((width) => width > 330)).toBe(true);
  expect(layout.cardHeights.every((height) => height >= 110)).toBe(true);
  expect(layout.cardHeights.every((height) => height < 130)).toBe(true);
  expect(layout.gridColumns.split(" ")).toHaveLength(1);

  await page.getByRole("button", { name: "关闭角色切换" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("business-time tool previews impacts and commits the clock atomically", async ({
  context,
  page,
}) => {
  await enterStaffShell(page);
  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await expect(
    otherTab.getByRole("button", {
      name: /打开业务时间工具，当前 19:30/u,
    }),
  ).toBeVisible();
  const otherTabFilter = otherTab.getByRole("searchbox", {
    name: "筛选当前队列",
  });
  await otherTabFilter.fill("林澈");

  const timeTrigger = page.getByRole("button", {
    name: /打开业务时间工具/u,
  });
  await expect(timeTrigger).toHaveAttribute("aria-label", /当前 19:30/u);
  await timeTrigger.click();
  await expect(
    page.getByRole("heading", { name: "选择业务时间推进方式" }),
  ).toBeVisible();
  await expect(
    page.getByText("真实服务器时间、TTL、验证码", { exact: false }),
  ).toBeVisible();

  await page.getByRole("button", { name: /向前推进 30 分钟/u }).click();
  await expect(page.getByText(/19:30.*20:00/u).first()).toBeVisible();
  await expect(page.getByText("待支付订单过期")).toBeVisible();
  await expect(page.getByText("2 项")).toBeVisible();
  await page.getByRole("button", { name: "查看推进影响" }).click();

  await expect(
    page.getByRole("heading", { name: "确认业务时间与到期影响" }),
  ).toBeVisible();
  await expect(page.getByText("真实服务器时间保持不变。")).toBeVisible();
  await page.getByRole("button", { name: "确认并原子推进" }).click();

  await expect(
    page.getByRole("heading", { name: "业务时间已完整推进" }),
  ).toBeVisible();
  await expect(page.getByText("已处理到期对象")).toBeVisible();
  await page.getByRole("button", { name: "返回当前角色" }).click();
  await expect(
    page.getByRole("button", { name: /打开业务时间工具，当前 20:00/u }),
  ).toBeVisible();
  await expect(
    otherTab.getByRole("button", {
      name: /打开业务时间工具，当前 20:00/u,
    }),
  ).toBeVisible();
  await expect(otherTabFilter).toHaveValue("林澈");
  await expect(timeTrigger).toBeFocused();
});

test("failed time transaction keeps the old clock and safely retries one request", async ({
  page,
}) => {
  await enterStaffShell(page);
  let firstAttempt = true;
  await page.route("**/api/v1/demo/time/advance", async (route) => {
    if (firstAttempt) {
      firstAttempt = false;
      await route.fallback({
        headers: {
          ...route.request().headers(),
          "x-test-advance-failed": "1",
        },
      });
      return;
    }
    await route.fallback();
  });

  await page
    .getByRole("button", { name: /打开业务时间工具，当前 19:30/u })
    .click();
  await page.getByRole("button", { name: /向前推进 30 分钟/u }).click();
  await page.getByRole("button", { name: "查看推进影响" }).click();
  await page.getByRole("button", { name: "确认并原子推进" }).click();

  await expect(
    page.getByText("时钟和业务状态均未改变；可以安全重试。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "使用同一请求安全重试" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "使用同一请求安全重试" }).click();
  await expect(
    page.getByRole("heading", { name: "业务时间已完整推进" }),
  ).toBeVisible();
});

test("business-time tool explains the exact 24-hour cap", async ({ page }) => {
  await enterStaffShell(page);
  await page.route("**/api/v1/demo/time", async (route) => {
    await route.fulfill({
      json: {
        status: "ready",
        clock: {
          advanceLimitMilliseconds: 86_400_000,
          advancedMilliseconds: 86_400_000,
          currentTime: "2026-08-10T11:30:00.000Z",
          remainingAdvanceMilliseconds: 0,
          timeZone: "Asia/Shanghai",
        },
        halfHour: { afterTime: null, impacts: [] },
        nextEvent: null,
      },
      status: 200,
    });
  });

  await page.getByRole("button", { name: /打开业务时间工具/u }).click();
  await expect(
    page.getByRole("heading", { name: "已达到本沙箱的推进上限" }),
  ).toBeVisible();
  await expect(
    page.getByText("累计业务时间最多可向前推进 24 小时"),
  ).toBeVisible();
  await expect(
    page.getByText("如需从标准故事起点重新演示，请关闭后使用顶栏“重置沙箱”。"),
  ).toBeVisible();
});

test("sandbox reset requires two confirmations and invalidates old tabs", async ({
  context,
  page,
}) => {
  await enterStaffShell(page);
  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await expect(
    otherTab.getByRole("heading", { name: "现场脉冲" }),
  ).toBeVisible();

  const resetTrigger = page.getByRole("button", {
    name: "重置为全新标准沙箱",
  });
  await resetTrigger.click();
  await expect(
    page.getByRole("heading", {
      name: "重置会替换四个角色的整条演示故事",
    }),
  ).toBeVisible();
  for (const role of ["顾客", "店员", "店长", "总部运营"]) {
    await expect(page.getByText(role, { exact: true }).last()).toBeVisible();
  }
  await page.getByRole("button", { name: "继续二次确认" }).click();
  const confirmation = page.getByRole("checkbox", {
    name: /我了解顾客、店员、店长与总部运营/u,
  });
  await expect(
    page.getByRole("button", { name: "创建新沙箱并使旧沙箱失效" }),
  ).toBeDisabled();
  await confirmation.check();
  await page.getByRole("button", { name: "创建新沙箱并使旧沙箱失效" }).click();

  await expect(
    page.getByRole("heading", { name: "全新标准沙箱已就绪" }),
  ).toBeVisible();
  const staleBlock = otherTab.getByRole("alertdialog", {
    name: "当前标签的旧沙箱已失效",
  });
  await expect(staleBlock).toBeVisible();
  await expect(
    staleBlock.getByText("旧沙箱中的四角色对象和写操作均已停止"),
  ).toBeVisible();
  await staleBlock.getByRole("button", { name: "进入全新标准沙箱" }).click();
  await expect(
    otherTab.getByRole("button", {
      name: "林澈 顾客 浏览三店 · 只管理自己的记录，打开角色切换",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "回到主演示起点" }).click();
  await expect(
    page.getByRole("button", {
      name: "林澈 顾客 浏览三店 · 只管理自己的记录，打开角色切换",
    }),
  ).toBeVisible();
  await expect(resetTrigger).toBeFocused();
});

test("failed sandbox reset preserves the old story and retries safely", async ({
  page,
}) => {
  await enterStaffShell(page);
  let firstAttempt = true;
  await page.route("**/api/v1/demo/reset", async (route) => {
    if (firstAttempt) {
      firstAttempt = false;
      await route.fallback({
        headers: {
          ...route.request().headers(),
          "x-test-reset-failed": "1",
        },
      });
      return;
    }
    await route.fallback();
  });

  await page.getByRole("button", { name: "重置为全新标准沙箱" }).click();
  await page.getByRole("button", { name: "继续二次确认" }).click();
  await page
    .getByRole("checkbox", {
      name: /我了解顾客、店员、店长与总部运营/u,
    })
    .check();
  await page.getByRole("button", { name: "创建新沙箱并使旧沙箱失效" }).click();

  await expect(
    page.getByText("全新沙箱创建失败，当前沙箱仍完整保留"),
  ).toBeVisible();
  await expect(
    page.locator('button[aria-label="周宁 店员 棱镜旗舰店，打开角色切换"]'),
  ).toBeAttached();
  await page.getByRole("button", { name: "安全重试创建新沙箱" }).click();
  await expect(
    page.getByRole("heading", { name: "全新标准沙箱已就绪" }),
  ).toBeVisible();
});

test("dirty queue input requires confirmation and keyboard switching rotates the visible context", async ({
  page,
}) => {
  await enterStaffShell(page);
  const queueFilter = page.getByRole("searchbox", { name: "筛选当前队列" });
  await queueFilter.fill("林澈");
  await page.getByRole("button", { name: "切换角色" }).click();
  const managerTarget = page.getByRole("button", {
    name: "店长 许知远 · 虚构人物 棱镜旗舰店",
  });
  await managerTarget.focus();
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: "放弃未提交输入并切换？" }),
  ).toBeVisible();
  await expect(
    page.getByText("继续切换会放弃“筛选当前队列”中的输入"),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回继续编辑" }).click();
  await expect(managerTarget).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "放弃输入并切换到店长" }).click();

  await expect(
    page.getByRole("button", {
      name: "许知远 店长 棱镜旗舰店，打开角色切换",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("店长｜棱镜旗舰店", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "经营看板" })).toBeVisible();
  await expect(queueFilter).toHaveCount(0);
});

test("a role switch in another tab immediately blocks the stale shell until refresh", async ({
  context,
  page,
}) => {
  await enterStaffShell(page);
  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await expect(
    otherTab.getByRole("heading", { name: "现场脉冲" }),
  ).toBeVisible();

  await otherTab.getByRole("button", { name: "切换角色" }).click();
  await otherTab
    .getByRole("button", { name: "店长 许知远 · 虚构人物 棱镜旗舰店" })
    .click();
  await expect(
    otherTab.getByRole("button", {
      name: "许知远 店长 棱镜旗舰店，打开角色切换",
    }),
  ).toBeVisible();

  const staleBlock = page.getByRole("alertdialog", {
    name: "当前标签的角色上下文已失效",
  });
  await expect(staleBlock).toBeVisible();
  await expect(
    staleBlock.getByText("旧角色写操作已停止，不能使用缓存继续提交。"),
  ).toBeVisible();
  const staleRefresh = staleBlock.getByRole("button", {
    name: "刷新到当前角色",
  });
  await expect(staleRefresh).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(staleRefresh).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(staleRefresh).toBeFocused();
  await staleRefresh.click();
  await expect(staleBlock).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "许知远 店长 棱镜旗舰店，打开角色切换",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "切换角色" })).toBeFocused();

  await otherTab.getByRole("button", { name: "切换角色" }).click();
  await otherTab
    .getByRole("button", { name: "总部运营 沈微 · 虚构人物 固定三店" })
    .click();
  await expect(
    otherTab.getByRole("button", {
      name: "沈微 总部运营 固定三店，打开角色切换",
    }),
  ).toBeVisible();
});

test("a lost switch response blocks the shell and recovers the server-current role", async ({
  page,
}) => {
  await enterStaffShell(page);
  await page.route("**/api/v1/demo/context/switch", async (route) => {
    await route.fallback({
      headers: {
        ...route.request().headers(),
        "x-test-response-lost": "1",
      },
    });
  });

  await page.getByRole("button", { name: "切换角色" }).click();
  await page
    .getByRole("button", { name: "店长 许知远 · 虚构人物 棱镜旗舰店" })
    .click();

  const staleBlock = page.getByRole("alertdialog", {
    name: "当前标签的角色上下文已失效",
  });
  await expect(staleBlock).toBeVisible();
  await staleBlock.getByRole("button", { name: "刷新到当前角色" }).click();
  await expect(staleBlock).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "许知远 店长 棱镜旗舰店，打开角色切换",
    }),
  ).toBeVisible();
});

test("an uncertain switch response uses the same blocking recovery path", async ({
  page,
}) => {
  await enterStaffShell(page);
  await page.route("**/api/v1/demo/context/switch", async (route) => {
    await route.fallback({
      headers: {
        ...route.request().headers(),
        "x-test-result-unknown": "1",
      },
    });
  });

  await page.getByRole("button", { name: "切换角色" }).click();
  await page
    .getByRole("button", { name: "店长 许知远 · 虚构人物 棱镜旗舰店" })
    .click();
  const staleBlock = page.getByRole("alertdialog", {
    name: "当前标签的角色上下文已失效",
  });
  await expect(staleBlock).toBeVisible();
  await staleBlock.getByRole("button", { name: "刷新到当前角色" }).click();
  await expect(
    page.getByRole("button", {
      name: "许知远 店长 棱镜旗舰店，打开角色切换",
    }),
  ).toBeVisible();
});

test("an unavailable sandbox returns the shell to the public role entry", async ({
  page,
}) => {
  await enterStaffShell(page);
  await page.route("**/api/v1/demo/context/switch", async (route) => {
    await route.fallback({
      headers: {
        ...route.request().headers(),
        "x-test-context-unavailable": "1",
      },
    });
  });

  await page.getByRole("button", { name: "切换角色" }).click();
  await page
    .getByRole("button", { name: "店长 许知远 · 虚构人物 棱镜旗舰店" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "从一次预约，看见四个角色如何共同经营。",
    }),
  ).toBeVisible();
});

test("an expired role session returns the shell to the public role entry", async ({
  page,
}) => {
  await enterStaffShell(page);
  await page.route("**/api/v1/demo/context/switch", async (route) => {
    await route.fallback({
      headers: {
        ...route.request().headers(),
        "x-test-context-required": "1",
      },
    });
  });

  await page.getByRole("button", { name: "切换角色" }).click();
  await page
    .getByRole("button", { name: "店长 许知远 · 虚构人物 棱镜旗舰店" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "从一次预约，看见四个角色如何共同经营。",
    }),
  ).toBeVisible();
});

test("an expired role session discovered by manual GET refresh returns to the public entry", async ({
  page,
}) => {
  await enterStaffShell(page);
  await page.route("**/api/v1/demo/context", async (route) => {
    await route.fallback({
      headers: {
        ...route.request().headers(),
        "x-test-context-required": "1",
      },
    });
  });

  await page.getByRole("button", { name: "手动刷新角色上下文" }).click();
  await expect(
    page.getByRole("heading", {
      name: "从一次预约，看见四个角色如何共同经营。",
    }),
  ).toBeVisible();
});

test("an expired role session discovered during stale recovery returns to the public entry", async ({
  page,
}) => {
  await enterStaffShell(page);
  await page.route("**/api/v1/demo/context/refresh", async (route) => {
    await route.fallback({
      headers: {
        ...route.request().headers(),
        "x-test-context-required": "1",
      },
    });
  });
  await page.evaluate(() => {
    const channel = new BroadcastChannel("jingshu-role-context-v1");
    channel.postMessage({ contextVersion: 2 });
    channel.close();
  });

  const staleBlock = page.getByRole("alertdialog", {
    name: "当前标签的角色上下文已失效",
  });
  await expect(staleBlock).toBeVisible();
  await staleBlock.getByRole("button", { name: "刷新到当前角色" }).click();
  await expect(
    page.getByRole("heading", {
      name: "从一次预约，看见四个角色如何共同经营。",
    }),
  ).toBeVisible();
});

test("1024 layout collapses navigation without hiding the current role or primary work", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await enterStaffShell(page);
  const sidebar = page.getByTestId("role-sidebar");
  await expect(sidebar).toHaveCSS("width", "72px");
  await expect(
    page.getByText("周宁 · 虚构人物", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "现场脉冲" })).toBeVisible();
  await expect(page.getByRole("button", { name: "切换角色" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /折叠导航|展开导航/u }),
  ).toBeHidden();
});
