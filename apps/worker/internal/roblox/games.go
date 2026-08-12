package roblox

import (
	"context"
	"strconv"
	"strings"
	"time"
)

// GamesBatchLimit is the max universeIds per games/votes request (specs/01 §1.2).
const GamesBatchLimit = 50

// Creator is the embedded creator on a games response.
type Creator struct {
	ID               int64  `json:"id"`
	Name             string `json:"name"`
	Type             string `json:"type"` // "User" | "Group"
	HasVerifiedBadge bool   `json:"hasVerifiedBadge"`
}

// GameInfo is one game from games.v1/games.
type GameInfo struct {
	UniverseID      int64      `json:"id"`
	RootPlaceID     int64      `json:"rootPlaceId"`
	Name            string     `json:"name"`
	Playing         int        `json:"playing"`
	Visits          int64      `json:"visits"`
	FavoritedCount  int64      `json:"favoritedCount"`
	Genre           string     `json:"genre"`
	Created         *time.Time `json:"created"`
	Updated         *time.Time `json:"updated"`
	MaxPlayers      int        `json:"maxPlayers"`
	PlayableDevices []string   `json:"playableDevices"`
	Creator         Creator    `json:"creator"`
}

// Votes is one game's vote counts from games.v1/games/votes.
type Votes struct {
	UniverseID int64 `json:"id"`
	UpVotes    int64 `json:"upVotes"`
	DownVotes  int64 `json:"downVotes"`
}

type gamesResponse struct {
	Data []GameInfo `json:"data"`
}

type votesResponse struct {
	Data []Votes `json:"data"`
}

// idsParam joins universeIds into the comma-separated query value both endpoints
// expect. Callers chunk to GamesBatchLimit first (see jobs.chunk).
func idsParam(ids []int64) string {
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = strconv.FormatInt(id, 10)
	}
	return strings.Join(parts, ",")
}

// GetGames fetches one batch (≤50) of games' live metrics + metadata.
func (c *Client) GetGames(ctx context.Context, ids []int64) ([]GameInfo, error) {
	u := "https://games.roblox.com/v1/games?universeIds=" + idsParam(ids)
	var resp gamesResponse
	if err := getJSON(ctx, c, "games/games", u, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// GetVotes fetches one batch (≤50) of games' vote counts.
func (c *Client) GetVotes(ctx context.Context, ids []int64) ([]Votes, error) {
	u := "https://games.roblox.com/v1/games/votes?universeIds=" + idsParam(ids)
	var resp votesResponse
	if err := getJSON(ctx, c, "games/votes", u, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}
