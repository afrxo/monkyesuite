package trends

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestStripGuard drops Google's anti-JSON-hijack prefix.
func TestStripGuard(t *testing.T) {
	cases := map[string]string{
		")]}'\n{\"a\":1}": "{\"a\":1}",
		")]}',{\"a\":1}":  "{\"a\":1}",
		"{\"a\":1}":       "{\"a\":1}",
		")]}'\n[1,2,3]":   "[1,2,3]",
	}
	for in, want := range cases {
		if got := string(stripGuard([]byte(in))); got != want {
			t.Fatalf("stripGuard(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestInterest exercises the two-step token dance end to end against a stub,
// returning the latest non-empty timeline value.
func TestInterest(t *testing.T) {
	explore := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(")]}'\n" + `{"widgets":[
			{"id":"TIMESERIES","token":"TOK","request":{"foo":"bar"}},
			{"id":"OTHER","token":"x","request":{}}]}`))
	}))
	defer explore.Close()

	var gotToken string
	widget := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotToken = r.URL.Query().Get("token")
		w.Write([]byte(")]}'\n" + `{"default":{"timelineData":[
			{"value":[10],"hasData":[true]},
			{"value":[80],"hasData":[true]},
			{"value":[],"hasData":[false]}]}}`))
	}))
	defer widget.Close()

	c := New(WithBaseURLs(explore.URL, widget.URL))
	got, err := c.Interest(context.Background(), "tycoon")
	if err != nil {
		t.Fatalf("Interest: %v", err)
	}
	if got != 80 {
		t.Fatalf("Interest = %v, want 80 (latest non-empty)", got)
	}
	if gotToken != "TOK" {
		t.Fatalf("widget token = %q, want TOK", gotToken)
	}
}

// TestInterestNoWidget fails soft when the TIMESERIES widget is absent.
func TestInterestNoWidget(t *testing.T) {
	explore := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(")]}'\n" + `{"widgets":[{"id":"OTHER","token":"x","request":{}}]}`))
	}))
	defer explore.Close()

	c := New(WithBaseURLs(explore.URL, "http://unused"))
	if _, err := c.Interest(context.Background(), "x"); err == nil {
		t.Fatal("expected error when no TIMESERIES widget")
	}
}
