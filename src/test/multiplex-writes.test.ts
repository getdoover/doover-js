// src/test/multiplex-writes.test.ts
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import * as chai from "chai";
import { describe, it } from "mocha";

import { MultiplexClient } from "../client/multiplex-client";
import { AmbiguousWriteError, UnsupportedCapabilityError } from "../client/errors";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

chai.use(chaiAsPromised);
const { expect: xp } = chai;

function writeMember(id: string, scope: { mode: "all" } | { mode: "list"; agentIds: string[] }, caps: string[], sink: string[]): DataClient {
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  const post = async (agentId: string) => { sink.push(`${id}:${agentId}`); return { id: "m", data: {}, attachments: [], author_id: "a", channel: { agent_id: agentId, name: "c" } }; };
  return {
    agents: noop, channels: noop,
    messages: { postMessage: (a: string) => post(a) } as never,
    aggregates: { putAggregate: async (a: string) => { sink.push(`${id}:put:${a}`); return { data: {}, attachments: [] }; } } as never,
    alarms: noop, connections: noop, notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {}, subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => new Set(caps as never), supports: (c: string) => caps.includes(c),
    isConnected: () => false, getStatus: () => ({ clientId: id, connected: false, state: "disconnected", agentScope: scope, at: Date.now() }),
    onStatusChange: () => () => {},
    getAgentScope: async () => scope, getKnownAgentScope: () => scope,
  } as never;
}

describe("MultiplexClient writes", () => {
  function mk(members: Record<string, DataClient>) {
    const factory = (d: SourceDescriptor) => members[d.id];
    return new MultiplexClient({ factory, register: Object.keys(members).map((id) => ({ id, kind: id.startsWith("local") ? "local" : "cloud" })), enableAll: true });
  }

  it("routes to the single member that owns the agent and has the write cap", async () => {
    const sink: string[] = [];
    const mux = mk({
      cloud: writeMember("cloud", { mode: "all" }, ["messages.post"], sink),
      "local:7": writeMember("local:7", { mode: "list", agentIds: ["dev7"] }, ["messages.post"], sink),
    });
    // dev99 only owned by cloud (local:7 owns dev7) → routes to cloud
    await mux.messages.postMessage("dev99", "c", { x: 1 } as never);
    expect(sink).to.deep.equal(["cloud:dev99"]);
  });

  it("ambiguous when 2+ members own the agent and have the cap → AmbiguousWriteError", async () => {
    const sink: string[] = [];
    const mux = mk({
      cloud: writeMember("cloud", { mode: "all" }, ["messages.post"], sink),
      "local:7": writeMember("local:7", { mode: "list", agentIds: ["dev7"] }, ["messages.post"], sink),
    });
    await xp(mux.messages.postMessage("dev7", "c", { x: 1 } as never)).to.be.rejectedWith(AmbiguousWriteError);
    // …unless scoped to one:
    await (mux.messages.postMessage as (...a: unknown[]) => Promise<unknown>)("dev7", "c", { x: 1 }, { sources: ["local:7"] });
    expect(sink).to.deep.equal(["local:7:dev7"]);
  });

  it("no member with the cap → UnsupportedCapabilityError", async () => {
    const mux = mk({ cloud: writeMember("cloud", { mode: "all" }, ["messages.list"], []) });
    await xp(mux.messages.postMessage("dev7", "c", {} as never)).to.be.rejectedWith(UnsupportedCapabilityError);
  });
});
