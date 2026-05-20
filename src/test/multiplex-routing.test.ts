import { expect } from "chai";
import { describe, it } from "mocha";

import { MultiplexClient } from "../client/multiplex-client";
import type { AgentScope, DataClient, SourceDescriptor } from "../client/multiplex-client";

function member(id: string, scope: () => AgentScope | "unknown", caps: string[] = ["channels.get"]): DataClient {
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  return {
    agents: noop, channels: noop, messages: noop, aggregates: noop, alarms: noop, connections: noop,
    notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {},
      subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {},
      sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0,
      getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => new Set(caps as never), supports: (c: string) => caps.includes(c),
    isConnected: () => false, getStatus: () => ({ clientId: id, connected: false, state: "disconnected", agentScope: scope(), at: Date.now() }),
    onStatusChange: () => () => {},
    getAgentScope: async () => { const s = scope(); return s === "unknown" ? { mode: "list", agentIds: [] } : s; },
    getKnownAgentScope: scope,
  } as never;
}

describe("MultiplexClient agent-scope routing", () => {
  it("membersForAgent: cloud (scope 'all') always included; local iff its list has the agent; 'unknown' included optimistically", () => {
    let localScope: AgentScope | "unknown" = "unknown";
    const factory = (d: SourceDescriptor) =>
      d.id === "cloud" ? member("cloud", () => ({ mode: "all" }))
        : member("local", () => localScope);
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }, { id: "local", kind: "local" }], enableAll: true });
    const m = mux as unknown as { membersForAgent(agentId: string): Array<{ id: string }> };
    expect(m.membersForAgent("dev7").map((x) => x.id).sort()).to.deep.equal(["cloud", "local"]);
    localScope = { mode: "list", agentIds: ["dev9"] };
    expect(m.membersForAgent("dev7").map((x) => x.id)).to.deep.equal(["cloud"]);
    localScope = { mode: "list", agentIds: ["dev7"] };
    expect(m.membersForAgent("dev7").map((x) => x.id).sort()).to.deep.equal(["cloud", "local"]);
  });

  it("getAgentScope rollup: 'all' if any enabled member is 'all'; else union list", async () => {
    const factory = (d: SourceDescriptor) =>
      d.id === "cloud" ? member("cloud", () => ({ mode: "all" }))
        : member(d.id, () => ({ mode: "list", agentIds: [d.id.replace("local:", "")] }));
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }, { id: "local:a", kind: "local" }, { id: "local:b", kind: "local" }], enableAll: true });
    expect(await mux.getAgentScope()).to.deep.equal({ mode: "all" });
    mux.disableSource("cloud");
    const rolled = await mux.getAgentScope();
    expect(rolled).to.deep.equal({ mode: "list", agentIds: ["a", "b"] });
    expect(mux.getKnownAgentScope()).to.deep.equal({ mode: "list", agentIds: ["a", "b"] });
  });
});
