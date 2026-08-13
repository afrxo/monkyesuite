package youtube

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// TestSearchRecent covers decoding the recent-video count + ids and that the
// request carries the quota key and the 7-day publishedAfter filter.
func TestSearchRecent(t *testing.T) {
	var gotPath, gotQ string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotQ = r.URL.Path, r.URL.RawQuery
		w.Write([]byte(`{"pageInfo":{"totalResults":42},
			"items":[{"id":{"videoId":"aaa"}},{"id":{"videoId":"bbb"}},{"id":{"kind":"channel"}}]}`))
	}))
	defer srv.Close()

	c := New("KEY", WithBaseURL(srv.URL))
	res, err := c.SearchRecent(context.Background(), "tycoon", time.Unix(0, 0).UTC())
	if err != nil {
		t.Fatalf("SearchRecent: %v", err)
	}
	if res.VideoCount != 42 {
		t.Fatalf("VideoCount = %d, want 42", res.VideoCount)
	}
	if len(res.VideoIDs) != 2 || res.VideoIDs[0] != "aaa" || res.VideoIDs[1] != "bbb" {
		t.Fatalf("VideoIDs = %v, want [aaa bbb]", res.VideoIDs)
	}
	if gotPath != "/search" {
		t.Fatalf("path = %q, want /search", gotPath)
	}
	for _, want := range []string{"key=KEY", "publishedAfter=1970", "type=video"} {
		if !contains(gotQ, want) {
			t.Fatalf("query %q missing %q", gotQ, want)
		}
	}
}

// TestVideoViews sums viewCount across returned videos, treating a missing or
// unparseable count as zero rather than an error.
func TestVideoViews(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"items":[
			{"statistics":{"viewCount":"1000"}},
			{"statistics":{"viewCount":"250"}},
			{"statistics":{}}]}`))
	}))
	defer srv.Close()

	c := New("KEY", WithBaseURL(srv.URL))
	got, err := c.VideoViews(context.Background(), []string{"a", "b", "c"})
	if err != nil {
		t.Fatalf("VideoViews: %v", err)
	}
	if got != 1250 {
		t.Fatalf("VideoViews = %d, want 1250", got)
	}
}

func TestVideoViewsEmpty(t *testing.T) {
	c := New("KEY", WithBaseURL("http://unused"))
	got, err := c.VideoViews(context.Background(), nil)
	if err != nil || got != 0 {
		t.Fatalf("VideoViews(nil) = %d, %v; want 0, nil", got, err)
	}
}

// TestNewEmptyKey guards the "unconfigured → skip" contract.
func TestNewEmptyKey(t *testing.T) {
	if New("") != nil {
		t.Fatal("New(\"\") should return nil for the skip path")
	}
}

// TestQuotaCosts pins the documented budget arithmetic (§4.2).
func TestQuotaCosts(t *testing.T) {
	if SearchCost != 100 || VideosCost != 1 || DailyQuota != 10000 {
		t.Fatalf("quota consts drifted: search=%d videos=%d daily=%d", SearchCost, VideosCost, DailyQuota)
	}
	// A bounded set: ~99 full terms fit under the daily ceiling.
	if DailyQuota/(SearchCost+VideosCost) != 99 {
		t.Fatalf("terms/day = %d, want 99", DailyQuota/(SearchCost+VideosCost))
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
