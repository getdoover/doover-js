import { expect } from "chai";
import { describe, it } from "mocha";

import { MultiplexClient } from "../client/multiplex-client";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

// A member with a controllable fake gateway.
function gwMember(id: string, scope: { mode: "all" } | { mode: "list"; agentIds: string[] }) {
  const subs: string[] = [];
  let connected = false;
  const channelHandlers = new Map<string, Set<{ onMessage?: (m: unknown) => void }>>();
  const eventListeners = new Map<string, Set<(...a: unknown[]) => void>>();
  const member = {
    agents: {} as never, channels: {} as never, messages: {} as never, aggregates: {} as never,
    alarms: {} as never, connections: {} as never, notifications: {} as never, permissions: {} as never,
    processors: {} as never, turn: {} as never, users: {} as never, rpc: {} as never,
    gateway: {
      connect: async () => { connected = true; }, disconnect: () => { connected = false; }, reconnect: async () => {},
      on: (event: string, handler: (...a: unknown[]) => void) => {
        if (!eventListeners.has(event)) eventListeners.set(event, new Set());
        eventListeners.get(event)!.add(handler);
      },
      off: (event: string, handler: (...a: unknown[]) => void) => {
        eventListeners.get(event)?.delete(handler);
      },
      subscribe: (c: { agent_id: string; name: string }) => subs.push(`${c.agent_id}/${c.name}`),
      unsubscribe: (c: { agent_id: string; name: string }) => { const i = subs.indexOf(`${c.agent_id}/${c.name}`); if (i >= 0) subs.splice(i, 1); },
      subscribeToChannel: (c: { agent_id: string; name: string }, h: { onMessage?: (m: unknown) => void }) => {
        const k = `${c.agent_id}/${c.name}`;
        if (!channelHandlers.has(k)) {
          channelHandlers.set(k, new Set());
          subs.push(k); // mirrors real GatewayClient: subscribeToChannel calls subscribe internally
        }
        channelHandlers.get(k)!.add(h);
        return () => {
          channelHandlers.get(k)?.delete(h);
          if ((channelHandlers.get(k)?.size ?? 0) === 0) {
            channelHandlers.delete(k);
            const i = subs.indexOf(k);
            if (i >= 0) subs.splice(i, 1); // mirrors real GatewayClient: last unsub triggers unsubscribe
          }
        };
      },
      syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => connected ? { session_id: `${id}-s` } : null,
      isConnected: () => connected, getSubscriptionCount: () => subs.length, getSubscriptions: () => subs.map((s) => ({ agent_id: s.split("/")[0], name: s.split("/")[1] })), setStats: () => {},
    } as never,
    getCapabilities: () => new Set(["gateway.subscribe", "gateway.realtime"] as never),
    supports: (c: string) => c === "gateway.subscribe" || c === "gateway.realtime",
    isConnected: () => connected, getStatus: () => ({ clientId: id, connected, state: connected ? "connected" : "disconnected", agentScope: scope, at: Date.now() }),
    onStatusChange: () => () => {},
    getAgentScope: async () => scope, getKnownAgentScope: () => scope,
  } as unknown as DataClient;
  return {
    member, subs,
    deliver(k: string, m: unknown) { channelHandlers.get(k)?.forEach((h) => h.onMessage?.(m)); },
    emit(event: string, ...args: unknown[]) { eventListeners.get(event)?.forEach((h) => h(...args)); },
    isConnected: () => connected,
  };
}

describe("MultiplexGateway", () => {
  it("subscribeToChannel routes to owning members; unsubscribe tears down; connect/isConnected aggregate", async () => {
    const c = gwMember("cloud", { mode: "all" });
    const l = gwMember("local:7", { mode: "list", agentIds: ["dev7"] });
    const factory = (d: SourceDescriptor) => d.id === "cloud" ? c.member : l.member;
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }, { id: "local:7", kind: "local" }], enableAll: true });

    await mux.gateway.connect();
    expect(mux.gateway.isConnected()).to.equal(true);
    expect(mux.isConnected()).to.equal(true);

    let got: unknown;
    const off = mux.gateway.subscribeToChannel({ agent_id: "dev7", name: "c1" }, { onMessage: (m) => { got = m; } });
    // both cloud (all) and local:7 (owns dev7) subscribed
    expect(c.subs).to.deep.equal(["dev7/c1"]);
    expect(l.subs).to.deep.equal(["dev7/c1"]);
    l.deliver("dev7/c1", { id: "m1" });
    expect(got).to.deep.equal({ id: "m1" });
    off();
    expect(c.subs).to.deep.equal([]);
    expect(l.subs).to.deep.equal([]);
  });

  it("on/off forwards gateway events from all members and off deregisters", async () => {
    const c = gwMember("cloud", { mode: "all" });
    const l = gwMember("local:7", { mode: "list", agentIds: ["dev7"] });
    const factory = (d: SourceDescriptor) => d.id === "cloud" ? c.member : l.member;
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }, { id: "local:7", kind: "local" }], enableAll: true });

    let callCount = 0;
    // open fires with no arguments; use a () => void signature to match the typed overload.
    const handler = () => { callCount++; };

    mux.gateway.on("open", handler);

    // Emit from member A — handler should fire once.
    c.emit("open");
    expect(callCount).to.equal(1);

    // Emit from member B — handler should fire again.
    l.emit("open");
    expect(callCount).to.equal(2);

    // After off(), neither member triggers the handler.
    mux.gateway.off("open", handler);
    c.emit("open");
    l.emit("open");
    expect(callCount).to.equal(2);
  });
});
