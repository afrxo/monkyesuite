// Tracing helpers for per-job spans.
package otel

import (
	"context"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

const tracerName = "monkyesuite.worker"

// StartJobSpan opens a span for one job run. Callers use the returned end
// function with the terminal status so error/skipped ticks land in the trace.
func StartJobSpan(ctx context.Context, job string, tick uint64) (context.Context, trace.Span) {
	return otel.Tracer(tracerName).Start(ctx, "job."+job,
		trace.WithAttributes(
			attribute.String(attrJob, job),
			attribute.Int64("job.tick", int64(tick)),
		),
		trace.WithSpanKind(trace.SpanKindInternal),
	)
}

// EndJobSpan closes a span with the final status. status is one of
// "ok"/"error"/"skipped" — same vocabulary the recorder writes to job_runs.
func EndJobSpan(span trace.Span, status string, err error) {
	span.SetAttributes(attribute.String(attrStatus, status))
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
	span.End()
}
