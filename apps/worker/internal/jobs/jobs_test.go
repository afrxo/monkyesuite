package jobs

import (
	"reflect"
	"testing"

	"monkyesuite/worker/internal/roblox"
)

// TestChunk covers the snapshot batching that holds games/votes requests to
// GamesBatchLimit ids each (specs/01 §1.2).
func TestChunk(t *testing.T) {
	tests := []struct {
		name string
		in   []int64
		size int
		want [][]int64
	}{
		{"empty", nil, 50, nil},
		{"single full batch", seq(50), 50, [][]int64{seq(50)}},
		{"remainder batch", seq(120), 50, [][]int64{seq50(0), seq50(50), rangeIDs(100, 120)}},
		{"smaller than size", []int64{1, 2, 3}, 50, [][]int64{{1, 2, 3}}},
		{"size one", []int64{1, 2}, 1, [][]int64{{1}, {2}}},
		{"zero size", []int64{1, 2}, 0, nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := chunk(tc.in, tc.size)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("chunk(%v,%d) = %v, want %v", tc.in, tc.size, got, tc.want)
			}
			// No batch may exceed size, and the total must be preserved.
			total := 0
			for _, b := range got {
				if tc.size > 0 && len(b) > tc.size {
					t.Fatalf("batch len %d exceeds size %d", len(b), tc.size)
				}
				total += len(b)
			}
			if tc.size > 0 && total != len(tc.in) {
				t.Fatalf("chunk lost elements: got %d, want %d", total, len(tc.in))
			}
		})
	}
}

// TestChunkMatchesRobloxBatchLimit guards that a real tracked set chunks into
// batches no larger than the endpoint allows.
func TestChunkMatchesRobloxBatchLimit(t *testing.T) {
	got := chunk(seq(230), roblox.GamesBatchLimit)
	if len(got) != 5 { // 50,50,50,50,30
		t.Fatalf("want 5 batches, got %d", len(got))
	}
	for i, b := range got {
		if len(b) > roblox.GamesBatchLimit {
			t.Fatalf("batch %d has %d ids, over limit %d", i, len(b), roblox.GamesBatchLimit)
		}
	}
}

// TestMissingFrom covers the carry-forward set difference: tracked games absent
// from a tick's returned set are exactly those that must be carried forward
// (specs/01 §1.2).
func TestMissingFrom(t *testing.T) {
	tracked := []int64{1, 2, 3, 4, 5}
	tests := []struct {
		name string
		seen []int64
		want []int64
	}{
		{"none seen → all missing", nil, []int64{1, 2, 3, 4, 5}},
		{"all seen → none missing", []int64{1, 2, 3, 4, 5}, nil},
		{"partial gap", []int64{1, 3, 5}, []int64{2, 4}},
		{"seen has extras not tracked", []int64{2, 4, 99}, []int64{1, 3, 5}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			seen := map[int64]struct{}{}
			for _, id := range tc.seen {
				seen[id] = struct{}{}
			}
			got := missingFrom(tracked, seen)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("missingFrom(%v, %v) = %v, want %v", tracked, tc.seen, got, tc.want)
			}
		})
	}
}

// helpers -------------------------------------------------------------------

func seq(n int) []int64       { return rangeIDs(0, n) }
func seq50(start int) []int64 { return rangeIDs(start, start+50) }
func rangeIDs(lo, hi int) []int64 {
	out := make([]int64, 0, hi-lo)
	for i := lo; i < hi; i++ {
		out = append(out, int64(i))
	}
	return out
}
