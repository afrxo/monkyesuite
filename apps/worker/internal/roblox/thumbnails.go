package roblox

import (
	"context"
	"strconv"
	"strings"
)

// thumbnailResponse is the shared shape for thumbnails.v1 batch endpoints.
type thumbnailResponse struct {
	Data []struct {
		TargetID int64  `json:"targetId"`
		State    string `json:"state"`
		ImageURL string `json:"imageUrl"`
	} `json:"data"`
}

// GetGameIcons prewarms + resolves 150×150 game icons, returning universeId →
// CDN URL for the entries that resolved "Completed" (specs/01 §1.1).
func (c *Client) GetGameIcons(ctx context.Context, universeIDs []int64) (map[int64]string, error) {
	u := "https://thumbnails.roblox.com/v1/games/icons?universeIds=" + idsParam(universeIDs) +
		"&size=150x150&format=Png&isCircular=false"
	var resp thumbnailResponse
	if err := getJSON(ctx, c, "thumbnails/icons", u, &resp); err != nil {
		return nil, err
	}
	out := make(map[int64]string, len(resp.Data))
	for _, d := range resp.Data {
		if d.State == "Completed" && d.ImageURL != "" {
			out[d.TargetID] = d.ImageURL
		}
	}
	return out, nil
}

// GetAssetThumbnails resolves 480×270 asset art (event thumbnails), returning
// mediaId → CDN URL (specs/01 §1.3).
func (c *Client) GetAssetThumbnails(ctx context.Context, assetIDs []int64) (map[int64]string, error) {
	parts := make([]string, len(assetIDs))
	for i, id := range assetIDs {
		parts[i] = strconv.FormatInt(id, 10)
	}
	u := "https://thumbnails.roblox.com/v1/assets?assetIds=" + strings.Join(parts, ",") +
		"&size=480x270&format=Png&isCircular=false"
	var resp thumbnailResponse
	if err := getJSON(ctx, c, "thumbnails/assets", u, &resp); err != nil {
		return nil, err
	}
	out := make(map[int64]string, len(resp.Data))
	for _, d := range resp.Data {
		if d.State == "Completed" && d.ImageURL != "" {
			out[d.TargetID] = d.ImageURL
		}
	}
	return out, nil
}
