import { strict as assert } from "assert";
import { policyAllows } from "../utils/policy.js";

const req = (action: string, channel?: string) => ({
  action,
  agent: "1",
  channel,
  org: "2",
  groups: ["3", "4"],
});

describe("policyAllows", () => {
  it("matches actions and resources", () => {
    const p = {
      statements: [
        {
          effect: "allow" as const,
          actions: ["data:channel.*"],
          resources: ["group:3"],
        },
      ],
    };
    assert.equal(policyAllows(p, req("data:channel.get")), true);
    assert.equal(policyAllows(p, req("data:agent.get")), false);
    assert.equal(
      policyAllows(p, { ...req("data:channel.get"), groups: [] }),
      false,
    );
  });

  it("lets a deny win and keeps internal actions from allow wildcards", () => {
    const p = {
      statements: [
        { effect: "allow" as const, actions: ["*"], resources: [] },
        {
          effect: "deny" as const,
          actions: ["data:agent.*"],
          resources: ["agent:1"],
        },
      ],
    };
    assert.equal(policyAllows(p, req("data:channel.get")), true);
    assert.equal(policyAllows(p, req("data:agent.get")), false);
    assert.equal(policyAllows(p, req("data:internal.token.get")), false);
  });

  it("reaches reserved channels only by name", () => {
    const broad = {
      statements: [
        { effect: "allow" as const, actions: ["*"], resources: ["org:2"] },
      ],
    };
    const named = {
      statements: [
        {
          effect: "allow" as const,
          actions: ["*"],
          resources: ["agent:1/channel:tunnels"],
        },
      ],
    };
    assert.equal(
      policyAllows(broad, req("data:channel.get", "ui_state")),
      true,
    );
    assert.equal(
      policyAllows(broad, req("data:channel.get", "tunnels")),
      false,
    );
    assert.equal(policyAllows(named, req("data:channel.get", "tunnels")), true);
  });
});
