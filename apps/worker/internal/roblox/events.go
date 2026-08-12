package roblox

import (
	"context"
	"fmt"
	"time"
)

// VirtualEvent is one in-game scheduled event (specs/01 §1.3).
type VirtualEvent struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Subtitle  string `json:"subtitle"`
	Tagline   string `json:"tagline"`
	EventTime struct {
		StartUTC *time.Time `json:"startUtc"`
		EndUTC   *time.Time `json:"endUtc"`
	} `json:"eventTime"`
	Host struct {
		HostID   int64  `json:"hostId"`
		HostName string `json:"hostName"`
	} `json:"host"`
	EventCategories []struct {
		Category string `json:"category"`
		Rank     int    `json:"rank"`
	} `json:"eventCategories"`
	Thumbnails []struct {
		MediaID int64 `json:"mediaId"`
	} `json:"thumbnails"`
	EventStatus string     `json:"eventStatus"`
	CreatedUTC  *time.Time `json:"createdUtc"`
	UpdatedUTC  *time.Time `json:"updatedUtc"`
}

type virtualEventsResponse struct {
	Data []VirtualEvent `json:"data"`
}

// GetVirtualEvents fetches the virtual events for one universe.
func (c *Client) GetVirtualEvents(ctx context.Context, universeID int64) ([]VirtualEvent, error) {
	u := fmt.Sprintf("https://apis.roblox.com/virtual-events/v1/universes/%d/virtual-events", universeID)
	var resp virtualEventsResponse
	if err := getJSON(ctx, c, "virtual-events/list", u, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}
