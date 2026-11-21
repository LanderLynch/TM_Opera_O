import { PermissionLevel } from "./toolTypes";

export interface PermissionDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
}

const CONFIRM_ONLY_TOOLS = new Set<string>([
  "send_external_message",
  "delete_file",
  "execute_folder_organization",
]);

export function evaluateToolPermission(
  toolName: string,
  declaredLevel: PermissionLevel
): PermissionDecision {
  if (declaredLevel === "confirm" || CONFIRM_ONLY_TOOLS.has(toolName)) {
    return {
      allowed: true,
      requiresApproval: true,
      reason: `Tool "${toolName}" requires explicit user confirmation.`,
    };
  }
  return {
    allowed: true,
    requiresApproval: false,
  };
}
