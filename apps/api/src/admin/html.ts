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
@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap');
:root{
  --surface-0:#0c0c0d;--surface-1:#161616;--surface-hover:rgba(255,255,255,0.03);
  --border-1:rgba(255,255,255,0.06);--border-2:rgba(255,255,255,0.05);
  --text-1:#fafaf9;--text-2:#ededeb;--text-3:#a8a29e;--text-4:#78716c;--text-5:#57534e;
  --ok:#86efac;--warn:#fcd34d;--bad:#fca5a5;--accent:#93c5fd;
  --font-sans:'Inter Tight',ui-sans-serif,system-ui,sans-serif;
  --font-serif:'Instrument Serif',ui-serif,Georgia,serif;
  --font-mono:ui-monospace,SFMono-Regular,Menlo,monospace;
  /* legacy aliases still referenced below */
  --bg:var(--surface-0);--panel:var(--surface-1);--line:var(--border-1);
  --fg:var(--text-2);--dim:var(--text-4);
}
*{box-sizing:border-box;min-width:0}
html,body{scrollbar-width:none}
html::-webkit-scrollbar,body::-webkit-scrollbar{display:none}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 var(--font-sans);
  -webkit-font-smoothing:antialiased;font-feature-settings:"cv02","cv03","cv04","cv11";overflow-x:hidden}

/* -------- Top bar -------- */
header{padding:18px 32px;border-bottom:1px solid var(--line);display:flex;gap:16px;
  align-items:baseline;max-width:1440px;margin:0 auto;width:100%}
header h1{font-size:15px;margin:0;font-weight:600;letter-spacing:-.01em;color:var(--text-1)}
header h1 em{font-family:var(--font-serif);font-style:italic;font-weight:400;color:var(--text-4);
  margin-left:8px;font-size:14px}
header .who{color:var(--dim);font-size:12px;margin-left:auto;font-variant-numeric:tabular-nums}

/* -------- Panel grid -------- */
main{padding:24px 32px 48px;display:grid;gap:16px;
  grid-template-columns:repeat(auto-fit,minmax(360px,1fr));
  max-width:1440px;margin:0 auto;width:100%}
section{background:var(--panel);border:1px solid var(--line);border-radius:12px;
  padding:18px 20px;min-width:0;display:flex;flex-direction:column;gap:10px;
  overflow:hidden}
section > *{min-width:0;max-width:100%}
section h2{font-size:10px;margin:0;letter-spacing:.14em;text-transform:uppercase;
  color:var(--text-5);font-weight:600}
.wide{grid-column:1/-1}

/* -------- Text -------- */
.note{color:var(--dim);font-size:12px;margin:0;line-height:1.5;font-family:var(--font-serif);
  font-style:italic}
.note code,.note strong{font-family:var(--font-sans);font-style:normal}
.note code{background:var(--surface-hover);padding:1px 5px;border-radius:4px;font-size:11px;color:var(--text-3)}
.note strong{color:var(--text-2);font-weight:600}
.dim{color:var(--dim)}
p{margin:0;line-height:1.5}
p.dim{font-size:12px}

/* -------- Big headline number -------- */
.big{font-size:28px;line-height:1.1;font-weight:500;color:var(--text-1);
  letter-spacing:-.02em;font-variant-numeric:tabular-nums;margin-top:2px}
.big.ok{color:var(--ok)}.big.warn{color:var(--warn)}.big.bad{color:var(--bad)}

/* -------- Tables -------- */
/* Wrap every table in a horizontal scroll shell so overflow stays IN the
   panel (never on <body>). table-layout:auto lets long cells absorb space
   without forcing the whole grid to grow. */
table{width:100%;border-collapse:collapse;font-size:12.5px;
  font-variant-numeric:tabular-nums;table-layout:auto}
th,td{text-align:left;padding:8px 12px 8px 0;border-bottom:1px solid var(--line);
  vertical-align:top;overflow-wrap:anywhere;word-break:break-word}
th:last-child,td:last-child{padding-right:0}
tr:last-child td{border-bottom:none}
th{color:var(--text-5);font-weight:600;font-size:10px;letter-spacing:.12em;
  text-transform:uppercase;white-space:nowrap}
td{color:var(--text-2)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.dim{color:var(--dim)}
tr.warn td{background:rgba(252,211,77,0.03)}
tr.bad td{background:rgba(252,165,165,0.04)}

/* State colors on inline cells */
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}

/* Error column: multi-line, capped so a stack trace never blows the panel
   width. Falls into the .scroll shell in the worst case. */
