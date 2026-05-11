// src/test/multiplex-noncore.test.ts
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import * as chai from "chai";
import { describe, it } from "mocha";

import { MultiplexClient } from "../client/multiplex-client";
import { UnsupportedCapabilityError } from "../client/errors";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

chai.use(chaiAsPromised);
const { expect: xp } = chai;

function member(id: string, caps: string[], impl: Partial<Record<string, unknown>>): DataClient {
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  const make = (name: string) => (impl[name] ?? noop) as never;
  return {
    agents: noop, channels: noop, messages: noop, aggregates: noop,
    alarms: make("alarms"), connections: make("connections"), notifications: make("notifications"),
    permissions: make("permissions"), processors: make("processors"), turn: make("turn"), users: make("users"), rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {}, subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => new Set(caps as never), supports: (c: string) => caps.includes(c),
    isConnected: () => false, getStatus: () => ({ clientId: id, connected: false, state: "disconnected", agentScope: { mode: "all" as const }, at: Date.now() }),
    onStatusChange: () => () => {},
    getAgentScope: async () => ({ mode: "all" as const }), getKnownAgentScope: () => ({ mode: "all" as const }),
  } as never;
}

describe("MultiplexClient non-core methods", () => {
  function mk(members: Record<string, DataClient>) {
    const factory = (d: SourceDescriptor) => members[d.id];
    return new MultiplexClient({ factory, register: Object.keys(members).map((id) => ({ id, kind: "cloud" })), enableAll: true });
  }
  it("users.getMe returns the first member's result; throws if no member supports it", async () => {
    const mux = mk({ cloud: member("cloud", ["users.me"], { users: { getMe: async () => ({ id: "u1" }) } }) });
    expect((await mux.users.getMe()).id).to.equal("u1");
    const mux2 = mk({ cloud: member("cloud", [], {}) });
    await xp(mux2.users.getMe()).to.be.rejectedWith(UnsupportedCapabilityError);
  });
  it("alarms.listAlarms fans out; alarms.deleteAlarm routes to one", async () => {
    const sink: string[] = [];
    const mux = mk({ cloud: member("cloud", ["alarms.read", "alarms.write"], {
      alarms: { listAlarms: async () => [{ id: "al1", name: "x" }], deleteAlarm: async (a: string) => { sink.push(`del:${a}`); } },
    }) });
    expect((await mux.alarms.listAlarms("dev7", "c"))[0].id).to.equal("al1");
    await mux.alarms.deleteAlarm("dev7", "c", "al1");
    expect(sink).to.deep.equal(["del:dev7"]);
  });
});
