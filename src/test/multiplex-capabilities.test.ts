import { expect } from "chai";
import { describe, it } from "mocha";

import { MultiplexClient } from "../client/multiplex-client";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

function memberWithCaps(id: string, caps: string[]): DataClient {
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  return {
    agents: noop, channels: noop, messages: noop, aggregates: noop, alarms: noop, connections: noop,
    notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {},
      subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {},
      sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0,
      getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => new Set(caps as never),
    supports: (c: string) => caps.includes(c),
    isConnected: () => false,
    getStatus: () => ({ clientId: id, connected: false, state: "disconnected", agentScope: "all" as const, at: Date.now() }),
    onStatusChange: () => () => {},
    getAgentScope: async () => ({ mode: "all" as const }),
    getKnownAgentScope: () => ({ mode: "all" as const }),
  } as never;
}

describe("MultiplexClient capabilities", () => {
  it("is the union over enabled members; recomputed on enable/disable", () => {
    const factory = (d: SourceDescriptor) =>
      d.id === "cloud" ? memberWithCaps("cloud", ["channels.list", "messages.listHistorical"])
        : memberWithCaps("local", ["channels.list", "messages.list"]);
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }, { id: "local", kind: "local" }], enable: ["cloud"] });
    expect([...mux.getCapabilities()].sort()).to.deep.equal(["channels.list", "messages.listHistorical"]);
    mux.enableSource("local");
    expect([...mux.getCapabilities()].sort()).to.deep.equal(["channels.list", "messages.list", "messages.listHistorical"]);
    mux.disableSource("cloud");
    expect([...mux.getCapabilities()].sort()).to.deep.equal(["channels.list", "messages.list"]);
    expect(mux.supports("messages.list")).to.equal(true);
    expect(mux.supports("messages.listHistorical")).to.equal(false);
  });
});
