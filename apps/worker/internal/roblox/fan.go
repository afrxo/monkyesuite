package roblox

import (
	"context"
	"encoding/json"

	"golang.org/x/sync/errgroup"
)

// decodeJSON rejects malformed payloads before they reach the store. It uses a
// disallow-unknown-fields-free decode on purpose: Roblox responses carry many
// fields we ignore, but a shape mismatch on the fields we DO read is an error.
func decodeJSON[T any](body []byte, out *T) error {
	return json.Unmarshal(body, out)
}

// Fanout runs fn over inputs on a bounded goroutine pool (errgroup with
// SetLimit) under the shared limiter, collecting the successful results. This is
// the pattern the whole service exists for: concurrent I/O, bounded width.
//
// Per-item errors are returned alongside results, indexed to inputs, so callers
// fail soft — a single bad id never sinks the batch. Order of results is not
// guaranteed; each result carries its input index.
func Fanout[I, O any](ctx context.Context, concurrency int, inputs []I, fn func(context.Context, I) (O, error)) []Result[O] {
	out := make([]Result[O], len(inputs))
	g, gctx := errgroup.WithContext(ctx)
	if concurrency > 0 {
		g.SetLimit(concurrency)
	}
	for i, in := range inputs {
		i, in := i, in
		g.Go(func() error {
			v, err := fn(gctx, in)
			out[i] = Result[O]{Index: i, Value: v, Err: err}
			return nil // never propagate: fail soft, collect per-item errors
		})
	}
	_ = g.Wait()
	return out
}

// Result pairs a fan-out output with its input index and any per-item error.
type Result[O any] struct {
	Index int
	Value O
	Err   error
}
