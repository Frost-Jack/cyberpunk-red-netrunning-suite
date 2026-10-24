/* Public regression entry point for the genuine WebGL view.
 * node tools/3d-test.mjs [--screenshot=C:/absolute/path.png]
 * Separate processes keep browser shutdown guards isolated. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const name of ["models-test", "presentation-test", "attack-effects-test", "webgl-test", "integration-ui-test"]) {
  const script = fileURLToPath(new URL(`./${name}.mjs`, import.meta.url));
  const args = name === "webgl-test" ? process.argv.slice(2) : [];
  const result = spawnSync(process.execPath, [script, ...args], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
