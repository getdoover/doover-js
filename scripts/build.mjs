import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const cwd = fileURLToPath(new URL("../", import.meta.url));
const compiler = require.resolve("typescript/bin/tsc");

// Start clean so removed modules and previously compiled tests cannot ship.
rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });
for (const config of ["tsconfig.build.json", "tsconfig.esm.json"]) {
  execFileSync(process.execPath, [compiler, "-p", config], { cwd, stdio: "inherit" });
}
// Both JavaScript and declarations in this directory are native ES modules.
writeFileSync(
  new URL("../dist/esm/package.json", import.meta.url),
  '{"type":"module","sideEffects":false}\n',
);
