// Server-rendered HTML for /admin (specs/09 §9.0). No React, no bundle, no
// build step — the panel ships with the API.
//
// Escaping is the default and `raw()` is the only way out, so a value reaches
// the page unescaped exactly when someone wrote raw() and a reviewer can grep
// for it. On the highest-privilege surface, opt-out-by-marker beats
// escape-when-you-remember.

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/** Pre-rendered markup. The only value html`` will not escape. */
export class Raw {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export const raw = (value: string): Raw => new Raw(value);

type Renderable =
  | Raw
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly Renderable[];

function render(value: Renderable): string {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map((v) => render(v)).join("");
  return escapeHtml(String(value));
}

/** Tagged template that escapes every interpolation except Raw. */
export function html(
  strings: TemplateStringsArray,
  ...values: Renderable[]
): Raw {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    out += render(values[i]) + (strings[i + 1] ?? "");
  }
  return new Raw(out);
}

/* -------------------------------------------------------------------------- */
/*  Styles + the htmx-shaped runtime                                           */
/* -------------------------------------------------------------------------- */

// A strict CSP. /admin loads nothing off-origin: htmx is a vendored dependency
// served from this host, not a CDN <script> — on the most privileged surface in
// the system, a third party that can change its own bytes is a third party that
// can rewrite this page.
//
// script-src is 'self' ONLY: no inline script at all, so an injected <script>
// tag cannot execute even if escaping were bypassed somewhere. style-src keeps
// 'unsafe-inline' because the sparkline bar heights are per-datum style
// attributes; that is a rendering detail, and it grants no script execution.
export const CSP =
  "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
  "form-action 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'";

/**
 * Asset paths. Two forms on purpose: `href` is what the browser requests
 * (absolute, since fragments are swapped into pages at any depth), while
 * `route` is what the router registers — the admin app is MOUNTED at /admin, so
 * its own routes must not repeat the prefix.
 */
export const ASSETS = {
  htmx: { href: "/admin/assets/htmx.js", route: "/assets/htmx.js" },
  css: { href: "/admin/assets/admin.css", route: "/assets/admin.css" },
  js: { href: "/admin/assets/admin.js", route: "/assets/admin.js" },
  authJs: { href: "/admin/assets/auth.js", route: "/assets/auth.js" },
} as const;

export const STYLES = `
:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--fg:#d7dce5;--dim:#8b93a5;
--ok:#3ba55d;--warn:#d9a441;--bad:#e0533d;--accent:#5b8def}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
header{padding:12px 20px;border-bottom:1px solid var(--line);display:flex;gap:16px;align-items:baseline}
header h1{font-size:15px;margin:0;letter-spacing:.06em;text-transform:uppercase}
header .who{color:var(--dim);font-size:12px;margin-left:auto}
main{padding:20px;display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(440px,1fr))}
section{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:14px}
section h2{font-size:12px;margin:0 0 4px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
.note{color:var(--dim);font-size:11.5px;margin:0 0 10px}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th,td{text-align:left;padding:3px 8px 3px 0;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--dim);font-weight:400;font-size:11px;text-transform:uppercase}
td.num,th.num{text-align:right}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.dim{color:var(--dim)}
.big{font-size:22px;line-height:1.2}
.spark{display:flex;align-items:flex-end;gap:1px;height:34px;margin:8px 0}
.spark i{flex:1 1 auto;min-width:1px;background:var(--ok);display:block}
.spark i.warn{background:var(--warn)}.spark i.bad{background:var(--bad)}
form{display:inline-flex;gap:6px;align-items:center;margin:2px 0}
input,select,button{font:inherit;font-size:12px;background:#0c0e13;color:var(--fg);
border:1px solid var(--line);border-radius:4px;padding:4px 7px}
button{cursor:pointer;border-color:var(--accent);color:#cfe0ff}
button.danger{border-color:var(--bad);color:#ffd2c9}
.err{color:var(--bad);white-space:pre-wrap;font-size:11.5px}
.flash{margin:8px 0 0;font-size:12px}
.wide{grid-column:1/-1}
.scroll{overflow-x:auto}
`;

// Companion script for htmx — served as a file, never inline (script-src 'self').
//
// htmx handles the panels natively: hx-get + hx-trigger="load, every 30s" for
// the self-refreshing fragments, hx-post on forms, hx-confirm on the
// destructive ones. The one thing it will not decide for us is what a 401
// means: on an error response htmx does not swap, so without this the panel
// would sit silently on a stale fragment after a session expires. Here a 401
// follows the HX-Redirect the gate sent (§9.2) and goes to the login page.
export const ADMIN_JS = `
document.body.addEventListener('htmx:responseError', (evt) => {
  const xhr = evt.detail.xhr;
  if (xhr.status === 401) {
    const to = xhr.getResponseHeader('HX-Redirect');
    if (to) { window.location.href = to; return; }
  }
  const target = evt.detail.target;
  if (target && target.id && target.id.startsWith('panel-')) {
    target.innerHTML = '<p class="err">panel request failed (' + xhr.status + ')</p>';
  }
});
document.body.addEventListener('htmx:sendError', (evt) => {
  const target = evt.detail.target;
  if (target && target.id && target.id.startsWith('panel-')) {
    target.innerHTML = '<p class="err">panel unreachable — API down?</p>';
  }
});
`;

