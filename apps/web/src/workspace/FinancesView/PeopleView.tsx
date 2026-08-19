// People tab (spec §7.3). Row + drawer, REFS pattern applied to people:
// rating chip + one-line note is the field that matters six months from now.

import type {
  FinancePersonListRow,
  FinancePersonRating,
} from "@monkyesuite/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toastError } from "../../components/Toast";
import { api } from "../../lib/api";
import { fmtRobux, fmtUsd } from "../../lib/format";

const RATING_COLOR: Record<FinancePersonRating, string> = {
  good: "text-fin-positive",
  mixed: "text-fin-negative",
  avoid: "text-fin-alert",
};

export function PeopleView({ projectId }: { projectId: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["finance-people", projectId],
    queryFn: () => api.financePeople(projectId),
  });

  if (isLoading) {
    return (
      <div className="flex-1 space-y-2 ws-scroll overflow-y-auto p-5">
        <div className="h-40 animate-pulse rounded bg-white/[0.04]" />
      </div>
    );
  }

  const people = data ?? [];

  return (
    <div className="flex flex-1 min-h-0">
      <div className="flex-1 ws-scroll overflow-y-auto">
        <div className="flex items-center gap-3 border-b border-border-1 bg-surface-0 px-5 py-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
            People
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded border border-border-2 px-2.5 py-1 text-xs text-text-3 hover:text-text-1"
          >
            + Add
          </button>
        </div>
        {adding ? (
          <AddPersonRow projectId={projectId} onDone={() => setAdding(false)} />
        ) : null}
        {people.length === 0 && !adding ? (
          <div className="p-10 text-center text-sm text-text-disabled">
            No one commissioned yet. People you pay show up here with what they
            cost and how to reach them.
          </div>
        ) : (
          people.map((p) => (
            <PersonRow
              key={p.id}
              person={p}
              active={openId === p.id}
              onClick={() => setOpenId(openId === p.id ? null : p.id)}
            />
          ))
        )}
      </div>
      {openId ? (
        <PersonDrawer
          personId={openId}
          projectId={projectId}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}

function PersonRow({
  person,
  active,
  onClick,
}: {
  person: FinancePersonListRow;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-b border-border-1 px-5 py-2.5 text-left text-xs transition-colors ${
        active ? "bg-white/[0.05]" : "hover:bg-white/[0.02]"
      }`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          person.rating
            ? RATING_COLOR[person.rating].replace("text-", "bg-")
            : "bg-text-disabled"
        }`}
      />
      <span className="w-28 shrink-0 truncate text-text-1">
        {person.discordHandle}
      </span>
      {person.activePercent != null ? (
        <span className="w-10 shrink-0 font-mono tabular-nums text-text-2">
          {person.activePercent}%
        </span>
      ) : (
        <span className="w-10 shrink-0" />
      )}
      {person.hasCapital ? (
        <span className="w-4 shrink-0 text-fin-robux">◈</span>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <span className="flex-1 truncate text-text-disabled">
        {person.roles.join(", ") || "—"}
      </span>
      <span className="w-20 shrink-0 truncate text-text-disabled">
        {person.preferredMethod ?? "—"}
      </span>
      <span className="w-10 shrink-0 text-right font-mono tabular-nums text-text-disabled">
        {person.txCount}
      </span>
      <span className="w-24 shrink-0 text-right font-mono tabular-nums text-text-1">
        {person.paidRobux > 0
          ? fmtRobux(person.paidRobux)
          : fmtUsd(person.paidUsd)}
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-text-disabled">
        {person.lastPaidOn ?? "—"}
      </span>
    </button>
  );
}

function AddPersonRow({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [handle, setHandle] = useState("");
  const [robloxUsername, setRobloxUsername] = useState("");
  const [resolved, setResolved] = useState<{
    id: number;
    username: string;
    avatarUrl: string | null;
  } | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);

  const lookup = useMutation({
    mutationFn: (username: string) => api.robloxUserLookup(username),
    onSuccess: (res) => {
      if (res.found && res.id != null && res.username) {
        setResolved({
          id: res.id,
          username: res.username,
          avatarUrl: res.avatarUrl ?? null,
        });
        setLookupFailed(false);
      } else {
        setResolved(null);
        setLookupFailed(true);
      }
    },
    onError: () => {
      setResolved(null);
      setLookupFailed(true);
    },
  });

  const create = useMutation({
    mutationFn: () =>
      api.createFinancePerson(projectId, {
        discordHandle: handle,
        robloxUserId: resolved?.id ?? null,
        robloxUsername: resolved?.username ?? (robloxUsername.trim() || null),
        avatarUrl: resolved?.avatarUrl ?? null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-people", projectId] });
      onDone();
    },
    onError: (err) => toastError(err, "Failed to add person."),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (handle.trim()) create.mutate();
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 border-b border-border-1 px-5 py-2.5"
    >
      <div className="flex items-center gap-2">
        <input
          // biome-ignore lint/a11y/noAutofocus: focus what user opened
          autoFocus
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onDone();
          }}
          placeholder="discord handle"
          className="flex-1 rounded border border-border-1 bg-surface-1 px-2.5 py-1.5 text-xs text-text-1 outline-none focus:border-text-5"
        />
        <button
          type="submit"
          className="rounded bg-accent-warm px-2.5 py-1.5 text-xs font-semibold text-[#1a1000]"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-xs text-text-3 hover:text-text-1"
        >
          cancel
        </button>
      </div>
      <div className="flex items-center gap-2">
        {resolved?.avatarUrl ? (
          <img
            src={resolved.avatarUrl}
            alt=""
            className="h-5 w-5 shrink-0 rounded-full"
          />
        ) : null}
        <input
          value={robloxUsername}
          onChange={(e) => {
            setRobloxUsername(e.target.value);
            setResolved(null);
            setLookupFailed(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && robloxUsername.trim()) {
              e.preventDefault();
              lookup.mutate(robloxUsername.trim());
            }
          }}
          placeholder="roblox username (optional)"
          className="flex-1 rounded border border-border-1 bg-surface-1 px-2.5 py-1.5 text-xs text-text-1 outline-none focus:border-text-5"
        />
        <button
          type="button"
          disabled={!robloxUsername.trim() || lookup.isPending}
          onClick={() => lookup.mutate(robloxUsername.trim())}
          className="rounded border border-border-2 px-2 py-1.5 text-[11px] text-text-3 hover:text-text-1 disabled:opacity-40"
        >
          Resolve
        </button>
      </div>
      {resolved ? (
        <span className="text-[11px] text-fin-positive">
          linked @{resolved.username}
        </span>
      ) : lookupFailed ? (
        <span className="text-[11px] text-text-disabled">
          couldn't find that user — you can still save the username as-is.
        </span>
      ) : null}
    </form>
  );
}

function PersonDrawer({
  personId,
  projectId,
  onClose,
}: {
  personId: string;
  projectId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["finance-person-detail", personId],
    queryFn: () => api.financePerson(personId),
  });

  const patch = useMutation({
    mutationFn: (input: {
      rating?: FinancePersonRating | null;
      note?: string | null;
    }) => api.patchFinancePerson(personId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-person-detail", personId] });
      qc.invalidateQueries({ queryKey: ["finance-people", projectId] });
    },
    onError: (err) => toastError(err, "Failed to update person."),
  });

  if (!data) {
    return (
      <div className="w-80 shrink-0 border-l border-border-1 bg-surface-1 p-5">
        <div className="h-40 animate-pulse rounded bg-white/[0.04]" />
      </div>
    );
  }

  return (
    <div className="flex w-80 shrink-0 flex-col ws-scroll overflow-y-auto border-l border-border-1 bg-surface-1">
      <div className="flex items-center gap-2 border-b border-border-1 px-4 py-3">
        <span className="text-sm font-semibold text-text-1">
          {data.discordHandle}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-text-disabled hover:text-text-1"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1 text-xs">
          {data.displayName ? (
            <div className="text-text-2">{data.displayName}</div>
          ) : null}
          {data.robloxUsername ? (
            <div className="text-text-3">roblox: {data.robloxUsername}</div>
          ) : (
            <div className="text-fin-alert">no roblox profile linked</div>
          )}
          {data.roles.length > 0 ? (
            <div className="text-text-disabled">{data.roles.join(", ")}</div>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
            Rating
          </span>
          <div className="flex gap-1.5">
            {(["good", "mixed", "avoid"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() =>
                  patch.mutate({ rating: data.rating === r ? null : r })
                }
                className={`rounded border px-2 py-1 text-[11px] capitalize transition-colors ${
                  data.rating === r
                    ? `border-current ${RATING_COLOR[r]}`
                    : "border-border-2 text-text-3 hover:text-text-1"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <input
            defaultValue={data.note ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (data.note ?? "")) patch.mutate({ note: v || null });
            }}
            placeholder="would I rehire?"
            className="rounded border border-border-1 bg-surface-1 px-2 py-1.5 text-xs text-text-1 outline-none focus:border-text-5"
          />
        </div>

        {data.owed.length > 0 ? (
          <Section title="Owed">
            {data.owed.map((o) => (
              <div
                key={o.currency}
                className="flex items-center justify-between text-xs"
              >
                <span className="font-mono tabular-nums text-text-1">
                  {o.currency === "robux"
                    ? fmtRobux(o.native)
                    : fmtUsd(o.native)}
                </span>
                <span className="text-text-disabled">~{fmtUsd(o.usd)}</span>
              </div>
            ))}
          </Section>
        ) : null}

        {data.splits.length > 0 ? (
          <Section title="Splits">
            {data.splits.map((s) => (
              <div key={s.id} className="flex flex-col gap-0.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono tabular-nums text-text-1">
                    {s.percent}%
                  </span>
                  <span className="text-text-disabled">
                    {s.effectiveTo
                      ? `${s.effectiveFrom} – ${s.effectiveTo}`
                      : `since ${s.effectiveFrom}`}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-text-3">
                  accrued{" "}
                  {s.accrued
                    .map((a) =>
                      a.currency === "robux"
                        ? fmtRobux(a.native)
                        : fmtUsd(a.native),
                    )
                    .join(" · ") || "—"}
                </div>
              </div>
            ))}
          </Section>
        ) : null}

        {data.capitalIn.length > 0 ? (
          <Section title="Capital in">
            {data.capitalIn.map((c) => (
              <div
                key={c.currency}
                className="font-mono text-xs tabular-nums text-text-1"
              >
                {c.currency === "robux" ? fmtRobux(c.native) : fmtUsd(c.native)}
              </div>
            ))}
          </Section>
        ) : null}

        <Section title="History">
          {data.transactions.slice(0, 20).map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between text-xs"
            >
              <span className="truncate text-text-2">{t.description}</span>
              <span className="shrink-0 font-mono tabular-nums text-text-disabled">
                {t.occurredOn.slice(5)}
              </span>
            </div>
          ))}
          {data.transactions.length === 0 ? (
            <div className="text-xs text-text-disabled">No payments yet.</div>
          ) : null}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-border-1 pt-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
        {title}
      </span>
      {children}
    </div>
  );
}
