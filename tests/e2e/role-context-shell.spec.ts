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
      schemaVersion: "3",
      seedVersion: "2026-08-09.1",
      expiresAt: "2026-08-10T12:00:00.000Z",
    },
    freshness: {
      mode: "manual",
      observedAt: "2026-08-09T11:30:00.000Z",
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
      schemaVersion: "3",
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

  await context.route("**/api/v1/public/visitor", async (route) => {
    await route.fulfill({ status: 204 });
  });
  await context.route("**/api/v1/public/sandboxes", async (route) => {
    currentRole = route.request().postDataJSON().role as PublicRole;
    contextVersion = 1;
    csrfToken = "csrf-context-version-1-token-value";
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
        json: roleContext(currentRole, contextVersion, csrfToken),
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
      json: roleContext(currentRole, contextVersion, csrfToken),
      status: 200,
    });
  };
  await context.route("**/api/v1/demo/context", serveContext);
  await context.route("**/api/v1/demo/context/refresh", serveContext);
  await context.route("**/api/v1/demo/context/switch", serveContext);
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
