import { readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const binaryExtensions = new Set([
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".lock",
  ".mp3",
  ".mp4",
  ".pdf",
  ".png",
  ".webp",
  ".woff",
  ".woff2",
]);
const findings = [];
const detectors = [
  {
    label: "private key",
    pattern: new RegExp(
      ["-----BEGIN ", "(?:RSA|OPENSSH|EC|DSA) PRIVATE KEY-----"].join(""),
      "u",
    ),
  },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/u },
  { label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/u },
  { label: "OpenAI token", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u },
  { label: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u },
  { label: "Chinese mobile number", pattern: /\b1[3-9]\d{9}\b/u },
  { label: "Chinese identity number", pattern: /\b\d{17}[\dXx]\b/u },
];

const listed = spawnSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" },
);

if (listed.status !== 0) {
  throw new Error(listed.stderr || "Unable to list repository files.");
}

for (const path of listed.stdout.split("\0").filter(Boolean)) {
  if (binaryExtensions.has(extname(path).toLowerCase())) {
    continue;
  }

  const contents = await readFile(join(root, path), "utf8").catch(
    () => undefined,
  );
  if (!contents || contents.includes("\0")) {
    continue;
  }

  for (const detector of detectors) {
    if (detector.pattern.test(contents)) {
      findings.push(`${path}: possible ${detector.label}`);
    }
  }

  const emailMatches = contents.matchAll(
    /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/giu,
  );
  for (const match of emailMatches) {
    const domain = match[1]?.toLowerCase();
    if (domain && !["example.com", "example.invalid"].includes(domain)) {
      findings.push(`${path}: possible personal email address`);
    }
  }
}

const environmentExamplePath = join(root, ".env.example");
const environmentExample = await readFile(environmentExamplePath, "utf8");
for (const line of environmentExample.split("\n")) {
  const assignment = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
  if (assignment) {
    const value = assignment[2] ?? "";
    if (!value.includes("<") || !value.includes(">")) {
      findings.push(
        `${relative(root, environmentExamplePath)}: ${assignment[1]} must use a placeholder value`,
      );
    }
  }
}

if (findings.length > 0) {
  throw new Error(`Sensitive-data check failed:\n${findings.join("\n")}`);
}

console.log("Secret, credential, and personal-data patterns not found.");
