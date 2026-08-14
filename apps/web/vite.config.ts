// TanStack Start (SSR) + Tailwind. Deployed to Cloudflare Workers; talks to the
// Railway API over HTTP only (never the DB). See specs/08-web.md, specs/10-deployment.md.

import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 3000 },
  // Plugin ORDER matters: cloudflare() must come before tanstackStart() so the
  // SSR environment it claims ("ssr") is the one Start builds its server entry
  // into. Build output is dist/client + dist/server; the Worker entry is the
  // virtual module @tanstack/react-start/server-entry named in wrangler.jsonc.
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});
