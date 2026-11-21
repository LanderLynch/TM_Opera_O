import { ToolValidationError } from "../core/errors";
import { ParameterSchema } from "./toolTypes";

export function validateToolArguments(
  toolName: string,
  schema: ParameterSchema,
  args: unknown
): Record<string, unknown> {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new ToolValidationError(toolName, "Arguments must be a JSON object.");
  }

  const record = args as Record<string, unknown>;
  const required = schema.required || [];
  for (const key of required) {
    if (record[key] === undefined || record[key] === null) {
      throw new ToolValidationError(toolName, `Missing required argument "${key}".`);
    }
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(record)) {
      if (!(key in schema.properties)) {
        throw new ToolValidationError(toolName, `Unexpected argument "${key}".`);
      }
    }
  }

  const validated: Record<string, unknown> = {};
  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const val = record[key];
    if (val === undefined) continue;

    if (propSchema.type === "array") {
      if (!Array.isArray(val)) {
        throw new ToolValidationError(toolName, `Argument "${key}" must be an array.`);
      }
      validated[key] = val;
      continue;
    }

    if (propSchema.type === "object") {
      if (val === null || typeof val !== "object" || Array.isArray(val)) {
        throw new ToolValidationError(toolName, `Argument "${key}" must be an object.`);
      }
      validated[key] = val;
      continue;
    }

    if (typeof val !== propSchema.type) {
      throw new ToolValidationError(
        toolName,
        `Argument "${key}" must be of type ${propSchema.type}, got ${typeof val}.`
      );
    }

    if (typeof val === "string") {
      if (propSchema.minLength !== undefined && val.length < propSchema.minLength) {
        throw new ToolValidationError(
          toolName,
          `Argument "${key}" must be at least ${propSchema.minLength} characters.`
        );
      }
      if (propSchema.maxLength !== undefined && val.length > propSchema.maxLength) {
        throw new ToolValidationError(
          toolName,
          `Argument "${key}" exceeds max length ${propSchema.maxLength}.`
        );
      }
      if (propSchema.enum && !propSchema.enum.includes(val)) {
        throw new ToolValidationError(
          toolName,
          `Argument "${key}" must be one of [${propSchema.enum.join(", ")}].`
        );
      }
    }

    if (typeof val === "number") {
      if (!Number.isFinite(val)) {
        throw new ToolValidationError(toolName, `Argument "${key}" must be a finite number.`);
      }
      if (propSchema.minimum !== undefined && val < propSchema.minimum) {
        throw new ToolValidationError(
          toolName,
          `Argument "${key}" must be >= ${propSchema.minimum}.`
        );
      }
      if (propSchema.maximum !== undefined && val > propSchema.maximum) {
        throw new ToolValidationError(
          toolName,
          `Argument "${key}" must be <= ${propSchema.maximum}.`
        );
      }
    }

    validated[key] = val;
  }

  return validated;
}
