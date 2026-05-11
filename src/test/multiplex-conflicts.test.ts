// src/test/multiplex-conflicts.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { MultiplexClient } from "../client/multiplex-client";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

function aggMember(id: string, scope: { mode: "all" } | { mode: "list"; agentIds: string[] }, value: unknown): DataClient {
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  return {
    agents: noop, channels: noop, messages: noop,
    aggregates: { getAggregate: async () => ({ ...(value as object), __source: { client: { id, kind: "x" }, retrievedAt: 0, via: { transport: "rest", method: "aggregates.getAggregate", request: {}, startedAt: 0, durationMs: 0 } } }) } as never,
    alarms: noop, connections: noop, notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {}, subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => new Set(["aggregates.get"] as never), supports: (c: string) => c === "aggregates.get",
    isConnected: () => false, getStatus: () => ({ clientId: id, connected: false, state: "disconnected", agentScope: scope, at: Date.now() }),
    onStatusChange: () => () => {},
    getAgentScope: async () => scope, getKnownAgentScope: () => scope,
  } as never;
}

describe("MultiplexClient conflicts", () => {
  it("getAggregate across two owning members → first wins, conflict emitted + snapshot recorded", async () => {
    const factory = (d: SourceDescriptor) => d.id === "cloud" ? aggMember("cloud", { mode: "all" }, { data: { v: 1 }, attachments: [] }) : aggMember("local:7", { mode: "list", agentIds: ["dev7"] }, { data: { v: 2 }, attachments: [] });
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }, { id: "local:7", kind: "local" }], enableAll: true });
    const events: unknown[] = [];
    mux.on("conflict", (c) => events.push(c));
    const agg = await mux.aggregates.getAggregate("dev7", "c");
    expect((agg as unknown as { data: { v: number } }).data.v).to.equal(1); // first member
    expect(agg.__source?.client.id).to.equal("cloud");
    expect(events).to.have.length(1);
    const conflicts = mux.getLastConflicts();
    expect(conflicts).to.have.length(1);
    expect(conflicts[0].method).to.equal("aggregates.getAggregate");
    expect(conflicts[0].sourceIds.sort()).to.deep.equal(["cloud", "local:7"]);
  });
});
