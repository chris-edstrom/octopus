import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

// Opt-in: needs a running Gitea. `scripts/gitea-live-test.sh` starts a disposable
// one and sets these. Without them the test is skipped, so the default suite
// stays hermetic.
const configured = Boolean(process.env.GITEA_LIVE_URL && process.env.GITEA_LIVE_TOKEN);

it.skipIf(!configured)("reads, publishes and receives webhooks against a live Gitea server", async () => {
  const harness = fileURLToPath(new URL("./fixtures/gitea-live-harness.ts", import.meta.url));
  const child = Bun.spawn([process.execPath, harness], { stdout: "pipe", stderr: "pipe" });
  const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, error).toBe(0);
  expect(output.trim()).toMatch(/^Gitea \S+ live checks passed \(\d+ webhook deliveries\)$/);
}, 120_000);
