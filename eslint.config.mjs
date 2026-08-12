import eslint from "@eslint/js";
import globals from "globals";
import typescriptEslint from "typescript-eslint";

export default typescriptEslint.config(
  {
    ignores: [
      ".scratch/**",
      "product-ui/**",
      "**/.next/**",
      "**/.next-demo-story*/**",
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  eslint.configs.recommended,
  ...typescriptEslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,mts,cts}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["apps/miniprogram/src/**/*.ts"],
    languageOptions: {
      globals: {
        App: "readonly",
        Component: "readonly",
        Page: "readonly",
        getApp: "readonly",
        wx: "readonly",
      },
    },
  },
  {
    files: ["packages/domain/src/**/*.{js,ts}"],
    rules: {
      "no-restricted-globals": [
        "error",
        "App",
        "Buffer",
        "Component",
        "Page",
        "document",
        "fetch",
        "getApp",
        "localStorage",
        "navigator",
        "process",
        "sessionStorage",
        "WebSocket",
        "window",
        "wx",
      ],
    },
  },
);
