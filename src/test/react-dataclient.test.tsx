import { expect } from "chai";
import { describe, it } from "mocha";
import { renderHook } from "@testing-library/react";
import React from "react";

import { DooverProvider, useDooverClient } from "../react";
import { MultiplexClient } from "../client/multiplex-client";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

function stubMember(id: string): DataClient {
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  return {
    agents: noop, channels: noop, messages: noop, aggregates: noop, alarms: noop, connections: noop, notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {}, subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => new Set(["channels.list"] as never), supports: () => true,
    isConnected: () => false, getStatus: () => ({ clientId: id, connected: false, state: "disconnected" as const, agentScope: "unknown" as const, at: Date.now() }),
    onStatusChange: () => () => {}, getAgentScope: async () => ({ mode: "list" as const, agentIds: [] }), getKnownAgentScope: () => "unknown" as const,
  } as never;
}

describe("DooverProvider with a DataClient", () => {
  it("accepts a MultiplexClient and useDooverClient returns it", () => {
    const factory = (d: SourceDescriptor) => stubMember(d.id);
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }], enable: ["cloud"] });
    const { result } = renderHook(() => useDooverClient(), {
      wrapper: ({ children }) => <DooverProvider client={mux}>{children}</DooverProvider>,
    });
    expect(result.current).to.equal(mux);
  });
});
