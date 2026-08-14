export type ThesisGame = {
  universeId: number;
  name: string;
  creatorName: string | null;
  thumbnail: string | null;
  currentCcu: number;
  firstClimberAt: number;
  emergenceRank: number;
  points: { dayFromEmergence: number; ccu: number }[];
};

export type ThesisPayload =
  | {
      kind: "thesis";
      kicker: string;
      computedAt: number;
      detector: string;
      headline: string;
      editorial: string;
      games: ThesisGame[];
    }
  | {
      kind: "placeholder";
      kicker: string;
      computedAt: number;
    };

export type AccelerationState = "accelerating" | "near_peak" | "rolling_over";

export type AccelerationCardData = {
  universeId: number;
  name: string;
  creatorName: string | null;
  thumbnail: string | null;
  currentCcu: number;
  state: AccelerationState;
  annotation: string;
  sustainedHours: number;
  accelerationScore: number;
  spark: number[];
};

export type AccelerationBoardPayload =
  | { kind: "board"; cards: AccelerationCardData[] }
  | { kind: "placeholder" };

export type SortWatchEntry = {
  universeId: number;
  name: string;
  creatorName: string | null;
  thumbnail: string | null;
  sortName: string;
  rank: number;
  prevRank: number | null;
  enteredAt: number;
  latestCcu: number;
  annotation: string;
};

export type SortWatchPayload =
  | { kind: "list"; entries: SortWatchEntry[] }
  | { kind: "placeholder" };

export type OperatorSpotlightGame = {
  universeId: number;
  name: string;
  thumbnail: string | null;
  latestCcu: number;
  spark: number[];
};

export type OperatorSpotlightPayload =
  | {
      kind: "spotlight";
      studioName: string;
      editorial: string;
      games: OperatorSpotlightGame[];
    }
  | { kind: "placeholder" };

export type VacancyCell = {
  mechanicId: string;
  mechanic: string;
  count: number;
  daysSinceClimb: number | null;
};

export type VacancyZone = {
  mechanicId: string;
  mechanic: string;
  daysSinceClimb: number;
  label: string;
};

export type VacancyReportPayload =
  | { kind: "report"; cells: VacancyCell[]; coolZones: VacancyZone[] }
  | { kind: "placeholder" };

export type PatternIndexEntry = {
  detector: string;
  body: string;
  sample: number;
};

export type PatternIndexPayload =
  | { kind: "list"; entries: PatternIndexEntry[] }
  | { kind: "placeholder" };

export type DiscoverPayload = {
  kicker: string;
  computedAt: number;
  thesis: ThesisPayload;
  acceleration: AccelerationBoardPayload;
  sortWatch: SortWatchPayload;
  operatorSpotlight: OperatorSpotlightPayload;
  vacancyReport: VacancyReportPayload;
  patternIndex: PatternIndexPayload;
};
