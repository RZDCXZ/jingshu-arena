import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { stores } from "../management-system/design-prototype/src/data.js";

const productUiRoot = fileURLToPath(new URL("..", import.meta.url));
const legacyPlaceNames = ["折线标准店", "启点新店", "澄江市"];
const ignoredDirectories = new Set(["design", "dist", "node_modules"]);
const textExtensions = new Set([".js", ".jsx", ".md", ".ts", ".tsx"]);

async function collectTextFiles(directory) {
  const files = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTextFiles(entryPath)));
    } else if (textExtensions.has(extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

test("跨端内容基线固定三家虚构门店的名称、规模与营业时间", () => {
  assert.deepEqual(
    stores.map(({ hours, label, name, seats }) => ({
      hours,
      label,
      name,
      seats,
    })),
    [
      {
        name: "棱镜旗舰店",
        label: "旗舰店",
        seats: 96,
        hours: "24 小时",
      },
      {
        name: "星桥标准店",
        label: "标准店",
        seats: 64,
        hours: "10:00–次日 02:00",
      },
      {
        name: "极点新店",
        label: "新店",
        seats: 40,
        hours: "12:00–24:00",
      },
    ],
  );
});

test("正式产品 UI 文本只使用栖光市和统一后的门店名称", async () => {
  const baseline = await readFile(join(productUiRoot, "README.md"), "utf8");
  assert.match(baseline, /虚构城市：栖光市。/u);
  assert.match(baseline, /棱镜旗舰店、星桥标准店、极点新店/u);

  for (const file of await collectTextFiles(productUiRoot)) {
    const source = await readFile(file, "utf8");
    for (const legacyName of legacyPlaceNames) {
      assert.equal(
        source.includes(legacyName),
        false,
        `${relative(productUiRoot, file)} 仍包含旧命名 ${legacyName}`,
      );
    }
  }
});
