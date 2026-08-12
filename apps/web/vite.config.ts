// TanStack Start (SSR) + Tailwind. Deployed to Cloudflare; talks to the Railway
// API over HTTP only (never the DB). See specs/08-web.md.

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 3000 },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
});
