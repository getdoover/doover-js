// src/test/multiplex-passthrough.test.ts — reuses the dataMember helper pattern from multiplex-reads.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { MultiplexClient } from "../client/multiplex-client";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

function dataMember(id: string, channels: { name: string }[]): DataClient {
  const src = { client: { id, kind: id.startsWith("local") ? "local" : "cloud" }, retrievedAt: Date.now(), via: { transport: "rest" as const, method: "channels.listChannels", request: {}, startedAt: 0, durationMs: 1 } };
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  return {
    agents: noop, channels: { listChannels: async () => channels.map((c) => ({ ...c, is_private: false, owner_id: "o", __source: src })) } as never,
    messages: noop, aggregates: noop, alarms: noop, connections: noop, notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {}, subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => new Set(["channels.list"] as never), supports: (c: string) => c === "channels.list",
    isConnected: () => false, getStatus: () => ({ clientId: id, connected: false, state: "disconnected", agentScope: { mode: "all" as const }, at: Date.now() }),
    onStatusChange: () => () => {}, getAgentScope: async () => ({ mode: "all" as const }), getKnownAgentScope: () => ({ mode: "all" as const }),
  } as never;
}

describe("MultiplexClient pass-through & re-enable", () => {
  it("merged items keep their member __source (no re-stamp); disabled member drops out; re-enable rejoins (no rebuild)", async () => {
    let builds = 0;
    const factory = (d: SourceDescriptor) => { builds += 1; return dataMember(d.id, d.id === "cloud" ? [{ name: "cloudch" }] : [{ name: "localch" }]); };
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }, { id: "local:7", kind: "local" }], enableAll: true });
    let list = await mux.channels.listChannels("dev7");
    expect(list.map((c) => c.name).sort()).to.deep.equal(["cloudch", "localch"]);
    expect(list.find((c) => c.name === "localch")!.__source?.client.id).to.equal("local:7");
    mux.disableSource("local:7");
    list = await mux.channels.listChannels("dev7");
    expect(list.map((c) => c.name)).to.deep.equal(["cloudch"]); // local dropped out
    mux.enableSource("local:7");
    list = await mux.channels.listChannels("dev7");
    expect(list.map((c) => c.name).sort()).to.deep.equal(["cloudch", "localch"]); // rejoined
    expect(builds).to.equal(2); // never rebuilt
  });
});
