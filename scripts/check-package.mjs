import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
  assert(["--report", "--baseline"].includes(args[index]) && args[index + 1] && !options.has(args[index]),
    "Usage: node scripts/check-package.mjs [--report path.json] [--baseline built-package-directory]");
  options.set(args[index], resolve(root, args[index + 1]));
}
// Use a canonical path so macOS temp-directory symlinks do not change esbuild's metadata paths.
const temp = await mkdtemp(join(await realpath(tmpdir()), "doover-package-"));
const run = (command, commandArgs, cwd = temp) => execFileSync(command, commandArgs, {
  cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});

try {
  // Exercise what npm publishes, including its export map and declaration files.
  const [pack] = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temp], root));
  assert(!pack.files.some(({ path }) => /(^|\/)test(s)?\//.test(path)), "The package must exclude tests");
  const modules = join(temp, "node_modules");
  const packageDir = join(modules, pack.name);
  await mkdir(packageDir, { recursive: true });
  run("tar", ["-xzf", join(temp, pack.filename), "-C", packageDir, "--strip-components=1"]);
  const pkg = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
  assert.equal(pkg.sideEffects, false, "Unused modules must be removable");
  const esmMetadata = JSON.parse(await readFile(join(packageDir, "dist/esm/package.json"), "utf8"));
  assert.equal(esmMetadata.version, pkg.version, "Federated consumers must see the package version");
  const specifiers = Object.keys(pkg.exports).filter((path) => path !== "./package.json")
    .map((path) => path === "." ? pkg.name : pkg.name + path.slice(1));
  for (const [path, conditions] of Object.entries(pkg.exports)) {
    if (path === "./package.json") {
      assert.equal(conditions, "./package.json");
      continue;
    }
    assert(conditions.import?.types && conditions.import?.default, `${path}: ESM declarations and runtime required`);
    assert(conditions.require?.types && conditions.require?.default, `${path}: CommonJS declarations and runtime required`);
    assert.equal(conditions.module, conditions.import.default, `${path}: bundlers must share the ESM module`);
  }

  const runtimeFile = join(temp, "runtime.mjs");
  await writeFile(runtimeFile, `
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const name = ${JSON.stringify(pkg.name)};
const metadata = await import(name + "/package.json", { with: { type: "json" } });
assert.deepEqual(metadata.default, require(name + "/package.json"));
const specifiers = ${JSON.stringify(specifiers)}.filter((path) =>
  !process.argv.includes("--core") || !path.startsWith(name + "/react"));
const esm = new Map();
const cjs = new Map();
for (const path of specifiers) {
  esm.set(path, await import(path));
  cjs.set(path, require(path));
  assert.deepEqual(Object.keys(esm.get(path)).sort(), Object.keys(cjs.get(path)).sort(), path + ": export parity");
}
for (const loaded of [esm, cjs]) {
  const root = loaded.get(name);
  const react = loaded.get(name + "/react");
  for (const [path, entry] of loaded) {
    const parent = path.startsWith(name + "/react/") ? react : root;
    for (const key of Object.keys(entry)) {
      if (Object.hasOwn(parent, key)) assert.equal(entry[key], parent[key], path + ": shared " + key);
    }
  }
  assert.equal(root.extractSnowflakeId("0").timestamp, 1735689600000);
  const cloud = loaded.get(name + "/client");
  assert.equal(typeof cloud.getDooverClient, "function");
  assert.equal(cloud.getDooverClient, root.getDooverClient);
  cloud.resetDooverClient();
  const config = {
    dataRestUrl: "https://example.invalid/data", controlApiUrl: "https://example.invalid/control",
    dataWssUrl: "wss://example.invalid", disableBrowserLifecycleHooks: true,
  };
  const singleton = cloud.getDooverClient(config);
  assert.equal(cloud.getDooverClient(config), singleton);
  assert.equal(root.peekDooverClient(), singleton);
  cloud.resetDooverClient();
  const { RestClient } = loaded.get(name + "/http");
  const { ChannelsApi } = loaded.get(name + "/apis/channels");
  const requests = [];
  const rest = new RestClient({
    dataRestUrl: "https://example.invalid/data", controlApiUrl: "https://example.invalid/control",
    dataWssUrl: "wss://example.invalid", fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify([{ id: "channel-1" }]), { headers: { "content-type": "application/json" } });
    },
  });
  assert.deepEqual(await new ChannelsApi(rest).listChannels("agent-1"), [{ id: "channel-1" }]);
  assert.equal(requests[0].url, "https://example.invalid/data/agents/agent-1/channels");
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.headers.get("X-Doover-Sharing"), "internal");
}
`);
  // Core imports must work with no optional peers installed.
  run(process.execPath, [runtimeFile, "--core"]);
  for (const dependency of await readdir(join(root, "node_modules"))) {
    if (dependency === pkg.name || dependency.startsWith(".")) continue;
    await symlink(join(root, "node_modules", dependency), join(modules, dependency), "dir");
  }
  run(process.execPath, [runtimeFile]);

  // Mixed dependency formats in one bundle must share the provider's context and client class.
  const mixedFile = join(temp, "mixed-formats.cjs");
  const mixed = await build({
    absWorkingDir: temp, stdin: { resolveDir: temp, sourcefile: "mixed-formats.js", contents: `
      import { DooverProvider, useDooverClient } from "${pkg.name}/react";
      import { DooverClient } from "${pkg.name}";
      const context = require("${pkg.name}/react/context");
      const client = require("${pkg.name}/client");
      if (DooverProvider !== context.DooverProvider || useDooverClient !== context.useDooverClient)
        throw new Error("Mixed imports created separate React contexts");
      if (DooverClient !== client.DooverClient) throw new Error("Mixed imports created separate client classes");
    ` },
    bundle: true, platform: "browser", format: "cjs", target: "es2020", metafile: true,
    outfile: mixedFile, external: Object.keys(pkg.peerDependencies), logLevel: "silent",
  });
  const packageInputs = Object.keys(mixed.metafile.inputs).filter((path) => path.includes(`node_modules/${pkg.name}/dist/`));
  assert(packageInputs.length > 0 && packageInputs.every((path) => path.includes(`/dist/esm/`)),
    "Mixed-format bundle must resolve only ESM package files");
  assert.equal(packageInputs.filter((path) => path.endsWith("/react/context.js")).length, 1);
  run(process.execPath, [mixedFile]);

  const consumer = `${specifiers.map((path, index) => `import * as entry${index} from ${JSON.stringify(path)}; void entry${index};`).join("\n")}
import { DooverClient, type DataClient } from "${pkg.name}";
import { DooverClient as ScopedClient, getDooverClient } from "${pkg.name}/client";
import { RestClient } from "${pkg.name}/http";
import { ChannelsApi } from "${pkg.name}/apis/channels";
import type { JSONValue } from "${pkg.name}/types";
import { DooverProvider } from "${pkg.name}/react/context";
const config = { dataRestUrl: "https://example.invalid", controlApiUrl: "https://example.invalid", dataWssUrl: "wss://example.invalid" };
const scoped: ScopedClient = new DooverClient(config);
const client: DataClient = scoped;
const startupClient: DataClient = getDooverClient(config);
const channels = new ChannelsApi(new RestClient(config)).listChannels("agent-1");
const value: JSONValue = { channel: "channel-1" };
void [client, startupClient, channels, value, DooverProvider];
`;
  await Promise.all(["mts", "cts", "ts"].map((extension) => writeFile(join(temp, `consumer.${extension}`), consumer)));
  const tsc = join(root, "node_modules/typescript/bin/tsc");
  const common = [tsc, "--noEmit", "--strict", "--skipLibCheck", "false", "--target", "ES2020",
    "--lib", "ES2020,DOM,DOM.Iterable", "--types", "node", "--esModuleInterop", "--jsx", "react-jsx"];
  run(process.execPath, [...common, "--module", "NodeNext", "--moduleResolution", "NodeNext", "consumer.mts", "consumer.cts"]);
  run(process.execPath, [...common, "--module", "ESNext", "--moduleResolution", "Bundler", "consumer.ts"]);
  run(process.execPath, [...common, "--module", "CommonJS", "--moduleResolution", "Node", "consumer.ts"]);

  const cases = [
    { name: "utility-root", code: `export { extractSnowflakeId } from "${pkg.name}"`, budget: 512, small: true },
    { name: "utility-subpath", code: `export { extractSnowflakeId } from "${pkg.name}/utils"`, budget: 512, small: true },
    { name: "http-root", code: `export { RestClient } from "${pkg.name}"`, budget: 4500, small: true },
    { name: "http-subpath", code: `export { RestClient } from "${pkg.name}/http"`, budget: 4500, small: true },
    { name: "channels-composition", code: `import { RestClient } from "${pkg.name}/http";
      import { ChannelsApi } from "${pkg.name}/apis/channels";
      export const createChannels = (config) => new ChannelsApi(new RestClient(config));`, budget: 6500, small: true },
    { name: "client-root", code: `export { DooverClient } from "${pkg.name}"`, budget: 68000 },
    { name: "client-subpath", code: `export { DooverClient } from "${pkg.name}/client"`, budget: 68000 },
    { name: "startup-root", code: `export { getDooverClient } from "${pkg.name}"`, budget: 68000 },
    { name: "startup-subpath", code: `export { getDooverClient } from "${pkg.name}/client"`, budget: 68000 },
    { name: "react-status", code: `export { useClientStatus } from "${pkg.name}/react/useClientStatus"`, budget: 750, peers: true },
  ];
  const bundles = [];
  for (const entry of cases) {
    const buildOptions = {
      absWorkingDir: temp, stdin: { contents: entry.code, resolveDir: temp, sourcefile: `${entry.name}.js` },
      bundle: true, format: "esm", platform: "browser", target: "es2020", minify: true,
      write: false, metafile: true, outfile: join(temp, `${entry.name}.bundle.js`),
      external: entry.peers ? Object.keys(pkg.peerDependencies) : [],
      define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
    };
    const result = await build(buildOptions);
    const output = result.outputFiles[0].contents;
    const metadata = Object.values(result.metafile.outputs)[0];
    const contributors = Object.entries(metadata.inputs).filter(([, input]) => input.bytesInOutput > 0)
      .map(([path, input]) => ({ path: path === `${entry.name}.js` || path.endsWith(`/${entry.name}.js`) ? `fixture/${entry.name}.js`
        : path.replace(`node_modules/${pkg.name}/`, ""), bytes: input.bytesInOutput }));
    assert(output.length < entry.budget, `${entry.name}: ${output.length} bytes exceeds budget ${entry.budget}`);
    if (entry.name.startsWith("client-") || entry.name.startsWith("startup-")) {
      for (const { path } of contributors) {
        assert(!/offline-cache|multiplex-|local-agent-client|\/react\/|node_modules\/(react|@tanstack|@refinedev)/.test(path),
          `${entry.name}: optional feature retained from ${path}`);
      }
      assert.equal(metadata.imports.length, 0, `${entry.name}: unexpected external imports`);
    }
    if (entry.small) {
      for (const { path } of contributors) {
        assert(!/offline-cache|multiplex-|local-agent-client|gateway-client|rpc-dispatcher|node_modules\/(react|@tanstack|@refinedev)/.test(path),
          `${entry.name}: unrelated code retained from ${path}`);
        assert(path.startsWith("dist/esm/") || path.startsWith("fixture/"),
          `${entry.name}: expected the ESM package branch, got ${path}`);
      }
      assert.equal(metadata.imports.length, 0, `${entry.name}: unexpected external imports`);
    }
    const measurement = { name: entry.name, minifiedBytes: output.length, gzipBytes: gzipSync(output).length,
      budgetBytes: entry.budget, externalPeers: Boolean(entry.peers), contributors };
    if (options.has("--baseline")) {
      const baselineCode = entry.code.replaceAll(`${pkg.name}/react/useClientStatus`, `${pkg.name}/react`)
        .replaceAll(`${pkg.name}/apis/channels`, pkg.name)
        .replaceAll(`${pkg.name}/http`, pkg.name).replaceAll(`${pkg.name}/utils`, pkg.name)
        .replaceAll(`${pkg.name}/client`, pkg.name);
      const baseline = await build({ ...buildOptions,
        stdin: { ...buildOptions.stdin, contents: baselineCode },
        plugins: [{ name: "baseline-package", setup(builder) {
          builder.onResolve({ filter: /^doover-js(?:\/react)?$/ }, ({ path }) => ({
            path: join(options.get("--baseline"), "dist", path.endsWith("/react") ? "react/index.js" : "index.js"),
          }));
        } }],
      });
      measurement.baselineMinifiedBytes = baseline.outputFiles[0].contents.length;
      measurement.baselineGzipBytes = gzipSync(baseline.outputFiles[0].contents).length;
    }
    bundles.push(measurement);
  }
  for (const prefix of ["utility", "http", "client", "startup"]) {
    const size = (suffix) => bundles.find(({ name }) => name === `${prefix}-${suffix}`).minifiedBytes;
    assert.equal(size("root"), size("subpath"), `${prefix}: root import should tree shake as well as subpath`);
  }
  const report = { package: pkg.name, version: pkg.version, esbuildVersion: (await import("esbuild")).version,
    nodeVersion: process.version,
    typescriptVersion: JSON.parse(await readFile(join(root, "node_modules/typescript/package.json"), "utf8")).version,
    bundleOptions: { bundle: true, format: "esm", platform: "browser", target: "es2020", minify: true,
      define: { "process.env.NODE_ENV": '"production"' }, gzip: "node:zlib gzipSync defaults" },
    exportCount: specifiers.length, packedBytes: pack.size, unpackedBytes: pack.unpackedSize,
    packedFileCount: pack.files.length,
    checks: ["packed import/require exports", "shared module identity", "cloud startup singleton", "mixed-format bundle context and client identity", "core without optional peers",
      "HTTP channel request", "strict NodeNext ESM/CommonJS declarations", "strict bundler declarations",
      "strict legacy Node declarations", "bundle budgets and exclusions"],
    bundles };
  if (options.has("--baseline")) {
    const [baselinePack] = JSON.parse(run("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], options.get("--baseline")));
    const tests = baselinePack.files.filter(({ path }) => /(^|\/)test(s)?\//.test(path));
    report.baselinePackage = {
      packedBytes: baselinePack.size, unpackedBytes: baselinePack.unpackedSize,
      packedFileCount: baselinePack.files.length,
      testFileCount: tests.length, testBytes: tests.reduce((sum, file) => sum + file.size, 0),
    };
  }
  if (options.has("--report")) {
    const reportPath = options.get("--report");
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (error.stdout) console.error(String(error.stdout));
  if (error.stderr) console.error(String(error.stderr));
  throw error;
} finally {
  await rm(temp, { recursive: true, force: true });
}
