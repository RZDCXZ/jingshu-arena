import { cp, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
const outputRoot = fileURLToPath(new URL("../dist", import.meta.url));
const typescriptCli = fileURLToPath(
  new URL("../../../node_modules/typescript/bin/tsc", import.meta.url),
);

await rm(outputRoot, { force: true, recursive: true });
await mkdir(outputRoot, { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    typescriptCli,
    "--project",
    `${packageRoot}/tsconfig.json`,
    "--noEmit",
    "false",
  ],
  { stdio: "inherit" },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

await cp(sourceRoot, outputRoot, {
  filter: (source) => !source.endsWith(".ts"),
  recursive: true,
});

const requiredFiles = [
  "app.js",
  "app.json",
  "app.wxss",
  "pages/index/index.js",
  "pages/index/index.json",
  "pages/index/index.wxml",
  "pages/index/index.wxss",
];

for (const requiredFile of requiredFiles) {
  const requiredPath = fileURLToPath(
    new URL(`../dist/${requiredFile}`, import.meta.url),
  );
  await import("node:fs/promises").then(({ access }) => access(requiredPath));
}

console.log(
  "Native WeChat mini-program build is ready in apps/miniprogram/dist.",
);
