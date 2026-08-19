// Root Vitest config. Explicit on purpose: without it, Vitest resolves
// apps/web/vite.config.ts and the Cloudflare vite plugin refuses Vitest's
// SSR environment overrides, killing the whole run at startup. Tests here
// are pure node — no DOM, no worker runtime.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/api/src/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
    ],
    environment: "node",
  },
});
