import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.seed.test.ts", "packages/**/*.seed.test.ts"],
  },
});
