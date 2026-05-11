// src/test/multiplex-reads.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { MultiplexClient } from "../client/multiplex-client";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

// Helper that builds a member whose subclients return canned values + record __source.
function dataMember(id: string, opts: {
  scope?: { mode: "all" } | { mode: "list"; agentIds: string[] };
  caps?: string[];
  channels?: Record<string, { name: string; is_private: boolean; owner_id: string }[]>;
  channel?: Record<string, { name: string; v: number }>;
  aggregate?: Record<string, { data: unknown; attachments: unknown[] }>;
  messages?: Record<string, { id: string }[]>;
  agents?: { id: string }[];
}): DataClient {
  const scope = opts.scope ?? { mode: "all" as const };
  const caps = new Set(opts.caps ?? ["agents.list", "channels.list", "channels.get", "aggregates.get", "messages.list"]);
  const src = (method: string) => ({ client: { id, kind: id.startsWith("local") ? "local" : "cloud" }, retrievedAt: Date.now(), via: { transport: "rest" as const, method, request: {}, startedAt: 0, durationMs: 1 } });
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  return {
    agents: { listAgents: async () => ({ agents: (opts.agents ?? []).map((a) => ({ ...a, __source: src("agents.listAgents") })) }) } as never,
    channels: {
      listChannels: async (agentId: string) => (opts.channels?.[agentId] ?? []).map((c) => ({ ...c, __source: src("channels.listChannels") })),
      getChannel: async (agentId: string, name: string) => { const c = opts.channel?.[`${agentId}/${name}`]; if (!c) { const e = new Error("404") as Error & { status: number }; e.status = 404; throw e; } return { ...c, __source: src("channels.getChannel") }; },
    } as never,
    aggregates: {
      getAggregate: async (agentId: string, name: string) => { const a = opts.aggregate?.[`${agentId}/${name}`]; if (!a) { const e = new Error("404") as Error & { status: number }; e.status = 404; throw e; } return { ...a, __source: src("aggregates.getAggregate") }; },
    } as never,
    messages: {
      listMessages: async (agentId: string, name: string) => (opts.messages?.[`${agentId}/${name}`] ?? []).map((m) => ({ ...m, data: {}, attachments: [], author_id: "a", channel: { agent_id: agentId, name }, __source: src("messages.listMessages") })),
    } as never,
    alarms: noop, connections: noop, notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {}, subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => caps as never, supports: (c: string) => caps.has(c),
    isConnected: () => false, getStatus: () => ({ clientId: id, connected: false, state: "disconnected", agentScope: scope, at: Date.now() }),
    onStatusChange: () => () => {},
    getAgentScope: async () => scope, getKnownAgentScope: () => scope,
  } as never;
}

describe("MultiplexClient reads", () => {
  function mk(members: Record<string, DataClient>) {
    const factory = (d: SourceDescriptor) => members[d.id];
    return new MultiplexClient({ factory, register: Object.keys(members).map((id) => ({ id, kind: id.startsWith("local") ? "local" : "cloud" })), enableAll: true });
  }

  it("listChannels merges + dedupes by name across owning members; items keep their member __source", async () => {
    const mux = mk({
      cloud: dataMember("cloud", { scope: { mode: "all" }, channels: { dev7: [{ name: "a", is_private: false, owner_id: "o" }, { name: "shared", is_private: false, owner_id: "o" }] } }),
      "local:1": dataMember("local:1", { scope: { mode: "list", agentIds: ["dev7"] }, channels: { dev7: [{ name: "b", is_private: false, owner_id: "o" }, { name: "shared", is_private: false, owner_id: "o" }] } }),
    });
    const list = await mux.channels.listChannels("dev7");
    expect(list.map((c) => c.name).sort()).to.deep.equal(["a", "b", "shared"]);
    const shared = list.find((c) => c.name === "shared")!;
    expect(shared.__source?.client.id).to.equal("cloud"); // first member wins
    // sources-scoped → only local:1
    const onlyLocal = await (mux.channels.listChannels as (...a: unknown[]) => Promise<{ name: string }[]>)("dev7", { sources: ["local:1"] });
    expect(onlyLocal.map((c) => c.name).sort()).to.deep.equal(["b", "shared"]);
  });

  it("getChannel: only the local member owns dev9 → returns its value", async () => {
    const mux = mk({
      cloud: dataMember("cloud", { scope: { mode: "all" }, channel: { "dev7/c": { name: "c", v: 1 } } }),
      "local:9": dataMember("local:9", { scope: { mode: "list", agentIds: ["dev9"] }, channel: { "dev9/c": { name: "c", v: 99 } } }),
    });
    // cloud is 'all' so it's also asked for dev9, but its getChannel 404s → ignored.
    const ch = await mux.channels.getChannel("dev9", "c");
    expect((ch as unknown as { v: number }).v).to.equal(99);
    expect(ch.__source?.client.id).to.equal("local:9");
  });

  it("listMessages merges by id, dedupes, re-applies limit", async () => {
    const mux = mk({
      cloud: dataMember("cloud", { scope: { mode: "all" }, messages: { "dev7/c": [{ id: "5" }, { id: "3" }, { id: "1" }] } }),
      "local:1": dataMember("local:1", { scope: { mode: "list", agentIds: ["dev7"] }, caps: ["messages.list", "channels.get"], messages: { "dev7/c": [{ id: "4" }, { id: "3" }, { id: "2" }] } }),
    });
    const msgs = await mux.messages.listMessages("dev7", "c", { limit: 4, order: "desc" });
    expect(msgs.map((m) => m.id)).to.deep.equal(["5", "4", "3", "2"]);
    const m3 = msgs.find((m) => m.id === "3")!;
    expect(m3.__source?.client.id).to.equal("cloud");
  });

  it("listAgents concatenates members' agents and dedupes by id", async () => {
    const mux = mk({
      cloud: dataMember("cloud", { agents: [{ id: "dev7" }, { id: "dev8" }] }),
      "local:7": dataMember("local:7", { agents: [{ id: "dev7" }] }),
    });
    const res = await mux.agents.listAgents();
    expect((res.agents ?? []).map((a) => a.id).sort()).to.deep.equal(["dev7", "dev8"]);
  });
});
