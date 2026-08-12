// @monkyesuite/api — HTTP API + auth boundary (Railway).
// Boots the Hono app and serves it on Node. Global read routes are live here;
// scoped/auth'd routes land with identity/access (specs/06). See app.ts.

import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const app = createApp();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `[api] listening on http://localhost:${info.port} (global reads)`,
  );
});
