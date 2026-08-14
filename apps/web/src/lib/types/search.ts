import type { LifecycleStage } from "./lifecycle";

export type SearchResult = {
  id: number;
  name: string;
  creatorName: string;
  genre: string | null;
  thumbnail: string | null;
  ccu: number;
  lifecycle: LifecycleStage;
};
