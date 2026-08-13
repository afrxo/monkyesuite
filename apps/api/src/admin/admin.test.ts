// Unit coverage for the /admin logic that must not be got wrong by inspection:
// output escaping, the carry-forward banding, and the action validators.
// Behaviour that needs a database (the gate, audit atomicity, the invite cap)
// is verified end-to-end against Postgres — see the acceptance run.

import { beforeAll, describe, expect, it } from "vitest";

// queries.ts imports the db handle, which requires a URL at module load. The
// pool connects lazily, so nothing here touches Postgres.
beforeAll(() => {
  process.env.APP_DATABASE_URL ??=
    "postgres://localhost:5432/monkyesuite_test_noconnect";
});

describe("html escaping", () => {
  it("escapes interpolated values", async () => {
    const { html } = await import("./html.js");
    const evil = '<script>alert("x")</script>';
    expect(html`<p>${evil}</p>`.value).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>",
    );
  });

  it("escapes attribute-breaking quotes", async () => {
    const { html } = await import("./html.js");
    const evil = '" onload="steal()';
    expect(html`<i title="${evil}"></i>`.value).not.toContain('onload="');
  });

  it("passes Raw through unescaped — the only opt-out", async () => {
    const { html, raw } = await import("./html.js");
    expect(html`${raw("<b>ok</b>")}`.value).toBe("<b>ok</b>");
  });

  it("escapes values nested in arrays", async () => {
    const { html } = await import("./html.js");
    const rows = ["<i>", "&"];
    expect(html`${rows.map((r) => html`<td>${r}</td>`)}`.value).toBe(
      "<td>&lt;i&gt;</td><td>&amp;</td>",
    );
  });
});

describe("carry-forward banding (§9.4.1)", () => {
  it("bands a low steady rate as ok — carry-forward is correct behaviour", async () => {
    const { carryBand } = await import("./queries.js");
    expect(carryBand(0.01, 0.01)).toBe("ok");
    expect(carryBand(0.04, 0.04)).toBe("ok");
  });

  it("warns from 5% and alerts past 20%", async () => {
    const { carryBand } = await import("./queries.js");
    expect(carryBand(0.05, 0.05)).toBe("warn");
    expect(carryBand(0.2, 0.2)).toBe("warn");
    expect(carryBand(0.21, 0.2)).toBe("bad");
  });

  it("alerts on a spike against the trailing mean, even when absolutely small", async () => {
    const { carryBand } = await import("./queries.js");
    // 12% is inside the warn band on its own, but it is 12x the baseline — the
    // rise is the signal, which is the whole point of the panel.
    expect(carryBand(0.12, 0.01)).toBe("bad");
  });

  it("treats total carry-forward as the loudest state", async () => {
    const { carryBand } = await import("./queries.js");
    expect(carryBand(1, 0.01)).toBe("bad");
  });

  it("computes the rate from tracked, and never divides by zero", async () => {
    const { carryRate } = await import("./queries.js");
    const base = { startedAt: new Date(), status: "ok", error: null, tick: 1 };
    expect(carryRate({ ...base, tracked: 100, real: 90, carried: 10 })).toBe(
      0.1,
    );
    expect(carryRate({ ...base, tracked: 0, real: 0, carried: 0 })).toBe(0);
  });
});

describe("limiter skip rate (§9.4.3)", () => {
  it("counts skips against issued+skipped, not issued alone", async () => {
    const { skipRate } = await import("./queries.js");
    expect(skipRate({ tier: "enrich", issued: 30, skipped: 10, runs: 1 })).toBe(
      0.25,
    );
    expect(skipRate({ tier: "critical", issued: 0, skipped: 0, runs: 0 })).toBe(
      0,
    );
  });
});

describe("action validators (§9.5)", () => {
  it("rejects a job name that is not triggerable", async () => {
    const { runJobSchema } = await import("./actions.js");
    expect(runJobSchema.safeParse({ job: "derive" }).success).toBe(true);
    // enrich-drain is spawned by the enrich job, never scheduled.
    expect(runJobSchema.safeParse({ job: "enrich-drain" }).success).toBe(false);
    expect(runJobSchema.safeParse({ job: "drop-table" }).success).toBe(false);
  });

  it("requires the typed confirmation to match the untrack target", async () => {
    const { untrackSchema } = await import("./actions.js");
    expect(
      untrackSchema.safeParse({ universeId: "123", confirm: "123" }).success,
    ).toBe(true);
    expect(
      untrackSchema.safeParse({ universeId: "123", confirm: "yes" }).success,
    ).toBe(false);
    expect(
      untrackSchema.safeParse({ universeId: "123", confirm: "124" }).success,
    ).toBe(false);
  });

  it("requires the literal PURGE confirmation", async () => {
    const { purgeSchema } = await import("./actions.js");
    expect(purgeSchema.safeParse({ confirm: "PURGE" }).success).toBe(true);
    expect(purgeSchema.safeParse({ confirm: "purge" }).success).toBe(false);
    expect(purgeSchema.safeParse({}).success).toBe(false);
  });

  it("does not accept an is_admin field on user creation", async () => {
    const { createUserSchema } = await import("./actions.js");
    const parsed = createUserSchema.parse({
      email: "a@b.test",
      password: "hunter2hunter2",
      isAdmin: true,
    });
    // Zod strips unknown keys: no admin field survives into the handler, so the
    // panel cannot escalate privilege even if a form is tampered with.
    expect("isAdmin" in parsed).toBe(false);
  });
});
