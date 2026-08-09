import { expect, test } from "@playwright/test";

test("public entry explains the demo boundary and all four roles", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "竞枢 · Jingshu Arena" }),
  ).toBeVisible();
  await expect(page.getByText("全部内容均为演示数据")).toBeVisible();
  await expect(page.getByText("无需注册")).toBeVisible();
  await expect(page.getByText("模拟支付不会扣款")).toBeVisible();

  for (const role of ["顾客", "店员", "店长", "总部运营"]) {
    await expect(page.getByRole("heading", { name: role })).toBeVisible();
  }
});
