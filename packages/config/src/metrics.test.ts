import { describe, expect, it } from "vitest";

import { PrivacySafeMetrics } from "./metrics.js";

describe("privacy-safe operational metrics", () => {
  it("renders bounded labels without content or tenant identifiers", () => {
    const metrics = new PrivacySafeMetrics();
    metrics.observeRequest({
      method: "POST",
      route: "/v1/projects/019b5ac0-7600-7000-8000-000000000011/pulse",
      statusCode: 202,
      durationMs: 17,
    });
    metrics.observeModel("summary", "success", 42);
    metrics.observeModel("intero_prose", "unavailable", 84);
    metrics.observeWorkerJob("retry", 2);
    metrics.setQueueDepth("stand_in", 3);
    metrics.setRealtimeHealth("centrifugo", false);

    const output = metrics.renderPrometheus();
    expect(output).toContain('route="/v1/projects/:id/pulse"');
    expect(output).toContain("intero_model_duration_ms_bucket");
    expect(output).toContain(
      'intero_model_calls_total{operation="intero_prose",outcome="unavailable"} 1',
    );
    expect(output).toContain('intero_realtime_healthy{adapter="centrifugo"} 0');
    expect(output).not.toContain("019b5ac0");
    expect(output).not.toContain("prompt");
    expect(output).not.toContain("principal");
  });
});
