import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { FILTER_LABEL } from "#/lib/constants/filters";
import { fmtCCU, fmtNextRefresh, fmtRelative } from "#/lib/format";
import { SORT_CAPTION } from "#/lib/formulas";
import {
  type FeedPayload,
  FILTERS,
  type FilterValue,
  SORT_LABEL,
  SORTS,
  type SortValue,
} from "#/lib/types";
import MobileFeed from "../MobileFeed";
import SearchModal from "../SearchModal";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import DesktopCard from "./DesktopCard";
import HeroSubhead from "./HeroSubhead";
import { styles } from "./PulseFeed.styles";
import Rail from "./Rail";
import Topbar from "./Topbar";

export default function PulseFeed({
  games,
  hero,
  kicker,
  liveSince,
  rail,
  degradedMode,
  jobHealth,
}: FeedPayload) {
  const search = useSearch({ from: "/" }) as {
    filter?: FilterValue;
    sort?: SortValue;
  };
  const navigate = useNavigate({ from: "/" });
  const isLoading = useRouterState({ select: (s) => s.isLoading });
  const filter: FilterValue = search.filter ?? "all";
  const sort: SortValue = search.sort ?? "spike";
  const setFilter = (value: FilterValue) =>
    navigate({ search: (s) => ({ ...s, filter: value }) });
  const setSort = (value: SortValue) =>
    navigate({ search: (s) => ({ ...s, sort: value }) });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <SearchModal open={searchOpen} onOpenChange={setSearchOpen} />
      <div className="md:hidden">
        <MobileFeed
          games={games}
          hero={hero}
          kicker={kicker}
          liveSince={liveSince}
          rail={rail}
          degradedMode={degradedMode}
          jobHealth={jobHealth}
          onSearchOpen={() => setSearchOpen(true)}
        />
      </div>
      <div className="hidden md:block">
        <div style={styles.page}>
          <Topbar
            liveSince={liveSince}
            now={now}
            jobHealth={jobHealth}
            onSearchOpen={() => setSearchOpen(true)}
          />

          <div style={styles.hero}>
            <div style={{ minWidth: 0 }}>
              <div style={styles.heroKicker}>{kicker}</div>
              <div style={styles.heroTitle}>What's moving on Roblox today.</div>
              <HeroSubhead
                trackedCcu={hero.trackedCcu}
                movers={hero.movers}
                new48h={hero.new48h}
                totalTracked={
                  rail.distribution.new +
                  rail.distribution.growing +
                  rail.distribution.peaking +
                  rail.distribution.declining
                }
              />
            </div>
            <div style={styles.heroStats}>
              <div style={styles.heroStat}>
                <span style={styles.heroStatLabel}>Tracked CCU</span>
                <span style={styles.heroStatValue}>
                  {hero.trackedCcu === 0
                    ? "—"
                    : fmtCCU(hero.trackedCcu, { compact: true })}
                </span>
              </div>
              <div style={styles.heroStat}>
                <span style={styles.heroStatLabel}>Movers</span>
                <span style={styles.heroStatValue}>
                  {games.length === 0 ? "—" : String(hero.movers)}
                </span>
              </div>
              <div style={styles.heroStat}>
                <span style={styles.heroStatLabel}>New · 48h</span>
                <span style={styles.heroStatValue}>
                  {games.length === 0 ? "—" : String(hero.new48h)}
                </span>
              </div>
            </div>
          </div>

          <div
            style={{
              ...styles.body,
              gridTemplateColumns: degradedMode ? "1fr" : "1fr 320px",
            }}
          >
            <div
              style={{
                ...styles.feedCol,
                borderRight: degradedMode ? "none" : styles.feedCol.borderRight,
              }}
            >
              <div style={styles.feedHeader}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
                  <span style={styles.feedTitle}>Pulse</span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "#57534e",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {games.length} games
                  </span>
                  <span
                    style={{ fontSize: 11, color: "#57534e", margin: "0 4px" }}
                  >
                    ·
                  </span>
                  <div
                    style={{ display: "flex", gap: 6, whiteSpace: "nowrap" }}
                  >
                    {FILTERS.map((value) => (
                      <Button
                        key={value}
                        type="button"
                        size="sm"
                        variant={filter === value ? "secondary" : "ghost"}
                        className="h-7 rounded-full px-3 text-xs"
                        onClick={() => setFilter(value)}
                      >
                        {FILTER_LABEL[value]}
                      </Button>
                    ))}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 4,
                    flexShrink: 0,
                  }}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="sort-btn flex h-8 items-center gap-1.5 rounded-full border border-border-1 bg-transparent px-3 text-xs font-medium text-text-3 hover:text-text-1 data-[state=open]:bg-[rgba(255,255,255,0.06)] data-[state=open]:text-text-1 transition-colors outline-none focus:outline-none focus-visible:outline-none focus-visible:border-text-3"
                      >
                        <span className="text-text-5 uppercase tracking-[0.12em] text-[10px] font-semibold">
                          Sort
                        </span>
                        <span>{SORT_LABEL[sort]}</span>
                        <ChevronDown className="size-3 opacity-60" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      sideOffset={6}
                      className="min-w-[180px] rounded-xl border border-border-1 bg-surface-1 p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
                    >
                      <div className="px-2 pt-1 pb-2 text-[10px] uppercase tracking-[0.14em] font-semibold text-text-5">
                        Sort by
                      </div>
                      {SORTS.map((value) => {
                        const active = sort === value;
                        return (
                          <DropdownMenuItem
                            key={value}
                            onSelect={() => setSort(value)}
                            className={`flex cursor-pointer items-center justify-between rounded-md px-2.5 py-2 text-[13px] outline-none transition-colors focus:bg-[rgba(255,255,255,0.05)] ${
                              active
                                ? "text-text-1 font-medium"
                                : "text-text-3 hover:text-text-2"
                            }`}
                          >
                            <span>{SORT_LABEL[value]}</span>
                            {active && (
                              <span
                                aria-hidden
                                className="size-1.5 rounded-full bg-text-1"
                              />
                            )}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <span
                    className="tl-meta-sm"
                    style={{ whiteSpace: "nowrap", marginTop: 6 }}
                    title="Definition of the active sort"
                  >
                    {SORT_CAPTION[sort]}
                  </span>
                </div>
              </div>
              {degradedMode && (
                <div
                  className="tl-meta-sm"
                  style={{
                    padding: "10px 32px",
                    color: "var(--text-4)",
                    fontStyle: "italic",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                  }}
                >
                  Pulse classification temporarily unavailable. Showing tracked
                  games by current CCU.
                </div>
              )}
              {games.length === 0 ? (
                <div style={styles.emptyCard}>
                  <div style={{ fontSize: 14, color: "#ededeb" }}>
                    The pulse is quiet.
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#57534e",
                      fontFamily: "'Instrument Serif', serif",
                      fontStyle: "italic",
                    }}
                  >
                    We'll tell you when something moves.
                  </div>
                </div>
              ) : (
                <>
                  <div
                    style={{
                      opacity: isLoading ? 0.5 : 1,
                      transition: "opacity 180ms ease",
                      pointerEvents: isLoading ? "none" : "auto",
                    }}
                  >
                    {games.map((g, i) => (
                      <DesktopCard
                        key={g.id}
                        game={g}
                        index={i}
                        activeSort={sort}
                      />
                    ))}
                  </div>
                  <div
                    style={{
                      marginTop: 24,
                      paddingTop: 16,
                      borderTop: "1px solid rgba(255,255,255,0.06)",
                      fontFamily: "'Instrument Serif', serif",
                      fontStyle: "italic",
                      fontSize: 13,
                      color: "#78716c",
                      textAlign: "center",
                      lineHeight: 1.6,
                    }}
                  >
                    Showing {games.length}{" "}
                    {games.length === 1 ? "mover" : "movers"} · last refresh{" "}
                    {fmtRelative(liveSince, now)} ·{" "}
                    {fmtNextRefresh(liveSince, now)}
                  </div>
                </>
              )}
            </div>
            {!degradedMode && <Rail rail={rail} />}
          </div>
        </div>
      </div>
    </>
  );
}
