// Package otel bootstraps OpenTelemetry for the worker: an OTLP/HTTP tracer
// and meter provider exporting to whatever endpoint OTEL_EXPORTER_OTLP_ENDPOINT
// points at (Grafana Cloud in prod).
//
// The exporters read auth from OTEL_EXPORTER_OTLP_HEADERS
// (`Authorization=Basic <base64(instance:token)>` for Grafana Cloud). Absent
// endpoint → Init returns a no-op shutdown and every span/metric is dropped
// silently, so an env misconfig can never take the worker down.
package otel

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// ServiceName is the OTEL service.name attribute. Kept constant so Grafana
// dashboards can hard-code it. Overridable via OTEL_SERVICE_NAME.
const ServiceName = "monkyesuite-worker"

// Shutdown flushes and shuts down both providers. Always safe to call, always
// safe to call multiple times.
type Shutdown func(context.Context) error

// noop is returned when OTEL is disabled or misconfigured — the worker keeps
// running with no telemetry rather than crashing on startup.
func noop(context.Context) error { return nil }

// Init wires the global TracerProvider + MeterProvider from env. Endpoint
// discovery follows the OTEL SDK convention (OTEL_EXPORTER_OTLP_ENDPOINT).
// Returns a Shutdown that flushes both providers with a bounded timeout.
func Init(ctx context.Context) (Shutdown, error) {
	if os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") == "" &&
		os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") == "" &&
		os.Getenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") == "" {
		slog.Info("otel: no OTLP endpoint set, telemetry disabled")
		return noop, nil
	}

	svc := os.Getenv("OTEL_SERVICE_NAME")
	if svc == "" {
		svc = ServiceName
	}
	res, err := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceName(svc),
			semconv.ServiceVersion(version()),
		),
	)
	if err != nil {
		return noop, err
	}

	traceExp, err := otlptracehttp.New(ctx)
	if err != nil {
		return noop, err
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(traceExp),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{}, propagation.Baggage{},
	))

	metricExp, err := otlpmetrichttp.New(ctx)
	if err != nil {
		// Traces are up; roll them back to keep the two providers coherent.
		_ = tp.Shutdown(ctx)
		return noop, err
	}
	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExp,
			sdkmetric.WithInterval(30*time.Second))),
		sdkmetric.WithResource(res),
	)
	otel.SetMeterProvider(mp)

	slog.Info("otel: OTLP exporters initialized", "service", svc)
	return func(ctx context.Context) error {
		ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		return errors.Join(tp.Shutdown(ctx), mp.Shutdown(ctx))
	}, nil
}

// version reads a RAILWAY_GIT_COMMIT_SHA short-hash if present so
// per-deploy metrics can be split in Grafana. Falls back to "dev".
func version() string {
	if v := os.Getenv("RAILWAY_GIT_COMMIT_SHA"); v != "" {
		if len(v) > 7 {
			return v[:7]
		}
		return v
	}
	return "dev"
}
