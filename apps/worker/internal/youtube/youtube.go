// Package youtube is the YouTube Data API v3 client for the off-platform demand
// job (specs/04 §4.2). YouTube is the strongest lead indicator: external
// interest rises before on-platform CCU.
//
// Only two calls are used per term:
//   - search.list  — recent video count (pageInfo.totalResults) + the recent
//     video ids. Costs SearchCost (100) quota units.
//   - videos.list  — aggregate view count over those recent videos. Costs
//     VideosCost (1) unit regardless of id count (up to 50 ids/call).
//
// Quota is the whole constraint (DailyQuota, 10k units/day). This client only
// reports per-call cost via the exported consts; the daily job owns the budget
// and the theme-first spend order (§4.2). Every call fails soft: an error is
// returned for the caller to log and skip, never fatal.
package youtube

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// YouTube Data API v3 quota costs (units). The daily ceiling is DailyQuota; a
// full term costs SearchCost+VideosCost (101), so a bounded term set fits easily.
const (
	SearchCost = 100
	VideosCost = 1
	DailyQuota = 10000
)

// apiBase is the YouTube Data API v3 root. Overridable in tests.
const apiBase = "https://www.googleapis.com/youtube/v3"

// searchMaxResults is the page size for search.list (the API max is 50).
const searchMaxResults = 50

// Client is the shared YouTube API client. It holds the API key and a plain
// HTTP client; no rate limiter here — quota (not req/s) is the binding limit and
// the job accounts for it.
type Client struct {
	http    *http.Client
	key     string
	baseURL string
	log     *slog.Logger
}

// Option configures a Client.
type Option func(*Client)

// WithHTTPClient overrides the underlying *http.Client (tests, custom transport).
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// WithBaseURL overrides the API root (tests point this at an httptest server).
func WithBaseURL(u string) Option { return func(c *Client) { c.baseURL = u } }

// WithLogger sets the structured logger.
func WithLogger(l *slog.Logger) Option { return func(c *Client) { c.log = l } }

// New builds a client for the given API key. Returns nil if key is empty so the
// caller can treat an unconfigured YouTube integration as "skip the job".
func New(key string, opts ...Option) *Client {
	if key == "" {
		return nil
	}
	c := &Client{
		http:    &http.Client{Timeout: 15 * time.Second},
		key:     key,
		baseURL: apiBase,
		log:     slog.Default(),
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

// SearchResult is the recent-video summary for one term.
type SearchResult struct {
	VideoCount int      // pageInfo.totalResults — approximate recent video count
	VideoIDs   []string // ids of the returned page, for the videos.list view rollup
}

type searchResponse struct {
	PageInfo struct {
		TotalResults int `json:"totalResults"`
	} `json:"pageInfo"`
	Items []struct {
		ID struct {
			VideoID string `json:"videoId"`
		} `json:"id"`
	} `json:"items"`
}

// SearchRecent runs search.list for videos matching term published since
// `since` (§4.2 uses 7 days ago). Costs SearchCost quota units.
func (c *Client) SearchRecent(ctx context.Context, term string, since time.Time) (SearchResult, error) {
	q := url.Values{}
	q.Set("part", "snippet")
	q.Set("type", "video")
	q.Set("order", "date")
	q.Set("q", term)
	q.Set("publishedAfter", since.UTC().Format(time.RFC3339))
	q.Set("maxResults", strconv.Itoa(searchMaxResults))
	q.Set("key", c.key)

	var resp searchResponse
	if err := c.getJSON(ctx, "search.list", "/search", q, &resp); err != nil {
		return SearchResult{}, err
	}
	ids := make([]string, 0, len(resp.Items))
	for _, it := range resp.Items {
		if it.ID.VideoID != "" {
			ids = append(ids, it.ID.VideoID)
		}
	}
	return SearchResult{VideoCount: resp.PageInfo.TotalResults, VideoIDs: ids}, nil
}

type videosResponse struct {
	Items []struct {
		Statistics struct {
			ViewCount string `json:"viewCount"` // API returns counts as strings
		} `json:"statistics"`
	} `json:"items"`
}

// VideoViews runs videos.list and sums viewCount over the given ids — the
// aggregate recent-view volume for a term (§4.2). Costs VideosCost units. Ids
// beyond 50 are ignored (single-call budget); pass a search page.
func (c *Client) VideoViews(ctx context.Context, ids []string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	if len(ids) > searchMaxResults {
		ids = ids[:searchMaxResults]
	}
	q := url.Values{}
	q.Set("part", "statistics")
	q.Set("id", joinIDs(ids))
	q.Set("key", c.key)

	var resp videosResponse
	if err := c.getJSON(ctx, "videos.list", "/videos", q, &resp); err != nil {
		return 0, err
	}
	var total int64
	for _, it := range resp.Items {
		n, err := strconv.ParseInt(it.Statistics.ViewCount, 10, 64)
		if err != nil {
			continue // a missing/private count is 0, not a failure
		}
		total += n
	}
	return total, nil
}

// getJSON performs one GET and decodes into out. No auth header (the key is a
// query param); a non-2xx is an error the caller logs and skips.
func (c *Client) getJSON(ctx context.Context, endpoint, path string, q url.Values, out any) error {
	start := time.Now()
	u := c.baseURL + path + "?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		c.log.Warn("youtube call failed", "endpoint", endpoint, "err", err)
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	c.log.Info("youtube call", "endpoint", endpoint, "status", resp.StatusCode,
		"latency_ms", time.Since(start).Milliseconds(), "bytes", len(body))
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// 403 is typically quotaExceeded; surface the status for the job to log.
		return fmt.Errorf("youtube %s: status %d", endpoint, resp.StatusCode)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode %s: %w", endpoint, err)
	}
	return nil
}

// joinIDs comma-joins video ids for the videos.list `id` param.
func joinIDs(ids []string) string {
	out := ""
	for i, id := range ids {
		if i > 0 {
			out += ","
		}
		out += id
	}
	return out
}
