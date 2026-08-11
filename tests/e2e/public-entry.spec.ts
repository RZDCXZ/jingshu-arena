import { expect, test } from "@playwright/test";

const webOrigin = process.env.JINGSHU_E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";

const readyWorld = {
  status: "ready",
  replayed: false,
  role: "customer",
  persona: {
    displayName: "林澈",
    scope: "浏览三店 · 只管理自己的记录",
  },
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

const recoveredStaffContext = {
  status: "ready",
  csrfToken: "csrf-context-version-2-token-value",
  contextVersion: 2,
  role: { id: "staff", label: "店员" },
  persona: { displayName: "周宁", protected: true },
  storeScope: {
    kind: "store",
    label: "棱镜旗舰店",
    stores: [{ code: "prism-flagship", displayName: "棱镜旗舰店" }],
  },
  capabilities: ["store:perform-frontline"],
  sandbox: {
    schemaVersion: "4",
    seedVersion: "2026-08-09.1",
    expiresAt: "2026-08-10T12:00:00.000Z",
    businessClock: {
      advanceLimitMilliseconds: 86_400_000,
      advancedMilliseconds: 0,
      currentTime: "2026-08-09T11:30:00.000Z",
      remainingAdvanceMilliseconds: 86_400_000,
      timeZone: "Asia/Shanghai",
    },
  },
  freshness: {
    mode: "manual",
    observedAt: "2026-08-09T11:30:00.000Z",
  },
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/demo/context", async (route) => {
    await route.fulfill({
      json: {
        error: {
          code: "ROLE_CONTEXT_REQUIRED",
          message: "演示角色上下文已失效，请返回公开入口重新选择。",
          requestId: "00000000-0000-4000-8000-000000000300",
        },
      },
      status: 401,
    });
  });
  await page.route("**/api/v1/public/visitor", async (route) => {
    await route.fulfill({
      headers: {
        "set-cookie":
          "jingshu_visitor=test.payload; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax",
      },
      status: 204,
    });
  });
});

test("public entry explains every boundary without creating a sandbox", async ({
  page,
}) => {
  const creationRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/public/sandboxes")
    ) {
      creationRequests.push(request.url());
    }
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "从一次预约，看见四个角色如何共同经营。",
    }),
  ).toBeVisible();
  for (const boundary of [
    "虚构数据",
    "无需注册",
    "模拟支付不会扣款",
    "不连接真实设备",
  ]) {
    await expect(page.getByText(boundary).first()).toBeVisible();
  }

  for (const role of ["顾客", "店员", "店长", "总部运营"]) {
    await expect(
      page.getByRole("button", { name: new RegExp(`进入${role}演示`, "u") }),
    ).toBeVisible();
  }
  await expect(page.getByText("推荐起点", { exact: true })).toBeVisible();
  expect(creationRequests).toEqual([]);

  const readonlyTrigger = page.getByRole("button", { name: "只读了解" });
  await readonlyTrigger.click();
  await expect(
    page.getByRole("heading", { name: "先看清演示边界，再决定是否创建。" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "关闭只读了解" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "返回角色入口" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(readonlyTrigger).toBeFocused();
  expect(creationRequests).toEqual([]);
});

test("an unavailable context check serves the bundled seed snapshot until retry", async ({
  page,
}) => {
  let contextEnded = false;
  const creationRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/public/sandboxes")
    ) {
      creationRequests.push(request.url());
    }
  });
  await page.unroute("**/api/v1/demo/context");
  await page.route("**/api/v1/demo/context", async (route) => {
    if (!contextEnded) {
      await route.fulfill({
        json: {
          error: {
            code: "ROLE_CONTEXT_SERVICE_UNAVAILABLE",
            message: "角色上下文暂时无法读取，请稍后安全重试。",
            requestId: "00000000-0000-4000-8000-000000000305",
          },
        },
        status: 503,
      });
      return;
    }
    await route.fulfill({
      json: {
        error: {
          code: "ROLE_CONTEXT_REQUIRED",
          message: "演示角色上下文已失效，请返回公开入口重新选择。",
          requestId: "00000000-0000-4000-8000-000000000306",
        },
      },
      status: 401,
    });
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "服务暂时不可用，当前展示只读标准种子快照",
    }),
  ).toBeVisible();
  await expect(page.getByTestId("readonly-seed-snapshot")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "创建预约（只读）" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "推进业务时间（只读）" }),
  ).toBeDisabled();
  expect(creationRequests).toEqual([]);

  contextEnded = true;
  await page.getByRole("button", { name: "重新连接服务" }).click();
  await expect(
    page.getByRole("heading", {
      name: "从一次预约，看见四个角色如何共同经营。",
    }),
  ).toBeVisible();
  expect(creationRequests).toEqual([]);
});

