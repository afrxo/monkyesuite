package roblox

import (
	"testing"
	"time"

	"golang.org/x/time/rate"
)

// TestLimiterBudget asserts a fresh critical client admits a full burst of
// CriticalRateRequests immediately, then denies the next — the "skip, no result"
// gate on the critical tier (specs/01 §1.0).
func TestLimiterBudget(t *testing.T) {
	c := New()

	for i := 0; i < CriticalRateRequests; i++ {
		if !c.Allow() {
			t.Fatalf("Allow() #%d: want true (within burst), got false", i+1)
		}
	}
	if c.Allow() {
		t.Fatal("Allow() past burst: want false (gate closed), got true")
	}
}

// TestLimiterRefills asserts a token becomes available after one refill
// interval (window / requests), so sustained throughput is capped, not blocked
// forever.
func TestLimiterRefills(t *testing.T) {
	c := New()
	for i := 0; i < CriticalRateRequests; i++ {
		c.Allow()
	}
	if c.Allow() {
		t.Fatal("precondition: budget should be spent")
	}

	interval := RateLimitWindow / CriticalRateRequests // ~250ms
	// Wait a bit over one interval; the limiter should now yield exactly one.
	deadline := time.Now().Add(2 * interval)
	got := false
	for time.Now().Before(deadline) {
		if c.Allow() {
			got = true
			break
		}
		time.Sleep(interval / 4)
	}
	if !got {
		t.Fatal("limiter did not refill a token within two intervals")
	}
}

// TestLimiterRateMatchesBudget guards the construction math: a critical client's
// rate must equal CriticalRateRequests over RateLimitWindow; the enrich view's
// must equal EnrichRateRequests; the two tiers must sum to the RateLimitRequests
// politeness ceiling.
func TestLimiterRateMatchesBudget(t *testing.T) {
	c := New()
	if got, want := c.limiter.Limit(), rate.Every(RateLimitWindow/CriticalRateRequests); got != want {
		t.Fatalf("critical rate = %v, want %v", got, want)
	}
	if got, want := c.ForEnrich().limiter.Limit(), rate.Every(RateLimitWindow/EnrichRateRequests); got != want {
		t.Fatalf("enrich rate = %v, want %v", got, want)
	}
	if CriticalRateRequests+EnrichRateRequests != RateLimitRequests {
		t.Fatalf("tiers sum to %d, must equal politeness ceiling %d",
			CriticalRateRequests+EnrichRateRequests, RateLimitRequests)
	}
}

// TestEnrichReservation is the whole point of the two-tier budget (specs/01
// §1.0/§1.5): a fully-saturated enrich drain must NOT be able to starve the
// every-tick critical path. With INDEPENDENT pools, enrich draining its entire
// budget leaves the critical burst completely intact.
func TestEnrichReservation(t *testing.T) {
	crit := New()
	enr := crit.ForEnrich()

	// Independent limiters — NOT the same instance. That separation is the
	// guarantee: enrich cannot spend a token the critical path draws from.
	if enr.limiter == crit.limiter {
		t.Fatal("ForEnrich must carry an independent limiter, not share the critical one")
	}

	// Saturate enrich completely: it caps at its own burst and denies beyond.
	enrichGot := 0
	for i := 0; i < RateLimitRequests*2; i++ {
		if enr.Allow() {
			enrichGot++
		}
	}
	if enrichGot != EnrichRateRequests {
		t.Fatalf("enrich admitted %d, want capped at its budget %d", enrichGot, EnrichRateRequests)
	}

	// Critical burst is untouched by enrich saturation — the full reserved pool
	// is available, so a snapshot always completes mid-drain.
	critGot := 0
	for i := 0; i < RateLimitRequests*2; i++ {
		if crit.Allow() {
			critGot++
		}
	}
	if critGot != CriticalRateRequests {
		t.Fatalf("critical path got %d after enrich saturation, want full reserved %d", critGot, CriticalRateRequests)
	}
}
