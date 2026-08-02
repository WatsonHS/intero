const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000];

type ModelOperation = "summary" | "answer" | "intero_prose";
type ModelOutcome = "success" | "unavailable" | "error";
type WorkerOutcome = "success" | "retry" | "failure";

export class PrivacySafeMetrics {
  readonly #counters = new Map<string, number>();
  readonly #gauges = new Map<string, number>();
  readonly #histograms = new Map<
    string,
    { count: number; sum: number; buckets: number[] }
  >();

  observeRequest(input: {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
  }): void {
    const labels = labelsOf({
      method: safeMethod(input.method),
      route: safeRoute(input.route),
      status_class: `${Math.floor(input.statusCode / 100)}xx`,
    });
    this.increment(`intero_http_requests_total${labels}`);
    this.observe(`intero_http_request_duration_ms${labels}`, input.durationMs);
  }

  setQueueDepth(queue: "stand_in" | "realtime_outbox", depth: number) {
    this.#gauges.set(
      `intero_queue_depth${labelsOf({ queue })}`,
      Math.max(0, Math.floor(depth)),
    );
  }

  observeWorkerJob(outcome: WorkerOutcome, retryCount: number): void {
    this.increment(
      `intero_worker_jobs_total${labelsOf({
        outcome,
        retry: retryCount > 0 ? "true" : "false",
      })}`,
    );
  }

  observeModel(
    operation: ModelOperation,
    outcome: ModelOutcome,
    durationMs: number,
  ): void {
    const labels = labelsOf({ operation, outcome });
    this.increment(`intero_model_calls_total${labels}`);
    this.observe(`intero_model_duration_ms${labels}`, durationMs);
  }

  setRealtimeHealth(adapter: "centrifugo", healthy: boolean) {
    this.#gauges.set(
      `intero_realtime_healthy${labelsOf({ adapter })}`,
      healthy ? 1 : 0,
    );
  }

  renderPrometheus(): string {
    const lines: string[] = [];
    for (const [name, value] of [...this.#counters].sort()) {
      lines.push(`${name} ${value}`);
    }
    for (const [name, value] of [...this.#gauges].sort()) {
      lines.push(`${name} ${value}`);
    }
    for (const [name, value] of [...this.#histograms].sort()) {
      const metric = splitMetric(name);
      let cumulative = 0;
      for (const [index, bound] of LATENCY_BUCKETS_MS.entries()) {
        cumulative += value.buckets[index] ?? 0;
        lines.push(
          `${metric.base}_bucket${labelsOf({
            ...metric.labels,
            le: String(bound),
          })} ${cumulative}`,
        );
      }
      lines.push(
        `${metric.base}_bucket${labelsOf({
          ...metric.labels,
          le: "+Inf",
        })} ${value.count}`,
      );
      lines.push(`${metric.base}_sum${labelsOf(metric.labels)} ${value.sum}`);
      lines.push(
        `${metric.base}_count${labelsOf(metric.labels)} ${value.count}`,
      );
    }
    return `${lines.join("\n")}\n`;
  }

  private increment(key: string): void {
    this.#counters.set(key, (this.#counters.get(key) ?? 0) + 1);
  }

  private observe(key: string, rawValue: number): void {
    const value = Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0;
    const histogram = this.#histograms.get(key) ?? {
      count: 0,
      sum: 0,
      buckets: LATENCY_BUCKETS_MS.map(() => 0),
    };
    histogram.count += 1;
    histogram.sum += value;
    const bucket = LATENCY_BUCKETS_MS.findIndex((bound) => value <= bound);
    if (bucket >= 0) {
      histogram.buckets[bucket] = (histogram.buckets[bucket] ?? 0) + 1;
    }
    this.#histograms.set(key, histogram);
  }
}

function labelsOf(labels: Record<string, string>): string {
  return `{${Object.entries(labels)
    .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
    .join(",")}}`;
}

function safeMethod(value: string): string {
  const normalized = value.toUpperCase();
  return ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(
    normalized,
  )
    ? normalized
    : "OTHER";
}

function safeRoute(value: string): string {
  if (!value.startsWith("/") || value.length > 160) return "unknown";
  return value
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi,
      "/:id",
    )
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .replace(/[^A-Za-z0-9_/:.-]/g, "_");
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function splitMetric(metric: string): {
  base: string;
  labels: Record<string, string>;
} {
  const opening = metric.indexOf("{");
  if (opening < 0) return { base: metric, labels: {} };
  const labels = Object.fromEntries(
    metric
      .slice(opening + 1, -1)
      .split(",")
      .map((item) => {
        const [key, rawValue] = item.split("=");
        return [key!, rawValue!.slice(1, -1)];
      }),
  );
  return { base: metric.slice(0, opening), labels };
}
