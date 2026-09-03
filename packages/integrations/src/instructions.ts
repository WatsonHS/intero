/**
 * The single origin of Intero's always-on coordination instructions.
 *
 * The managed adapters write this text into each client's instructions or
 * rules file, and the Agent Plugins artifact derives its skill body from the
 * same constant (ADR-0011), so the two distribution paths cannot drift apart.
 * Changing this text changes managed file content hashes; treat it as a
 * versioned contract rather than free-form prose.
 */
export const INSTRUCTION_CONTENT = `# Intero coordination

After understanding the first user request in each new conversation and before
substantive work, report an intent checkpoint with a safe summary of the current
work. Include a stable workstream key, a concise title, and currentFocus.

Use the Intero MCP tools only at semantic branch points. Report an intent,
decision, blocker, dependency, meaningful scope change, artifact, validation
outcome, pause, or completion. Never send prompts, chain-of-thought, raw tool
input/output, terminal logs, secrets, or file contents as checkpoints.
`;
