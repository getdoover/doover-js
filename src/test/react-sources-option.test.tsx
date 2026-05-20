import { expect } from "chai";
import { describe, it } from "mocha";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import { DooverProvider, useChannelAggregate, channelAggregateQueryKey } from "../react";
import { MultiplexClient } from "../client/multiplex-client";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

function aggMember(id: string, value: unknown): DataClient {
  const src = { client: { id, kind: id.startsWith("local") ? "local" : "cloud" }, retrievedAt: 0, via: { transport: "rest" as const, method: "aggregates.getAggregate", request: {}, startedAt: 0, durationMs: 0 } };
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  return {
    agents: noop,
    channels: { getChannel: async () => ({ name: "c", owner_id: id, is_private: false }) } as never,
    messages: noop,
    aggregates: { getAggregate: async () => ({ ...(value as object), __source: src }) } as never,
    alarms: noop, connections: noop, notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {}, subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => new Set(["aggregates.get", "channels.get", "gateway.subscribe"] as never),
    supports: (c: string) => ["aggregates.get", "channels.get", "gateway.subscribe"].includes(c),
    isConnected: () => false, getStatus: () => ({ clientId: id, connected: false, state: "disconnected" as const, agentScope: { mode: "all" as const }, at: 0 }),
    onStatusChange: () => () => {}, getAgentScope: async () => ({ mode: "all" as const }), getKnownAgentScope: () => ({ mode: "all" as const }),
  } as never;
}

describe("hooks: sources option + source-dimensioned keys", () => {
  it("useChannelAggregate forwards sources and uses a source-dimensioned key; unscoped uses '*'", async () => {
    const factory = (d: SourceDescriptor) => d.id === "cloud"
      ? aggMember("cloud", { data: { v: 1 }, attachments: [] })
      : aggMember("local:7", { data: { v: 2 }, attachments: [] });
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }, { id: "local:7", kind: "local" }], enableAll: true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}><DooverProvider client={mux}>{children}</DooverProvider></QueryClientProvider>
    );
    const scoped = renderHook(() => useChannelAggregate({ agentId: "dev7", channelName: "c" }, { sources: ["local:7"] }), { wrapper });
    await waitFor(() => expect(scoped.result.current.data).to.deep.equal({ v: 2 }));
    // its cache entry lives under the source-dimensioned key:
    expect(queryClient.getQueryData(channelAggregateQueryKey("dev7", "c", ["local:7"]))).to.exist;
    // an unscoped hook for the same channel uses the "*" key — distinct entry:
    expect(channelAggregateQueryKey("dev7", "c")).to.deep.equal(["doover", "agent", "dev7", "channel", "c", "src", "*"]);
  });
});
