// Metrics helpers for job instrumentation. One place owns instrument names so
// dashboard queries in Grafana stay stable across code changes.
package otel

import (
	"context"
	"log/slog"
	"sync"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// Instrument names — Grafana panels use these verbatim. Any rename here breaks
// dashboards; keep them stable.
const (
	meterName        = "monkyesuite.worker"
	metricJobRuns    = "worker.job.runs"
	metricJobDur     = "worker.job.duration_ms"
	metricJobRows    = "worker.job.rows_written"
	metricJobCounter = "worker.job.counter" // free-form per-job counter (name attr)
)

// Attribute keys — snake_case matches OTEL semantic-conventions style even
// though these aren't part of any standard convention yet.
const (
	attrJob    = "job.name"
	attrStatus = "job.status"
	attrCntNm  = "counter.name"
)

var (
	initOnce sync.Once
	inst     *instruments
)

type instruments struct {
	runs    metric.Int64Counter
	dur     metric.Int64Histogram
	rows    metric.Int64Counter
	counter metric.Int64Counter
}

// ensureInstruments lazy-initializes on first record so packages that import
// this file don't require the meter provider to be up at import time (the
// no-op provider works fine as a fallback).
func ensureInstruments() *instruments {
	initOnce.Do(func() {
		m := otel.Meter(meterName)
		runs, err := m.Int64Counter(metricJobRuns,
			metric.WithDescription("Count of job runs, tagged by status."))
		if err != nil {
			slog.Warn("otel: failed to create runs counter", "err", err)
		}
		dur, err := m.Int64Histogram(metricJobDur,
			metric.WithDescription("Job duration in milliseconds."),
			metric.WithUnit("ms"))
		if err != nil {
			slog.Warn("otel: failed to create duration histogram", "err", err)
		}
		rows, err := m.Int64Counter(metricJobRows,
			metric.WithDescription("Rows written by a job."))
		if err != nil {
			slog.Warn("otel: failed to create rows counter", "err", err)
		}
		counter, err := m.Int64Counter(metricJobCounter,
			metric.WithDescription("Free-form per-job counters (e.g. tracked, real, carried)."))
		if err != nil {
			slog.Warn("otel: failed to create free counter", "err", err)
		}
		inst = &instruments{runs: runs, dur: dur, rows: rows, counter: counter}
	})
	return inst
}

// RecordJobRun emits duration + run-status + rows metrics for one job run.
// Called from sched.Loop.runOne, so every observed run lands in Grafana.
func RecordJobRun(ctx context.Context, job, status string, durationMs int64, rowsWritten int64) {
	i := ensureInstruments()
	attrs := metric.WithAttributes(
		attribute.String(attrJob, job),
		attribute.String(attrStatus, status),
	)
	if i.runs != nil {
		i.runs.Add(ctx, 1, attrs)
	}
	if i.dur != nil {
		i.dur.Record(ctx, durationMs, attrs)
	}
	if i.rows != nil && rowsWritten > 0 {
		i.rows.Add(ctx, rowsWritten, attrs)
	}
}

// RecordCounter emits one free-form job-scoped counter — snapshot.tracked,
// snapshot.real, snapshot.carried, snapshot.unknown_from_roblox, etc.
// name is the counter attribute; instrument is shared.
func RecordCounter(ctx context.Context, job, name string, value int64) {
	i := ensureInstruments()
	if i.counter == nil || value == 0 {
		return
	}
	i.counter.Add(ctx, value, metric.WithAttributes(
		attribute.String(attrJob, job),
		attribute.String(attrCntNm, name),
	))
}
