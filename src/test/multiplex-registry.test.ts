import { expect } from "chai";
import { describe, it } from "mocha";
import sinon from "sinon";

import { MultiplexClient } from "../client/multiplex-client";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

// A no-op DataClient stub with a controllable connected flag + gateway events.
function stubMember(id: string): DataClient & { _setConnected(v: boolean): void; _emit(): void; gatewayListeners: Set<() => void> } {
  let connected = false;
  const gwListeners = new Set<() => void>();
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  const statusListeners = new Set<(s: unknown) => void>();
  return {
    agents: noop, channels: noop, messages: noop, aggregates: noop, alarms: noop,
    connections: noop, notifications: noop, permissions: noop, processors: noop,
    turn: noop, users: noop, rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => { connected = false; }, reconnect: async () => {},
      on: (_e: string, h: () => void) => gwListeners.add(h), off: (_e: string, h: () => void) => gwListeners.delete(h),
      subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {},
      sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => connected,
      getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => new Set(["channels.list", "channels.get"] as const),
    supports: (c: string) => c === "channels.list" || c === "channels.get",
    isConnected: () => connected,
    getStatus: () => ({ clientId: id, connected, state: connected ? "connected" : "disconnected", agentScope: "all" as const, at: Date.now() }),
    onStatusChange: (l: (s: unknown) => void) => { statusListeners.add(l); return () => statusListeners.delete(l); },
    getAgentScope: async () => ({ mode: "all" as const }),
    getKnownAgentScope: () => ({ mode: "all" as const }),
    _setConnected(v: boolean) { connected = v; statusListeners.forEach((l) => l(undefined)); },
    _emit() { gwListeners.forEach((h) => h()); },
    gatewayListeners: gwListeners,
  } as never;
}

describe("MultiplexClient registry & activation", () => {
  it("builds a member via factory exactly once and reuses it on re-enable", () => {
    const built: Record<string, number> = {};
    const factory = sinon.spy((d: SourceDescriptor) => { built[d.id] = (built[d.id] ?? 0) + 1; return stubMember(d.id); });
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }], enable: ["cloud"] });
    expect(built.cloud).to.equal(1);
    mux.disableSource("cloud");
    mux.enableSource("cloud");
    expect(built.cloud).to.equal(1); // not rebuilt
    expect(mux.getActiveSources().map((s) => s.descriptor.id)).to.deep.equal(["cloud"]);
  });

  it("registerSource is idempotent on id (updates metadata only)", () => {
    const factory = sinon.spy((d: SourceDescriptor) => stubMember(d.id));
    const mux = new MultiplexClient({ factory });
    mux.registerSource({ id: "local:1", kind: "local", label: "A" });
    mux.registerSource({ id: "local:1", kind: "local", label: "B" });
    expect(mux.getRegisteredSources()).to.have.length(1);
    expect(mux.getRegisteredSources()[0].descriptor.label).to.equal("B");
    expect(factory.called).to.equal(false); // registering doesn't build
  });

  it("setActiveSources enables/disables to match exactly and is a no-op when unchanged", () => {
    const factory = sinon.spy((d: SourceDescriptor) => stubMember(d.id));
    const mux = new MultiplexClient({ factory });
    mux.setActiveSources([{ id: "cloud", kind: "cloud" }, { id: "local:1", kind: "local" }]);
    expect(mux.getActiveSources().map((s) => s.descriptor.id).sort()).to.deep.equal(["cloud", "local:1"]);
    const before = factory.callCount;
    mux.setActiveSources(["local:1", "cloud"]);
    expect(factory.callCount).to.equal(before);
    mux.setActiveSources(["cloud"]);
    expect(mux.getActiveSources().map((s) => s.descriptor.id)).to.deep.equal(["cloud"]);
    expect(mux.getRegisteredSources()).to.have.length(2);
  });

  it("disableSource keeps the client and (default) disconnects its gateway; removeSource discards", () => {
    const member = stubMember("local:1");
    const factory = () => member as never;
    const mux = new MultiplexClient({ factory, register: [{ id: "local:1", kind: "local" }], enable: ["local:1"] });
    member._setConnected(true);
    const disc = sinon.spy(member.gateway, "disconnect");
    mux.disableSource("local:1");
    expect(disc.called).to.equal(true);
    expect(mux.getRegisteredSources()[0].client).to.equal(member);
    mux.removeSource("local:1");
    expect(mux.getRegisteredSources()).to.have.length(0);
  });
});
