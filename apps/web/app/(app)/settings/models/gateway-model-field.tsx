"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const GATEWAY_MODEL_PREFIX = "acp:";

type GatewayModelList =
  | { status: "unconfigured" }
  | { status: "unavailable" }
  | { status: "ok"; models: string[] };

/**
 * Free-form model id for the OpenAI-compatible gateway, stored as "acp:<id>".
 * When the gateway is configured and serves /v1/models, its ids are offered as
 * suggestions; otherwise the field stays free-form with a short note.
 */
export function GatewayModelField({
  value,
  onChange,
  isOwner,
}: {
  // The full selected model id; only "acp:" ids are shown in this field.
  value: string;
  onChange: (modelId: string) => void;
  isOwner: boolean;
}) {
  const [list, setList] = useState<GatewayModelList | null>(null);

  // The listing is admin-only, so members never request it.
  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    fetch("/api/acp/models")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json() as Promise<GatewayModelList>;
      })
      .then((data) => {
        if (!cancelled) setList(data);
      })
      .catch(() => {
        if (!cancelled) setList({ status: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [isOwner]);

  const gatewayModelId = value.startsWith(GATEWAY_MODEL_PREFIX)
    ? value.slice(GATEWAY_MODEL_PREFIX.length)
    : "";
  const models = list?.status === "ok" ? list.models : [];

  return (
    <div className="space-y-2">
      <Label htmlFor="gatewayModelId">OpenAI-compatible gateway model</Label>
      <Input
        id="gatewayModelId"
        list="gatewayModelIds"
        value={gatewayModelId}
        onChange={(e) => {
          // Tolerate a pasted "acp:<id>" so the prefix is not stored twice.
          const typed = e.target.value.trim();
          const id = typed.startsWith(GATEWAY_MODEL_PREFIX)
            ? typed.slice(GATEWAY_MODEL_PREFIX.length)
            : typed;
          onChange(id ? `${GATEWAY_MODEL_PREFIX}${id}` : "");
        }}
        placeholder="e.g. claude-sonnet-4-6"
        disabled={!isOwner}
        autoComplete="off"
        maxLength={200}
      />
      <datalist id="gatewayModelIds">
        {models.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <p className="text-xs text-muted-foreground">
        Optional. Enter a model id served by your gateway (LiteLLM, CLIProxyAPI,
        vLLM, ...) to use it instead of the selection above. Saved as{" "}
        <code className="rounded bg-muted px-1 py-0.5">acp:&lt;model id&gt;</code>.
      </p>
      {list?.status === "ok" && (
        <p className="text-xs text-muted-foreground">
          {models.length} model{models.length === 1 ? "" : "s"} listed by the
          gateway.
        </p>
      )}
      {list?.status === "unavailable" && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          Could not list models from the gateway (/v1/models). Type the model id
          instead.
        </p>
      )}
      {list?.status === "unconfigured" && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          No gateway is configured. Add its base URL and API key under{" "}
          <Link href="/settings/api-keys" className="underline">
            Provider Keys
          </Link>{" "}
          first.
        </p>
      )}
    </div>
  );
}