td.err,.err{color:var(--bad);white-space:pre-wrap;font-size:11.5px;
  font-family:var(--font-mono);line-height:1.4;max-width:280px;
  overflow-wrap:anywhere;word-break:break-word}

/* -------- Sparkline -------- */
.spark{display:flex;align-items:flex-end;gap:1px;height:36px;margin:6px 0}
.spark i{flex:1 1 auto;min-width:1px;background:var(--ok);display:block;border-radius:1px}
.spark i.warn{background:var(--warn)}.spark i.bad{background:var(--bad)}

/* -------- Forms -------- */
form{display:flex;gap:8px;align-items:center;margin:0;flex-wrap:wrap}
input,select,button{font:inherit;font-size:12px;background:transparent;color:var(--fg);
  border:1px solid var(--line);border-radius:6px;padding:6px 10px;line-height:1.2;
  transition:border-color 140ms ease,background 140ms ease,color 140ms ease;
  min-width:0;max-width:100%}
input,select{color:var(--text-2)}
input::placeholder{color:var(--text-5)}
input:focus,select:focus{outline:none;border-color:var(--text-4);background:rgba(255,255,255,0.02)}
button{cursor:pointer;background:var(--text-1);border-color:var(--text-1);color:var(--surface-0);
  font-weight:500;white-space:nowrap}
button:hover{background:#fff;border-color:#fff}
button.danger{background:transparent;border-color:var(--bad);color:var(--bad);font-weight:500}
button.danger:hover{background:rgba(252,165,165,0.08)}

/* -------- Filter link row (jobs panel) -------- */
p.dim a{color:var(--text-3);text-decoration:none;transition:color 140ms ease;padding:0 2px}
p.dim a:hover{color:var(--text-1)}

/* -------- Flash / status messages -------- */
.flash{margin:4px 0 0;font-size:12px;color:var(--dim);
  font-family:var(--font-serif);font-style:italic;min-height:1.2em}

/* -------- Scroll shells -------- */
/* Every wide table nests inside .scroll. Keeps overflow local to the panel,
   never on the page. Scrollbar hidden — visual chrome kept minimal. */
.scroll{overflow-x:auto;overflow-y:hidden;scrollbar-width:none;
  margin:0 -20px;padding:0 20px}
.scroll::-webkit-scrollbar{display:none}
.scroll table{min-width:100%}

/* -------- Mobile -------- */
@media (max-width:640px){
  header{padding:14px 16px;flex-wrap:wrap}
  header .who{width:100%;margin-left:0;margin-top:4px}
  main{padding:16px;grid-template-columns:1fr;gap:12px}
  section{padding:16px}
  .big{font-size:24px}
}
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
<header><h1>monkyesuite<em>${escapeHtml(title)}</em></h1>
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
@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap');
*{box-sizing:border-box}
html,body{scrollbar-width:none}
html::-webkit-scrollbar,body::-webkit-scrollbar{display:none}
body{margin:0;display:grid;place-items:center;min-height:100vh;background:#0c0c0d;color:#ededeb;
  font:14px/1.5 'Inter Tight',ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.card{background:#161616;border:1px solid rgba(255,255,255,0.06);border-radius:12px;
  padding:28px 30px;min-width:320px;box-shadow:0 24px 48px -12px rgba(0,0,0,0.6)}
.card h1{font-size:16px;margin:0 0 4px;color:#fafaf9;font-weight:600;letter-spacing:-.01em}
.card h1 em{font-family:'Instrument Serif',ui-serif,Georgia,serif;font-style:italic;
  font-weight:400;color:#78716c;font-size:15px;margin-left:6px}
.card .sub{color:#a8a29e;font-size:12.5px;margin:0 0 18px;font-family:'Instrument Serif',serif;font-style:italic}
.card form{display:flex;flex-direction:column;gap:10px;width:100%}
label{color:#78716c;font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;margin-bottom:-6px}
input{font:inherit;font-size:13px;background:transparent;color:#ededeb;
  border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:8px 10px;transition:border-color 140ms ease}
input:focus{outline:none;border-color:#57534e;background:rgba(255,255,255,0.02)}
button{font:inherit;font-size:13px;cursor:pointer;background:#fafaf9;border:1px solid #fafaf9;
  color:#0c0c0d;border-radius:6px;padding:8px 10px;font-weight:500;margin-top:6px;transition:background 140ms ease}
button:hover{background:#fff}
.err{color:#fca5a5;font-size:12px;margin:6px 0 0;min-height:1em}
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
