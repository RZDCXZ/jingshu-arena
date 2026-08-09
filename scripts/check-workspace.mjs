import { builtinModules } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const expectedPackages = new Map([
  ["@jingshu/web", "apps/web"],
  ["@jingshu/api", "apps/api"],
  ["@jingshu/miniprogram", "apps/miniprogram"],
  ["@jingshu/domain", "packages/domain"],
  ["@jingshu/contracts", "packages/contracts"],
  ["@jingshu/database", "packages/database"],
]);
const allowedInternalDependencies = new Map([
  ["@jingshu/domain", new Set()],
  ["@jingshu/contracts", new Set()],
  ["@jingshu/database", new Set(["@jingshu/contracts", "@jingshu/domain"])],
  [
    "@jingshu/api",
    new Set(["@jingshu/contracts", "@jingshu/database", "@jingshu/domain"]),
  ],
  ["@jingshu/web", new Set(["@jingshu/contracts"])],
  ["@jingshu/miniprogram", new Set(["@jingshu/contracts", "@jingshu/domain"])],
]);
const ignoredDirectories = new Set([".git", ".next", "dist", "node_modules"]);

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function collectFiles(directory, predicate) {
  const results = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(entryPath, predicate)));
    } else if (predicate(entryPath)) {
      results.push(entryPath);
    }
  }

  return results;
}

function internalPackageName(specifier) {
  return /^@jingshu\/[^/]+/u.exec(specifier)?.[0];
}

function importSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/gu,
    /\bimport\s*["']([^"']+)["']/gu,
    /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/gu,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) {
        specifiers.push(match[1]);
      }
    }
  }

  return specifiers;
}

const rootManifest = await readJson(join(root, "package.json"));
invariant(
  rootManifest.packageManager === "pnpm@9.15.9",
  "packageManager must be pnpm@9.15.9.",
);
invariant(
  rootManifest.engines?.node === "24.18.0",
  "Node.js must be pinned to 24.18.0.",
);
invariant(
  rootManifest.engines?.pnpm === "9.15.9",
  "pnpm engine must be pinned to 9.15.9.",
);

const workspaceDefinition = await readFile(
  join(root, "pnpm-workspace.yaml"),
  "utf8",
);
invariant(
  workspaceDefinition === "packages:\n  - apps/*\n  - packages/*\n",
  "pnpm-workspace.yaml must contain only apps/* and packages/*.",
);

const manifests = new Map();
for (const [expectedName, directory] of expectedPackages) {
  const manifest = await readJson(join(root, directory, "package.json"));
  invariant(
    manifest.name === expectedName,
    `${directory} must be named ${expectedName}.`,
  );
  manifests.set(expectedName, { directory, manifest });
}

const versionChecks = [
  [rootManifest, "devDependencies", "typescript", "6.0.3"],
  [rootManifest, "devDependencies", "@playwright/test", "1.62.1"],
  [manifests.get("@jingshu/web")?.manifest, "dependencies", "next", "16.3.0"],
  [manifests.get("@jingshu/web")?.manifest, "dependencies", "react", "19.2.8"],
  [
    manifests.get("@jingshu/web")?.manifest,
    "dependencies",
    "react-dom",
    "19.2.8",
  ],
  [manifests.get("@jingshu/api")?.manifest, "dependencies", "hono", "4.13.1"],
  [
    manifests.get("@jingshu/api")?.manifest,
    "dependencies",
    "@hono/node-server",
    "2.1.0",
  ],
  [
    manifests.get("@jingshu/database")?.manifest,
    "dependencies",
    "drizzle-orm",
    "0.45.2",
  ],
  [
    manifests.get("@jingshu/database")?.manifest,
    "devDependencies",
    "drizzle-kit",
    "0.31.10",
  ],
];

for (const [manifest, section, dependency, expectedVersion] of versionChecks) {
  invariant(
    manifest?.[section]?.[dependency] === expectedVersion,
    `${dependency} must be pinned to ${expectedVersion}.`,
  );
}

const strictConfig = await readJson(join(root, "tsconfig.base.json"));
for (const option of [
  "exactOptionalPropertyTypes",
  "forceConsistentCasingInFileNames",
  "noFallthroughCasesInSwitch",
  "noImplicitOverride",
  "noUncheckedIndexedAccess",
  "strict",
]) {
  invariant(
    strictConfig.compilerOptions?.[option] === true,
    `${option} must stay enabled.`,
  );
}

for (const [packageName, { directory, manifest }] of manifests) {
  const declared = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
  };
  const allowed = allowedInternalDependencies.get(packageName);

  for (const dependency of Object.keys(declared)) {
    if (dependency.startsWith("@jingshu/")) {
      invariant(
        allowed?.has(dependency),
        `${packageName} must not depend on ${dependency}.`,
      );
    }
  }

  const sourceDirectory = join(
    root,
    directory,
    packageName === "@jingshu/web" ? "app" : "src",
  );
  const sourceFiles = await collectFiles(sourceDirectory, (path) =>
    [".js", ".jsx", ".ts", ".tsx"].includes(extname(path)),
  );

  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, "utf8");
    for (const specifier of importSpecifiers(source)) {
      const internalDependency = internalPackageName(specifier);
      if (internalDependency) {
        invariant(
          allowed?.has(internalDependency),
          `${relative(root, sourceFile)} imports disallowed ${internalDependency}.`,
        );
      }

      if (packageName === "@jingshu/domain") {
        const rootSpecifier =
          specifier.replace(/^node:/u, "").split("/")[0] ?? specifier;
        const forbiddenRuntime =
          specifier.startsWith("node:") ||
          builtinModules.includes(rootSpecifier) ||
          /^(?:@hono\/node-server|drizzle-orm|hono|next|pg|react)(?:\/|$)/u.test(
            specifier,
          ) ||
          /(?:miniprogram|wechat|weixin|wx-server-sdk)/iu.test(specifier);
        invariant(
          !forbiddenRuntime,
          `${relative(root, sourceFile)} imports runtime-specific ${specifier}.`,
        );
      }
    }

    if (packageName === "@jingshu/domain") {
      invariant(
        !/\b(?:App|Component|Page|getApp|wx)\s*(?:\.|\()/u.test(source),
        `${relative(root, sourceFile)} uses a WeChat runtime global.`,
      );
    }
  }
}

const domainManifest = manifests.get("@jingshu/domain")?.manifest;
invariant(
  Object.keys(domainManifest?.dependencies ?? {}).length === 0,
  "@jingshu/domain must not have runtime dependencies.",
);

const lockfiles = await collectFiles(root, (path) =>
  path.endsWith("pnpm-lock.yaml"),
);
invariant(
  lockfiles.length === 1 && lockfiles[0] === join(root, "pnpm-lock.yaml"),
  "The repository must contain exactly one root pnpm-lock.yaml.",
);

console.log(
  "Workspace versions, module boundaries, strict TypeScript, and lockfile verified.",
);
