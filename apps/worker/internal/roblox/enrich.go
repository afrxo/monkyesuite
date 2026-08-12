package roblox

import (
	"context"
	"fmt"
)

// GamePass is one monetization SKU (specs/01 §1.4). Gated data reached through
// the third-party rotunnel proxy; enrichment only, always fail soft.
type GamePass struct {
	PassID     int64  `json:"id"`
	Name       string `json:"name"`
	PriceRobux *int   `json:"price"`
}

// DevProduct is one developer product SKU.
type DevProduct struct {
	ProductID  int64  `json:"id"`
	Name       string `json:"name"`
	PriceRobux *int   `json:"priceInRobux"`
}

// PortfolioGame is one of a creator's other games (specs/01 §1.4 creator job).
type PortfolioGame struct {
	UniverseID int64  `json:"id"`
	Name       string `json:"name"`
	Visits     int64  `json:"placeVisits"`
}

// GroupMeta is the group dimension refresh.
type GroupMeta struct {
	ID               int64  `json:"id"`
	Name             string `json:"name"`
	MemberCount      int    `json:"memberCount"`
	HasVerifiedBadge bool   `json:"hasVerifiedBadge"`
}

// PlaceDetail is one entry of games.v1/multiget-place-details.
type PlaceDetail struct {
	UniverseID         int64    `json:"universeId"`
	SupportedLanguages []string `json:"supportedLanguages"`
	AgeRecommendation  string   `json:"ageRecommendation"`
}

type datalist[T any] struct {
	Data []T `json:"data"`
}

// GetGamePasses fetches a universe's gamepasses via the rotunnel proxy.
func (c *Client) GetGamePasses(ctx context.Context, universeID int64) ([]GamePass, error) {
	u := fmt.Sprintf("https://apis.rotunnel.com/game-passes/v1/universes/%d/game-passes", universeID)
	var resp datalist[GamePass]
	if err := getJSON(ctx, c, "rotunnel/game-passes", u, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// GetDevProducts fetches a universe's developer products via the rotunnel proxy.
func (c *Client) GetDevProducts(ctx context.Context, universeID int64) ([]DevProduct, error) {
	u := fmt.Sprintf("https://apis.rotunnel.com/game-passes/v1/universes/%d/developerproducts?limit=100", universeID)
	var resp datalist[DevProduct]
	if err := getJSON(ctx, c, "rotunnel/dev-products", u, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// GetCreatorGames fetches a creator's top games (studio portfolio). kind is
// "groups" or "users".
func (c *Client) GetCreatorGames(ctx context.Context, kind string, creatorID int64) ([]PortfolioGame, error) {
	u := fmt.Sprintf("https://games.roblox.com/v2/%s/%d/games?accessFilter=Public&limit=50&sortOrder=Desc", kind, creatorID)
	var resp datalist[PortfolioGame]
	if err := getJSON(ctx, c, "games/creator-games", u, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// GetGroup fetches group metadata (member count, verified badge).
func (c *Client) GetGroup(ctx context.Context, groupID int64) (*GroupMeta, error) {
	u := fmt.Sprintf("https://groups.roblox.com/v1/groups/%d", groupID)
	var meta GroupMeta
	if err := getJSON(ctx, c, "groups/get", u, &meta); err != nil {
		return nil, err
	}
	return &meta, nil
}