/**
 * Login form submit handler (§9.2). Better Auth's origin check treats a plain
 * cross-navigation form POST as untrustworthy (no reliable Origin header on
 * a same-origin top-level nav in every browser) — fetch always sets one, and
 * unlike the bare form this can land back on /admin on success. CSP here is
 * script-src 'self' with no 'unsafe-inline', so this has to be an external
 * asset, not an inline <script>.
 */
export const AUTH_JS = `
document.getElementById('login-form')?.addEventListener('submit', async (evt) => {
  evt.preventDefault();
  const form = evt.target;
  const err = document.getElementById('login-err');
  if (err) err.textContent = '';
  const body = {
    email: form.email.value,
    password: form.password.value,
  };
  let res;
  try {
    res = await fetch('/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
  } catch {
    if (err) err.textContent = 'network error — API unreachable';
    return;
  }
  if (res.ok) {
    window.location.href = '/admin';
    return;
  }
  const data = await res.json().catch(() => null);
  if (err) err.textContent = (data && data.message) || 'sign-in failed';
});
`;

/* -------------------------------------------------------------------------- */
/*  Page shell                                                                 */
/* -------------------------------------------------------------------------- */

export function page(title: string, who: string, body: Raw): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${ASSETS.css.href}"></head>
<body>
<header><h1>monkyesuite ${escapeHtml(title)}</h1>
<span class="who">${escapeHtml(who)}</span></header>
${body.value}
<script src="${ASSETS.htmx.href}" defer></script>
<script src="${ASSETS.js.href}" defer></script>
</body></html>`;
}

/**
 * A standalone document — login and 403.
 *
 * Deliberately does NOT reuse STYLES. The 403 must give away nothing about what
 * lives behind it, and the panel stylesheet names its own furniture (a
 * `--panel` custom property, sparkline classes). Shipping it to a denied caller
 * would leak the shape of the surface through a stylesheet. This block shares
 * no vocabulary with it.
 */
export function bare(title: string, body: Raw): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box}
body{margin:0;display:grid;place-items:center;height:100vh;background:#0f1115;color:#d7dce5;
font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.card{background:#171a21;border:1px solid #262b36;border-radius:6px;padding:22px;min-width:300px}
.card h1{font-size:14px;margin:0 0 12px;letter-spacing:.06em;text-transform:uppercase}
.card form{display:flex;flex-direction:column;gap:8px;width:100%}
input,button{font:inherit;font-size:12px;background:#0c0e13;color:#d7dce5;
border:1px solid #262b36;border-radius:4px;padding:5px 8px}
button{cursor:pointer;border-color:#5b8def;color:#cfe0ff}
.err{color:#e0533d;font-size:12px;margin:4px 0 0}
</style></head><body>${body.value}</body></html>`;
}

/**
 * The event an action broadcasts (via the HX-Trigger response header) so the
 * panels it affects re-fetch themselves. Actions therefore never need to know
 * which panels exist — the panels declare what they listen for.
 */
export const REFRESH_EVENT = "admin-refresh";

/**
 * Panel wrapper: a self-refreshing fragment slot.
 *
 * `load` fetches once on arrival, `every Ns` polls, and `admin-refresh from:body`
 * re-fetches when an action reports it changed something. 30s is well inside the
 * worker's 5-minute tick, which is the real resolution of every number here.
 */
export function panel(
  id: string,
  heading: string,
  fragmentPath: string,
  opts: { wide?: boolean; everySeconds?: number } = {},
): Raw {
  const every = opts.everySeconds ?? 30;
  return html`<section class="${opts.wide ? "wide" : ""}">
  <h2>${heading}</h2>
  <div id="${id}" hx-get="${fragmentPath}"
       hx-trigger="load, every ${every}s, ${REFRESH_EVENT} from:body"
       ><p class="dim">loading…</p></div>
</section>`;
}

/* -------------------------------------------------------------------------- */
/*  Formatting helpers                                                         */
/* -------------------------------------------------------------------------- */

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function ago(at: Date | string | null): string {
  if (!at) return "never";
  const ms = Date.now() - new Date(at).getTime();
  if (ms < 0) return "just now";
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function stamp(at: Date | string | null): string {
  return at ? new Date(at).toISOString().replace("T", " ").slice(0, 19) : "—";
}
