export const PRETTY_SORT: Record<string, string> = {
  "top-trending": "Top Trending",
  "up-and-coming": "Up & Coming",
  "top-playing-now": "Top Playing Now",
  "fun-with-friends": "Fun With Friends",
  "top-revisited": "Top Revisited",
  "top-earning": "Top Earning",
  "top-paid-access": "Top Paid Access",
  "top-rated": "Top Rated",
  "most-popular": "Most Popular",
};

export function prettySort(name: string): string {
  return PRETTY_SORT[name] ?? name;
}
