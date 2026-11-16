import { describe, expect, it } from "bun:test";
import { bedrockIdOf, toBedrockModelId } from "@/lib/bedrock-model-id";

describe("toBedrockModelId", () => {
  it("prefixes a model id, an inference-profile id and an ARN", () => {
    expect(toBedrockModelId("anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe(
      "bedrock:anthropic.claude-sonnet-4-5-20250929-v1:0",
    );
    expect(toBedrockModelId(" us.anthropic.claude-sonnet-4-5-20250929-v1:0 ")).toBe(
      "bedrock:us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    );
    const arn = "arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0";
    expect(toBedrockModelId(arn)).toBe(`bedrock:${arn}`);
  });

  it("keeps a single prefix when the stored form is pasted", () => {
    expect(toBedrockModelId("bedrock:us.anthropic.claude-haiku-4-5-20251001-v1:0")).toBe(
      "bedrock:us.anthropic.claude-haiku-4-5-20251001-v1:0",
    );
  });

  it("clears the selection for blank input or a bare prefix", () => {
    expect(toBedrockModelId("   ")).toBe("");
    expect(toBedrockModelId("bedrock:")).toBe("");
  });
});

describe("bedrockIdOf", () => {
  it("returns the id for a Bedrock model and nothing for any other model", () => {
    expect(bedrockIdOf("bedrock:us.anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe(
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    );
    expect(bedrockIdOf("claude-sonnet-5")).toBe("");
    expect(bedrockIdOf("acp:claude-sonnet")).toBe("");
    expect(bedrockIdOf("")).toBe("");
  });
});
