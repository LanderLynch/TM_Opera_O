export type PermissionLevel = "autonomous" | "confirm";

export interface ParameterPropertySchema {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  enum?: readonly string[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export interface ParameterSchema {
  type: "object";
  required?: readonly string[];
  properties: Record<string, ParameterPropertySchema>;
  additionalProperties?: boolean;
}

export interface ToolContext {
  taskId: string;
  signal: AbortSignal;
}

export interface ToolResult {
  success: boolean;
  output: unknown;
  evidence: string;
  error?: string;
}

export interface AgentTool {
  name: string;
  description: string;
  permissionLevel: PermissionLevel;
  timeoutMs?: number;
  parameterSchema: ParameterSchema;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
  verify?(args: Record<string, unknown>, result: ToolResult, ctx: ToolContext): Promise<{
    verified: boolean;
    evidence: string;
  }>;
}
