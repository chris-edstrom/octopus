import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

// Opt-in: calls real AWS and is billed. Set BEDROCK_LIVE_MODEL to a model id or
// inference profile enabled in the account, with AWS_REGION and AWS credentials:
//   AWS_PROFILE=dev AWS_REGION=us-east-1 \
//   BEDROCK_LIVE_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0 \
//   bun test apps/web/lib/__tests__/bedrock-live.test.ts
// Without it the test is skipped, so the default suite stays hermetic.
const configured = Boolean(process.env.BEDROCK_LIVE_MODEL);

it.skipIf(!configured)("sends a request and reads its prompt cache back on real Bedrock", async () => {
  const harness = fileURLToPath(new URL("./fixtures/bedrock-live-harness.ts", import.meta.url));
  const child = Bun.spawn([process.execPath, harness], { stdout: "pipe", stderr: "pipe" });
  const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, error).toBe(0);
  expect(output.trim()).toMatch(/^Bedrock \S+ live checks passed \(\d+ cached tokens read\)$/);
}, 120_000);
