import { execFileSync } from "node:child_process";

const EXPECTED_NODE = "24.18.0";
const EXPECTED_PNPM = "9.15.9";

function readPnpmVersion() {
  const userAgent = process.env.npm_config_user_agent ?? "";
  const match = /\bpnpm\/(\d+\.\d+\.\d+)\b/u.exec(userAgent);

  if (match?.[1]) {
    return match[1];
  }

  return execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim();
}

const actualNode = process.versions.node;
const actualPnpm = readPnpmVersion();
const mismatches = [];

if (actualNode !== EXPECTED_NODE) {
  mismatches.push(`Node.js ${actualNode} (expected ${EXPECTED_NODE})`);
}

if (actualPnpm !== EXPECTED_PNPM) {
  mismatches.push(`pnpm ${actualPnpm} (expected ${EXPECTED_PNPM})`);
}

if (mismatches.length > 0) {
  throw new Error(
    `Toolchain mismatch: ${mismatches.join(", ")}. Use .node-version and Corepack before installing.`,
  );
}

console.log(`Toolchain verified: Node.js ${actualNode}, pnpm ${actualPnpm}.`);
