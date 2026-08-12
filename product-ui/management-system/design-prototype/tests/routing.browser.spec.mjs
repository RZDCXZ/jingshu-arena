import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const prototypeRoot = fileURLToPath(new URL("..", import.meta.url));

for (const viewport of [
  { height: 1024, label: "1440x1024", width: 1440 },
  { height: 768, label: "1024x768", width: 1024 },
]) {
  test(`tracer route history and refresh stay synchronized at ${viewport.label}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const consoleProblems = [];
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        consoleProblems.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => consoleProblems.push(error.message));

    await page.goto("/staff/workbench?demoStep=6&permission=admin");
    await expect(page).toHaveURL(/\/staff\/workbench\?demoStep=6$/);
    await expect(page).toHaveTitle("工作台｜棱镜场馆演示");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("工作台");
    await expect(
      page.locator('nav[aria-label="店员导航"] a[aria-current="page"]'),
    ).toHaveText("工作台");

    await page.screenshot({
      fullPage: true,
      path: `${prototypeRoot}/design/implementation-web-url-routing-02-workbench-${viewport.label}.png`,
    });

    const orderLink = page.locator('nav[aria-label="店员导航"] a', {
      hasText: "商品订单",
    });
    await expect(orderLink).toHaveAttribute(
      "href",
      "/staff/orders/all?demoStep=6",
    );
    await orderLink.click();
    await expect(page).toHaveURL(/\/staff\/orders\/all\?demoStep=6$/);
    await expect(page).toHaveTitle("商品订单｜棱镜场馆演示");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "商品订单",
    );
    await expect(page.getByRole("tab", { name: /全部订单/ })).toHaveAttribute(
      "href",
      "/staff/orders/all?demoStep=6",
    );
    await expect(page.getByRole("tab", { name: /全部订单/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.reload();
    await expect(page).toHaveURL(/\/staff\/orders\/all\?demoStep=6$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "商品订单",
    );

    await page.goBack();
    await expect(page).toHaveURL(/\/staff\/workbench\?demoStep=6$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("工作台");

    await page.goForward();
    await expect(page).toHaveURL(/\/staff\/orders\/all\?demoStep=6$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "商品订单",
    );

    await page.screenshot({
      fullPage: true,
      path: `${prototypeRoot}/design/implementation-web-url-routing-02-orders-${viewport.label}.png`,
    });

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
    expect(consoleProblems).toEqual([]);
  });
}

test("parent replacement and QA-only state remain compatible", async ({ page }) => {
  await page.setViewportSize({ height: 768, width: 1024 });
  await page.goto(
    "/staff/orders?demoStep=6&sandboxState=readonly&role=hq&storeCode=other",
  );

  await expect(page).toHaveURL(
    /\/staff\/orders\/all\?demoStep=6&sandboxState=readonly$/,
  );
  await expect(page.getByText("当前为只读标准快照")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "商品订单",
  );
});
