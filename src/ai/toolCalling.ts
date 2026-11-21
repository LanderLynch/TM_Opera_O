export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelResponse {
  content?: string;
  toolCalls?: ToolCall[];
  finishReason?: string;
}

export interface AgentModelClient {
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

export interface ParsedAgentTurn {
  thought?: string;
  plan?: string[];
  action?: {
    tool: string;
    arguments: Record<string, unknown>;
  };
  finalAnswer?: string;
}

export function normalizeModelResponse(rawText: string): ModelResponse {
  const parsed = parseStructuredTurn(rawText);
  if (parsed?.action) {
    return {
      content: parsed.thought,
      toolCalls: [
        {
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: parsed.action.tool,
          arguments: parsed.action.arguments,
        },
      ],
      finishReason: "tool_calls",
    };
  }
  return {
    content: parsed?.finalAnswer ?? rawText.trim(),
    finishReason: "stop",
  };
}

export function parseStructuredTurn(rawText: string): ParsedAgentTurn | null {
  if (!rawText) return null;
  const trimmed = rawText.trim();

  // Extract JSON from ```json ... ``` block or raw {...}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const objMatch = candidate.match(/\{[\s\S]*\}/);
  if (!objMatch) return null;

  try {
    const obj = JSON.parse(objMatch[0]) as Record<string, unknown>;
    const turn: ParsedAgentTurn = {};

    if (typeof obj.thought === "string") turn.thought = obj.thought;
    if (Array.isArray(obj.plan)) {
      turn.plan = obj.plan.map((s) => String(s));
    }

    if (obj.action && typeof obj.action === "object" && !Array.isArray(obj.action)) {
      const act = obj.action as Record<string, unknown>;
      if (typeof act.tool === "string" && act.tool.trim().length > 0) {
        const args =
          act.arguments && typeof act.arguments === "object" && !Array.isArray(act.arguments)
            ? (act.arguments as Record<string, unknown>)
            : {};
        turn.action = {
          tool: act.tool.trim(),
          arguments: args,
        };
      }
    }

    if (typeof obj.finalAnswer === "string") {
      turn.finalAnswer = obj.finalAnswer;
    }

    if (!turn.action && turn.finalAnswer === undefined && !turn.plan) {
      return null;
    }
    return turn;
  } catch {
    return null;
  }
}
