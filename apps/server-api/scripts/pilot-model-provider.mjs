import { createServer } from "node:http";

const port = Number.parseInt(
  process.env.INTERO_PILOT_PROVIDER_PORT ?? "4312",
  10,
);

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }

  const body = await readJson(request);
  const prompt = body.messages?.findLast?.(
    (message) => message.role === "user",
  )?.content;
  const parsed =
    typeof prompt === "string" ? JSON.parse(prompt) : { checkpoint: {} };
  const sources = parsed.safeStructuredSources ?? [];
  const checkpoint = parsed.checkpoint ?? {};
  const coordination = [
    "dependency_declared",
    "blocker_raised",
    "review_requested",
    "coordination_requested",
  ].includes(checkpoint.eventType);
  const safeSummary = `Stand-in: ${String(checkpoint.summary ?? "Structured work checkpoint received.").slice(0, 560)}`;
  const output =
    typeof parsed.question === "string"
      ? {
          answer:
            sources.length > 0
              ? `Stand-in: ${sources
                  .map((source) => source.safeSummary)
                  .join(" ")
                  .slice(0, 1_800)}`
              : "The structured Work State does not contain enough information.",
          sourceWorkStateIds: sources
            .map((source) => source.workStateId)
            .filter(Boolean)
            .slice(0, 10),
        }
      : {
          safeSummary,
          coordination: {
            shouldOpen: coordination,
            safeContext: coordination ? safeSummary : "",
            candidateNextSteps: coordination
              ? [
                  "Confirm the responsible participant",
                  "Agree on a reversible next step",
                ]
              : [],
          },
        };

  response.setHeader("content-type", "application/json");
  response.end(
    JSON.stringify({
      id: "chatcmpl-intero-pilot",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1_000),
      model: body.model ?? "intero-pilot-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: JSON.stringify(output),
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 30,
        total_tokens: 80,
      },
    }),
  );
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `Intero pilot OpenAI-compatible provider listening on http://127.0.0.1:${port}/v1\n`,
  );
});

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
