import { AgentModelClient, ParsedAgentTurn, parseStructuredTurn } from "../ai/toolCalling";
import { logger } from "../core/logger";
import { ToolRegistry } from "../tools/registry";
import { AgentTask } from "./taskManager";

export class AgentPlanner {
  constructor(
    private readonly modelClient: AgentModelClient,
    private readonly registry: ToolRegistry
  ) {}

  public async nextTurn(
    task: AgentTask,
    maxParseRetries = 2
  ): Promise<ParsedAgentTurn> {
    const systemPrompt = [
      "You are the Autonomous Execution Planner for TM Opera O on Windows.",
      "You operate in a strict PLAN -> EXECUTE -> OBSERVE -> VERIFY loop.",
      "Available tools:",
      this.registry.describeForPrompt(),
      "",
      "Respond ONLY with valid JSON matching one of these two shapes:",
      '1) To run the next tool step: {"thought":"...","plan":["step 1","step 2"],"action":{"tool":"tool_name","arguments":{...}}}',
      '2) When the objective is verified complete (or impossible): {"thought":"...","finalAnswer":"Concise summary of verified results"}',
      "Never claim an action succeeded unless its step result and verification evidence confirm it.",
    ].join("\n");

    const historyText =
      task.steps.length === 0
        ? "No steps executed yet."
        : task.steps
            .map(
              (s, i) =>
                `Step ${i + 1} [${s.status}] ${s.toolName}(${JSON.stringify(s.arguments)}) => result: ${JSON.stringify(s.result)} | evidence: ${s.verificationEvidence || "none"}${s.error ? ` | error: ${s.error}` : ""}`
            )
            .join("\n");

    let userPrompt = [
      `Objective: ${task.goal}`,
      `Current active window: ${task.context.activeWindow || "unknown"}`,
      `Execution history:\n${historyText}`,
      "Choose the next single action or provide finalAnswer.",
    ].join("\n\n");

    for (let attempt = 0; attempt <= maxParseRetries; attempt++) {
      const raw = await this.modelClient.complete(systemPrompt, userPrompt);
      const parsed = parseStructuredTurn(raw);
      if (parsed && (parsed.action || parsed.finalAnswer !== undefined)) {
        return parsed;
      }
      logger.warn("planner", "Malformed planner JSON, retrying", { attempt, rawPreview: raw.slice(0, 120) });
      userPrompt += "\n\nYour previous response was not valid JSON with `action` or `finalAnswer`. Reply ONLY with valid JSON.";
    }

    return {
      finalAnswer: "Unable to produce a valid structured plan for this request after retries.",
    };
  }
}
