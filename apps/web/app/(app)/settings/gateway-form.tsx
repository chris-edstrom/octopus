"use client";

import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { IconX } from "@tabler/icons-react";
import { updateApiKeys } from "../actions";

export function GatewayForm({
  acpBaseUrl,
  acpApiKey,
  isOwner,
}: {
  acpBaseUrl: string | null;
  // Masked preview, not the full key (see ApiKeysForm).
  acpApiKey: string | null;
  isOwner: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateApiKeys, {});
  const [removing, startTransition] = useTransition();

  // updateApiKeys clears a gateway field that is submitted empty and leaves an
  // absent one unchanged. The key input is always blank on load, so drop it
  // when empty: saving a new URL must not wipe the stored key.
  function handleSave(formData: FormData) {
    if (!(formData.get("acpApiKey") as string | null)?.trim()) {
      formData.delete("acpApiKey");
    }
    formAction(formData);
  }

  function handleRemove() {
    const formData = new FormData();
    formData.set("acpBaseUrl", "");
    formData.set("acpApiKey", "");
    startTransition(() => formAction(formData));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>OpenAI-compatible gateway</CardTitle>
        <CardDescription>
          Route reviews through your own OpenAI-compatible endpoint (LiteLLM,
          CLIProxyAPI, vLLM, ...). Then choose a gateway model in Settings →
          Models.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={handleSave} className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="acpBaseUrl">Base URL</Label>
              {acpBaseUrl || acpApiKey ? (
                <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                  Configured
                  {isOwner && (
                    <button
                      type="button"
                      onClick={handleRemove}
                      disabled={removing || pending}
                      aria-label="Remove gateway"
                      className="text-muted-foreground hover:text-destructive -mr-1 ml-0.5"
                    >
                      <IconX size={12} />
                    </button>
                  )}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  Not set
                </Badge>
              )}
            </div>
            <Input
              key={acpBaseUrl ?? ""}
              id="acpBaseUrl"
              name="acpBaseUrl"
              type="url"
              defaultValue={acpBaseUrl ?? ""}
              placeholder="https://gateway.example.com"
              disabled={!isOwner}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Origin only (scheme, host, port). Any path is dropped; requests go
              to <code className="rounded bg-muted px-1 py-0.5">/v1/chat/completions</code>.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="acpApiKey">API key</Label>
              {acpApiKey ? (
                <Badge variant="outline" className="text-[10px] font-normal">
                  {acpApiKey}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  Not set
                </Badge>
              )}
            </div>
            <Input
              id="acpApiKey"
              name="acpApiKey"
              type="password"
              placeholder={acpApiKey ? "Leave blank to keep the current key" : "Gateway API key"}
              disabled={!isOwner}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Both fields are required for the gateway to be used.
            </p>
          </div>

          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          {state.success && (
            <p className="text-sm text-green-600">Gateway settings updated.</p>
          )}

          <Button
            type="submit"
            disabled={pending || removing || !isOwner}
            className="w-full"
            size="sm"
          >
            {pending ? "Saving..." : "Save Gateway"}
          </Button>

          {!isOwner && (
            <p className="text-muted-foreground text-center text-xs">
              Only owners and admins can manage the gateway.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
