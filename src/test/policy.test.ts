import { strict as assert } from "assert";
import { policyAllows } from "../utils/policy.js";
import type { KeyPolicy } from "../apis/agents-api.js";

const ORG = "2000002";
const GROUP = "3000003";
const ROOT = "3000001";
const AGENT = "1000001";

const allow = (actions: string[], resources?: string[]) => ({
  effect: "allow" as const,
  actions,
  resources: resources ?? [],
});
const policy = (...statements: KeyPolicy["statements"]): KeyPolicy => ({
  statements,
});
const onDevice = (action: string, channel?: string) => ({
  action,
  agent: AGENT,
  channel,
  org: ORG,
  groups: [GROUP, ROOT],
});

describe("policyAllows", () => {
  it("allows what a statement names, where it names", () => {
    const p = policy(allow(["data:agent.tunnel.open"], [`group:${GROUP}`]));
    assert.equal(policyAllows(p, onDevice("data:agent.tunnel.open")), true);
    assert.equal(policyAllows(p, onDevice("data:agent.tunnel.update")), false);
    assert.equal(
      policyAllows(p, { ...onDevice("data:agent.tunnel.open"), groups: [] }),
      false,
    );
  });

  it("matches one * anywhere, and never internal actions by wildcard", () => {
    const p = policy(allow(["data:channel.*", "*.get"], ["*"]));
    assert.equal(policyAllows(p, onDevice("data:channel.message.list")), true);
    assert.equal(policyAllows(p, onDevice("control:device.get")), true);
    assert.equal(policyAllows(p, onDevice("data:internal.token.get")), false);
    const internal = policy(allow(["data:internal.*"], ["*"]));
    assert.equal(
      policyAllows(internal, onDevice("data:internal.token.get")),
      true,
    );
  });

  it("lets a deny win, and a deny wildcard cover internal actions", () => {
    const p = policy(allow(["*", "data:internal.*"], ["*"]), {
      effect: "deny",
      actions: ["*"],
      resources: [`agent:${AGENT}`],
    });
    assert.equal(policyAllows(p, onDevice("data:channel.get")), false);
    assert.equal(policyAllows(p, onDevice("data:internal.token.get")), false);
  });

  it("reaches reserved channels only by naming them", () => {
    const p = policy(allow(["*"], [`org:${ORG}`]));
    assert.equal(
      policyAllows(p, onDevice("data:channel.get", "ui_state")),
      true,
    );
    assert.equal(
      policyAllows(p, onDevice("data:channel.get", "tunnels")),
      false,
    );
    const named = policy(allow(["*"], [`agent:${AGENT}/channel:tunnels`]));
    assert.equal(
      policyAllows(named, onDevice("data:channel.get", "tunnels")),
      true,
    );
  });

  it("applies a statement without resources everywhere, and control kinds by id", () => {
    assert.equal(
      policyAllows(
        policy(allow(["control:device.get"])),
        onDevice("control:device.get"),
      ),
      true,
    );
    const p = policy(allow(["control:application.update"], ["application:42"]));
    assert.equal(
      policyAllows(p, {
        action: "control:application.update",
        kind: "application",
        id: "42",
      }),
      true,
    );
    assert.equal(policyAllows(null, onDevice("data:channel.get")), false);
  });
});
