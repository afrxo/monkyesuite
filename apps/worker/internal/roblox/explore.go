package roblox

import (
	"context"
	"fmt"
	"net/url"
)

// SortCategories are the 9 Explore sorts polled every tick (specs/01 §1.1).
var SortCategories = []string{
	"top-trending", "up-and-coming", "top-playing-now", "fun-with-friends",
	"top-revisited", "top-earning", "top-paid-access", "top-rated", "most-popular",
}

// SortEntry is one game as returned by the Explore get-sort-content endpoint.
type SortEntry struct {
	UniverseID  int64  `json:"universeId"`
	RootPlaceID int64  `json:"rootPlaceId"`
	Name        string `json:"name"`
	IsSponsored bool   `json:"isSponsored"`
}

// exploreResponse is the (permissive) get-sort-content shape. The endpoint is
// unofficial and its response is the most volatile we consume (§1.5), so we
// decode only the fields we need and tolerate the rest.
type exploreResponse struct {
	Games []SortEntry `json:"games"`
}

// GetSortContent fetches one Explore sort category, returning its games in rank
// order (the response order IS the rank). Sponsored games are the caller's to
// skip. Fails soft: a decode/HTTP error yields no games for this sort.
func (c *Client) GetSortContent(ctx context.Context, sortID string) ([]SortEntry, error) {
	u := fmt.Sprintf("https://apis.roblox.com/explore-api/v1/get-sort-content?sessionId=%s&sortId=%s",
		url.QueryEscape(c.sessionID), url.QueryEscape(sortID))
	var resp exploreResponse
	if err := getJSON(ctx, c, "explore/get-sort-content", u, &resp); err != nil {
		return nil, err
	}
	return resp.Games, nil
}
