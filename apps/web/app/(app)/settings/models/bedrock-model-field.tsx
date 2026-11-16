"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bedrockIdOf, toBedrockModelId } from "@/lib/bedrock-model-id";

/**
 * Free-form AWS Bedrock model id, stored as "bedrock:<id>". Bedrock model
 * access differs per AWS account and region and there is no catalog row for
 * these ids, so the field takes whatever the operator's account can invoke.
 */
export function BedrockModelField({
  value,
  onChange,
  isOwner,
}: {
  // The full selected model id; only "bedrock:" ids are shown in this field.
  value: string;
  onChange: (modelId: string) => void;
  isOwner: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="bedrockModelId">AWS Bedrock model</Label>
      <Input
        id="bedrockModelId"
        value={bedrockIdOf(value)}
        onChange={(e) => onChange(toBedrockModelId(e.target.value))}
        placeholder="e.g. us.anthropic.claude-sonnet-4-5-20250929-v1:0"
        disabled={!isOwner}
        autoComplete="off"
        maxLength={300}
      />
      <p className="text-xs text-muted-foreground">
        Optional. Enter a Claude model id, inference-profile id or ARN that this
        server&apos;s AWS credentials can invoke, to use it instead of the
        selection above. Saved as{" "}
        <code className="rounded bg-muted px-1 py-0.5">bedrock:&lt;model id&gt;</code>.
      </p>
    </div>
  );
}
