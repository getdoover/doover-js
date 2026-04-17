import { expect } from "chai";
import { afterEach, describe, it } from "mocha";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { ConfigManager } from "../node/config-manager";
import { AuthProfile } from "../auth/auth-profile";

function tmpConfigPath() {
  return path.join(os.tmpdir(), `doover-test-${Date.now()}-${Math.random().toString(36).slice(2)}`, "config");
}

function cleanup(configPath: string) {
  try {
    fs.unlinkSync(configPath);
  } catch { /* ignore */ }
  try {
    fs.rmdirSync(path.dirname(configPath));
  } catch { /* ignore */ }
}

describe("ConfigManager", () => {
  const paths: string[] = [];

  afterEach(() => {
    for (const p of paths) {
      cleanup(p);
    }
    paths.length = 0;
  });

  it("starts empty when config file does not exist", () => {
    const p = tmpConfigPath();
    paths.push(p);
    const mgr = new ConfigManager(p);
    expect(mgr.currentProfile).to.equal(null);
    expect(mgr.current).to.equal(null);
    expect(mgr.get("any")).to.be.undefined;
  });

  it("parses a reduced-format Doover2 config file", () => {
    const p = tmpConfigPath();
    paths.push(p);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
      p,
      [
        "[profile=prod]",
        "TOKEN=abc123",
        "AGENT_ID=agent-1",
        "REFRESH_TOKEN=rt-xyz",
        "AUTH_SERVER_URL=https://auth.example.com",
        "AUTH_SERVER_CLIENT_ID=client-1",
        "",
        "[profile=staging]",
        "TOKEN=stg-tok",
      ].join("\n"),
      "utf-8",
    );

    const mgr = new ConfigManager(p);
    expect(mgr.currentProfile).to.equal("prod");
    const prod = mgr.get("prod");
    expect(prod).to.not.be.undefined;
    expect(prod!.token).to.equal("abc123");
    expect(prod!.agentId).to.equal("agent-1");
    expect(prod!.refreshToken).to.equal("rt-xyz");

    const staging = mgr.get("staging");
    expect(staging).to.not.be.undefined;
    expect(staging!.token).to.equal("stg-tok");
  });

  it("preserves legacy Doover1 blocks verbatim", () => {
    const p = tmpConfigPath();
    paths.push(p);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const legacyBlock = "[legacy-section]\nSOME_KEY=some_value\nOTHER=123";
    fs.writeFileSync(
      p,
      `${legacyBlock}\n\n[profile=prod]\nTOKEN=t1\n`,
      "utf-8",
    );

    const mgr = new ConfigManager(p);
    mgr.write();

    const written = fs.readFileSync(p, "utf-8");
    // The legacy block should appear verbatim before the managed profile
    expect(written).to.include("[legacy-section]\nSOME_KEY=some_value\nOTHER=123");
    expect(written).to.include("[profile=prod]\nTOKEN=t1");
  });

  it("rewrites legacy Doover2 blocks back in reduced format", () => {
    const p = tmpConfigPath();
    paths.push(p);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
      p,
      "[profile=test]\nTOKEN=old\nAGENT_ID=a1\n",
      "utf-8",
    );

    const mgr = new ConfigManager(p);
    // Modify the profile
    const profile = mgr.get("test")!;
    profile.token = "new-token";
    mgr.create(profile);
    mgr.write();

    const written = fs.readFileSync(p, "utf-8");
    expect(written).to.include("TOKEN=new-token");
    expect(written).to.include("AGENT_ID=a1");
  });

  it("write() creates the .doover directory if missing", () => {
    const p = tmpConfigPath();
    paths.push(p);
    const mgr = new ConfigManager(p);
    const profile = new AuthProfile({ profile: "test", token: "t" });
    mgr.create(profile);
    mgr.write();

    expect(fs.existsSync(p)).to.equal(true);
    const content = fs.readFileSync(p, "utf-8");
    expect(content).to.include("[profile=test]");
    expect(content).to.include("TOKEN=t");
  });

  it("delete removes a managed profile", () => {
    const p = tmpConfigPath();
    paths.push(p);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "[profile=a]\nTOKEN=1\n\n[profile=b]\nTOKEN=2\n", "utf-8");

    const mgr = new ConfigManager(p);
    expect(mgr.get("a")).to.not.be.undefined;
    mgr.delete("a");
    expect(mgr.get("a")).to.be.undefined;
    mgr.write();

    const written = fs.readFileSync(p, "utf-8");
    expect(written).not.to.include("[profile=a]");
    expect(written).to.include("[profile=b]");
  });
});

describe("doover-js/node exports", () => {
  it("exports ConfigManager from the node subpath", () => {
    // Verify the node subpath module re-exports ConfigManager
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeExports = require("../node/index");
    expect(nodeExports.ConfigManager).to.equal(ConfigManager);
  });
});
