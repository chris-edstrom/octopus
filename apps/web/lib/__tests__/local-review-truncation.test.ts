import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

it("flags local reviews whose model output was cut off", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/local-review-truncation.ts", import.meta.url))], {
    stdout: "pipe", stderr: "pipe",
  });
  const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, error).toBe(0);
  expect(output.trim().split("\n").at(-1)).toBe("local review truncation checks passed");
}, 30_000);
