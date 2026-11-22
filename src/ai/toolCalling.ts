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

export type ModelTier = "fast" | "standard" | "chief";

export interface AgentModelClient {
  complete(systemPrompt: string, userPrompt: string, tier?: ModelTier): Promise<string>;
}

export function selectModelForTier(baseModel: string, tier: ModelTier = "standard"): string {
  if (!baseModel || baseModel.startsWith("local:")) return baseModel;

  if (tier === "fast") {
    if (baseModel.startsWith("gemini-")) {
      return baseModel.includes("lite") ? baseModel : "gemini-2.5-flash-lite";
    }
    if (baseModel.startsWith("pecut/claude-sonnet-")) {
      return "pecut/deepseek-v4.1-flash-uncensored";
    }
    if (baseModel === "deepseek-reasoner") {
      return "deepseek-chat";
    }
    return baseModel;
  }

  if (tier === "chief") {
    if (baseModel.startsWith("gemini-") && baseModel.includes("lite")) {
      return "gemini-2.5-flash";
    }
    return baseModel;
  }

  return baseModel;
}

export function validatePecutModelId(
  modelId: string,
  availableIds: string[]
): { valid: boolean; error?: string } {
  if (!modelId || !modelId.trim()) {
    return { valid: false, error: "Model ID is empty." };
  }
  if (availableIds.includes(modelId)) {
    return { valid: true };
  }
  return {
    valid: false,
    error: `Model "${modelId}" is not listed by the Pecut Opus provider endpoint.`,
  };
}

export async function fetchPecutModels(apiKey: string): Promise<{ ok: boolean; models: string[]; error?: string }> {
  if (!apiKey) return { ok: false, models: [], error: "DEEPSEEK_API_KEY is empty." };
  try {
    const res = await fetch("https://api.pecutopus.web.id/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      return { ok: false, models: [], error: `Provider HTTP ${res.status}` };
    }
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    const models = (json.data || []).map((m) => String(m.id || "")).filter(Boolean);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, models: [], error: String(err) };
  }
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

function extractBalancedJsonObjects(text: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        results.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return results;
}

export function parseStructuredTurnWithDiagnostics(rawText: string): {
  turn: ParsedAgentTurn | null;
  error?: string;
  rawPreview: string;
} {
  if (!rawText) {
    return { turn: null, error: "Empty model response.", rawPreview: "" };
  }
  const stripped = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = stripped.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : stripped;
  const blocks = extractBalancedJsonObjects(candidate);
  if (blocks.length === 0) {
    return {
      turn: null,
      error: "No JSON object {...} found in model response.",
      rawPreview: stripped.slice(0, 240),
    };
  }

  let lastParseError = "Unknown JSON structure.";
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(blocks[i]) as Record<string, unknown>;
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

      if (turn.action || turn.finalAnswer !== undefined || turn.plan) {
        return { turn, rawPreview: stripped.slice(0, 240) };
      }
      lastParseError = "JSON parsed, but missing required 'action', 'finalAnswer', or 'plan' key.";
    } catch (err) {
      lastParseError = err instanceof Error ? err.message : String(err);
    }
  }

  return { turn: null, error: lastParseError, rawPreview: stripped.slice(0, 240) };
}

export function parseStructuredTurn(rawText: string): ParsedAgentTurn | null {
  return parseStructuredTurnWithDiagnostics(rawText).turn;
}
