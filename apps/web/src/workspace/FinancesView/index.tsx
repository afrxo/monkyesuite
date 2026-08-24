// Finances — three tabs (Statements / Ledger / People) with a single shared
// period control. Overview is retired; ?tab=overview is redirected to
// Statements so old links keep resolving. The composer (N) is mounted here
// so it's reachable from any tab.

import type { FinanceKind } from "@monkyesuite/shared";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Composer } from "./Composer";
import { LedgerView } from "./LedgerView";
import { PeopleView } from "./PeopleView";
import {
  cycleType,
  PeriodControl,
  stepPeriod,
  todayPeriod,
  useUrlPeriod,
} from "./PeriodControl";
import { StatementsView } from "./StatementsView";

type FinTab = "statements" | "ledger" | "people";

function readTab(): FinTab {
  if (typeof window === "undefined") return "statements";
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("view") ?? params.get("tab");
  if (raw === "ledger" || raw === "people" || raw === "statements") return raw;
  return "statements";
}

function writeTab(tab: FinTab) {
  const params = new URLSearchParams(window.location.search);
  params.set("view", tab);
  params.delete("tab"); // migrate off the old key
  const url = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  window.history.replaceState(null, "", url);
}

export function FinancesView({ projectId }: { projectId: string }) {
  const [period, setPeriod] = useUrlPeriod();
  const [tab, setTabState] = useState<FinTab>(readTab);
  const [composerOpen, setComposerOpen] = useState(false);
  const [lastKind, setLastKind] = useState<FinanceKind>("expense");
  const [composerPrefill, setComposerPrefill] = useState<{
    kind: FinanceKind;
    personId?: string | null;
  } | null>(null);

  const setTab = useCallback((next: FinTab) => {
    setTabState(next);
    writeTab(next);
  }, []);

  const openComposer = useCallback(
    (prefill?: { kind: FinanceKind; personId?: string | null }) => {
      setComposerPrefill(prefill ?? null);
      setComposerOpen(true);
    },
    [],
  );

  // Aux data (categories + people) — needed by the composer, Ledger, People.
  const { data: categories } = useQuery({
    queryKey: ["finance-categories", projectId],
    queryFn: () => api.financeCategories(projectId),
    staleTime: 5 * 60_000,
  });
  const { data: people } = useQuery({
    queryKey: ["finance-people", projectId],
    queryFn: () => api.financePeople(projectId),
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (composerOpen) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setComposerPrefill(null);
        setComposerOpen(true);
      } else if (e.key === "[" && !e.shiftKey) {
        setPeriod(stepPeriod(period, -1));
      } else if (e.key === "]" && !e.shiftKey) {
        setPeriod(stepPeriod(period, 1));
      } else if (e.key === "{" || (e.shiftKey && e.key === "[")) {
        setPeriod(cycleType(period, -1));
      } else if (e.key === "}" || (e.shiftKey && e.key === "]")) {
        setPeriod(cycleType(period, 1));
      } else if (e.key === "t" || e.key === "T") {
        setPeriod(todayPeriod(period.type === "all" ? "month" : period.type));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [composerOpen, period, setPeriod]);

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border-1 bg-surface-0 px-5 py-2.5">
        <div className="flex gap-0.5">
          <SubTab
            active={tab === "statements"}
            onClick={() => setTab("statements")}
          >
            Statements
          </SubTab>
          <SubTab active={tab === "ledger"} onClick={() => setTab("ledger")}>
            Ledger
          </SubTab>
          <SubTab active={tab === "people"} onClick={() => setTab("people")}>
            People
          </SubTab>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => openComposer()}
          className="rounded bg-accent-warm px-2.5 py-1 text-xs font-semibold text-[#1a1000] transition-colors hover:brightness-110"
        >
          Log <span className="ml-1 opacity-70">N</span>
        </button>
      </div>

      <PeriodControl period={period} onChange={setPeriod} />

      {tab === "statements" ? (
        <StatementsView projectId={projectId} period={period} />
      ) : tab === "ledger" ? (
        <LedgerView
          projectId={projectId}
          categories={categories ?? []}
          period={period}
          onPay={(personId) => openComposer({ kind: "distribution", personId })}
        />
      ) : (
        <PeopleView projectId={projectId} />
      )}

      <Composer
        projectId={projectId}
        open={composerOpen}
        onOpenChange={setComposerOpen}
        categories={categories ?? []}
        people={people ?? []}
        lastKind={lastKind}
        onLastKind={setLastKind}
        prefill={composerPrefill}
      />
    </div>
  );
}

function SubTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2.5 py-1 text-xs transition-colors ${
        active ? "bg-white/[0.06] text-text-1" : "text-text-3 hover:text-text-1"
      }`}
    >
      {children}
    </button>
  );
}