test("a stale session on reload canonicalizes the server-current role", async ({
  page,
}) => {
  let canonicalRefreshes = 0;
  await page.unroute("**/api/v1/demo/context");
  await page.route("**/api/v1/demo/context", async (route) => {
    await route.fulfill({
      json: {
        error: {
          code: "ROLE_CONTEXT_STALE",
          message: "当前标签的旧角色上下文已失效，请刷新到当前角色。",
          requestId: "00000000-0000-4000-8000-000000000307",
        },
      },
      status: 409,
    });
  });
  await page.route("**/api/v1/demo/context/refresh", async (route) => {
    canonicalRefreshes += 1;
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toMatchObject({ mode: "canonical" });
    await route.fulfill({ json: recoveredStaffContext, status: 200 });
  });

  await page.goto("/");
  await expect(
    page.getByRole("button", {
      name: "周宁 店员 棱镜旗舰店，打开角色切换",
    }),
  ).toBeVisible();
  expect(canonicalRefreshes).toBeGreaterThan(0);
});

test("role selection shows creation progress and the versioned three-store world", async ({
  page,
}) => {
  let releaseCreation: (() => void) | undefined;
  const creationReleased = new Promise<void>((resolve) => {
    releaseCreation = resolve;
  });
  await page.route("**/api/v1/public/sandboxes", async (route) => {
    const request = route.request();
    expect(request.method()).toBe("POST");
    expect(request.headers().origin).toBe(webOrigin);
    expect(request.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/u);
    expect(request.postDataJSON()).toEqual({ role: "customer" });
    await creationReleased;
    await route.fulfill({ json: readyWorld, status: 201 });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /进入顾客演示/u }).click();

  await expect(
    page.getByRole("heading", { name: "正在准备顾客视图" }),
  ).toBeVisible();
  releaseCreation?.();
  await expect(
    page.getByRole("heading", { name: "沙箱已准备完成" }),
  ).toBeVisible();
  await expect(page.getByText("栖光市", { exact: true })).toBeVisible();
  for (const store of ["棱镜旗舰店", "星桥标准店", "极点新店"]) {
    await expect(page.getByText(store, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("Seed 2026-08-09.1")).toBeVisible();
  expect(page.url()).not.toMatch(/sandbox|token|session/iu);
});

test("failed creation keeps the same key for a safe retry", async ({
  page,
}) => {
  const creationKeys: string[] = [];
  let attempt = 0;
  await page.route("**/api/v1/public/sandboxes", async (route) => {
    attempt += 1;
    creationKeys.push(route.request().headers()["idempotency-key"] ?? "");
    if (attempt === 1) {
      await route.fulfill({
        json: {
          error: {
            code: "SANDBOX_CREATION_FAILED",
            message: "演示世界创建失败，未保存部分数据；你可以安全重试。",
            requestId: "00000000-0000-4000-8000-000000000012",
          },
        },
        status: 503,
      });
      return;
    }
    await route.fulfill({ json: readyWorld, status: 201 });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /进入顾客演示/u }).click();
  await expect(
    page.getByRole("heading", { name: "没有进入半成的演示世界" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "使用原请求安全重试" }).click();
  await expect(
    page.getByRole("heading", { name: "沙箱已准备完成" }),
  ).toBeVisible();
  expect(creationKeys).toHaveLength(2);
  expect(creationKeys[1]).toBe(creationKeys[0]);
});

test("rate-limited creation waits for Retry-After and retains its original key", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-08-09T11:30:00.000Z") });
  const creationKeys: string[] = [];
  let attempt = 0;
  await page.route("**/api/v1/public/sandboxes", async (route) => {
    attempt += 1;
    creationKeys.push(route.request().headers()["idempotency-key"] ?? "");
    if (attempt === 1) {
      await route.fulfill({
        headers: { "Retry-After": "2" },
        json: {
          error: {
            code: "SANDBOX_CREATION_RATE_LIMITED",
            message: "请求过于频繁，请在倒计时结束后安全重试。",
            requestId: "00000000-0000-4000-8000-000000000014",
          },
        },
        status: 429,
      });
      return;
    }
    await route.fulfill({ json: readyWorld, status: 201 });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /进入顾客演示/u }).click();

  await expect(
    page.getByRole("heading", { name: "请求过于频繁，暂不重复提交" }),
  ).toBeVisible();
  const retry = page.getByRole("button", { name: "使用原请求安全重试" });
  await expect(retry).toBeDisabled();
  await expect(page.getByText("2 秒后可重试")).toBeVisible();

  await page.clock.fastForward(2_000);
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(
    page.getByRole("heading", { name: "沙箱已准备完成" }),
  ).toBeVisible();
  expect(creationKeys).toHaveLength(2);
  expect(creationKeys[1]).toBe(creationKeys[0]);
});

test("timeout state does not claim success and offers the same safe retry", async ({
  page,
}) => {
  await page.route("**/api/v1/public/sandboxes", async (route) => {
    await route.fulfill({
      json: {
        error: {
          code: "SANDBOX_CREATION_TIMEOUT",
          message: "创建结果仍在确认中，请使用原请求重试。",
          requestId: "00000000-0000-4000-8000-000000000013",
        },
      },
      status: 504,
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /进入店员演示/u }).click();

  await expect(
    page.getByRole("heading", { name: "创建结果仍在确认中" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "使用原请求安全重试" }),
  ).toBeVisible();
  await expect(page.getByText("沙箱已准备完成")).toHaveCount(0);
});
