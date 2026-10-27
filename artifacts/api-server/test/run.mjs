import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const bundlePath = join(tmpdir(), `cloudnest-api-preview-tests-${process.pid}.mjs`);
try {
  await build({
    entryPoints: ["./test/preview.test.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: bundlePath,
    external: ["node:*"],
  });
  const result = spawnSync(process.execPath, ["--test", bundlePath], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(bundlePath, { force: true });
}
