import { expect } from "chai";
import { describe, it } from "mocha";
import { act, renderHook } from "@testing-library/react";
import React from "react";

import { DooverProvider, useClientStatus } from "../react";
import type { DataClient, DataClientStatus } from "../client/data-client";

function controllableClient(): { client: DataClient; push(s: Partial<DataClientStatus>): void } {
  let status: DataClientStatus = { clientId: "x", connected: false, state: "disconnected", agentScope: "unknown", at: Date.now() };
  const listeners = new Set<(s: DataClientStatus) => void>();
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  return {
    client: {
      agents: noop, channels: noop, messages: noop, aggregates: noop, alarms: noop, connections: noop, notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
      gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {}, subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
      getCapabilities: () => new Set(), supports: () => false,
      isConnected: () => status.connected, getStatus: () => status,
      onStatusChange: (l: (s: DataClientStatus) => void) => { listeners.add(l); return () => listeners.delete(l); },
      getAgentScope: async () => ({ mode: "all" as const }), getKnownAgentScope: () => "unknown" as const,
    } as never,
    push(s: Partial<DataClientStatus>) { status = { ...status, ...s, at: Date.now() }; listeners.forEach((l) => l(status)); },
  };
}

describe("useClientStatus", () => {
  it("seeds with getStatus() and re-renders on onStatusChange", () => {
    const { client, push } = controllableClient();
    const { result } = renderHook(() => useClientStatus(), {
      wrapper: ({ children }) => <DooverProvider client={client}>{children}</DooverProvider>,
    });
    expect(result.current.state).to.equal("disconnected");
    act(() => push({ connected: true, state: "connected" }));
    expect(result.current.state).to.equal("connected");
    expect(result.current.connected).to.equal(true);
  });
});
