export const BEDROCK_MODEL_PREFIX = "bedrock:";

/** The Bedrock id inside a stored model id, or "" when the model is not a Bedrock one. */
export function bedrockIdOf(modelId: string): string {
  return modelId.startsWith(BEDROCK_MODEL_PREFIX) ? modelId.slice(BEDROCK_MODEL_PREFIX.length) : "";
}

/**
 * The stored model id for a typed Bedrock model id, inference-profile id or
 * ARN. A pasted "bedrock:<id>" keeps a single prefix; blank input returns "",
 * which clears the selection.
 */
export function toBedrockModelId(typed: string): string {
  const id = typed.trim();
  if (!id) return "";
  return id.startsWith(BEDROCK_MODEL_PREFIX) ? (bedrockIdOf(id).trim() ? id : "") : `${BEDROCK_MODEL_PREFIX}${id}`;
}
