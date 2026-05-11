import { expect } from "chai";
import { describe, it } from "mocha";

import { MultiplexClient } from "../client/multiplex-client";
import type { DataClient, DataClientStatus, SourceDescriptor } from "../client/multiplex-client";

function statefulMember(id: string): { member: DataClient; setConnected(v: boolean): void; setState(s: DataClientStatus["state"]): void } {
  let connected = false;
  let state: DataClientStatus["state"] = "disconnected";
  const listeners = new Set<(s: DataClientStatus) => void>();
  const fire = () => listeners.forEach((l) => l({ clientId: id, connected, state, agentScope: { mode: "all" }, at: Date.now() }));
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  return {
    member: {
      agents: noop, channels: noop, messages: noop, aggregates: noop, alarms: noop, connections: noop, notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
      gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {}, subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => connected, getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
      getCapabilities: () => new Set(["gateway.subscribe"] as never), supports: (c: string) => c === "gateway.subscribe",
      isConnected: () => connected,
      getStatus: () => ({ clientId: id, connected, state, agentScope: { mode: "all" }, at: Date.now() }),
      onStatusChange: (l: (s: DataClientStatus) => void) => { listeners.add(l); return () => listeners.delete(l); },
      getAgentScope: async () => ({ mode: "all" as const }), getKnownAgentScope: () => ({ mode: "all" as const }),
    } as never,
    setConnected(v: boolean) { connected = v; state = v ? "connected" : "disconnected"; fire(); },
    setState(s: DataClientStatus["state"]) { state = s; fire(); },
  };
}

describe("MultiplexClient status rollup", () => {
  it("isConnected = all gateway-subscribe members connected; state degrades; members[] present; onStatusChange fires", () => {
    const a = statefulMember("cloud");
    const b = statefulMember("local:7");
    const factory = (d: SourceDescriptor) => d.id === "cloud" ? a.member : b.member;
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud", label: "Cloud" }, { id: "local:7", kind: "local" }], enableAll: true });
    const seen: DataClientStatus[] = [];
    const off = mux.onStatusChange((s) => seen.push(s));

    expect(mux.isConnected()).to.equal(false);
    let st = mux.getStatus();
    expect(st.clientId).to.equal("multiplex");
    expect(st.members).to.have.length(2);
    expect(st.state).to.equal("disconnected");

    a.setConnected(true);
    st = mux.getStatus();
    expect(st.connected).to.equal(false); // not ALL connected
    expect(st.state).to.equal("degraded");

    b.setConnected(true);
    st = mux.getStatus();
    expect(st.connected).to.equal(true);
    expect(st.state).to.equal("connected");

    a.setState("error");
    expect(mux.getStatus().state).to.equal("error");

    expect(seen.length).to.be.greaterThan(2);
    off();
    const n = seen.length;
    b.setState("error");
    expect(seen.length).to.equal(n); // unsubscribed
  });

  it("disabled members appear in members[] as 'disconnected'", () => {
    const a = statefulMember("cloud");
    const factory = (d: SourceDescriptor) => d.id === "cloud" ? a.member : statefulMember(d.id).member;
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }, { id: "local:7", kind: "local" }], enable: ["cloud"] });
    const st = mux.getStatus();
    const local = st.members!.find((m) => m.sourceId === "local:7")!;
    expect(local.status.state).to.equal("disconnected");
  });
});
