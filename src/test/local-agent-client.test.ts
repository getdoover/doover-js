import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import * as chai from "chai";
import { describe, it } from "mocha";

import { LocalAgentClient } from "../client/local-agent-client";
import { UnsupportedCapabilityError } from "../client/errors";
import { MockWebSocket, createFetchMock, createJsonResponse } from "./helpers";

// Valid snowflake IDs for use in mock payloads (id must be a numeric string for BigInt conversion).
const SNOWFLAKE_1 = "179418309739937792";
const SNOWFLAKE_2 = "179418309744132096";

chai.use(chaiAsPromised);
const { expect: xpect } = chai;

function makeLocal(extra: Record<string, unknown> = {}) {
  return new LocalAgentClient({
    baseUrl: "http://192.168.0.7:49100",
    fetchImpl: createFetchMock() as typeof fetch,
    webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    disableBrowserLifecycleHooks: true,
    sourceId: "local:192.168.0.7:49100",
    ...extra,
  });
}

describe("LocalAgentClient", () => {
  it("advertises the v1 capability set and not the others", () => {
    const caps = makeLocal().getCapabilities();
    for (const c of ["agents.list", "channels.list", "channels.get", "aggregates.get",
      "aggregates.put", "aggregates.patch", "messages.list", "messages.post", "messages.put",
      "gateway.subscribe", "gateway.realtime", "gateway.oneShot"] as const) {
      expect(caps.has(c)).to.equal(true);
    }
    for (const c of ["messages.listHistorical", "messages.get", "channels.create",
      "channels.archive", "rpc.send", "users.me", "alarms.read"] as const) {
      expect(caps.has(c)).to.equal(false);
    }
  });

  it("throw-stubs every unadvertised method with UnsupportedCapabilityError", async () => {
    const c = makeLocal();
    await xpect(c.messages.getMessage("a", "ch", "m")).to.be.rejectedWith(UnsupportedCapabilityError);
    await xpect(c.channels.createChannel("a", "ch", {} as never)).to.be.rejectedWith(UnsupportedCapabilityError);
    await xpect(c.users.getMe()).to.be.rejectedWith(UnsupportedCapabilityError);
    await xpect(c.rpc.send({ agentId: "a", channelName: "ch" }, { method: "x", request: {} })).to.be.rejectedWith(UnsupportedCapabilityError);
    try { await c.alarms.listAlarms("a", "ch"); expect.fail("should throw"); }
    catch (e) { expect(e).to.be.instanceOf(UnsupportedCapabilityError); expect((e as UnsupportedCapabilityError).capability).to.equal("alarms.read"); expect((e as UnsupportedCapabilityError).clientId).to.equal("local:192.168.0.7:49100"); }
  });

  it("listChannels / getChannel / getAggregate / listMessages hit the local REST base and carry __source kind 'local'", async () => {
    const fetchMock = createFetchMock((url) => {
      if (url.endsWith("/channels")) return createJsonResponse([{ name: "c1", is_private: false, owner_id: "o" }]);
      if (url.includes("/channels/c1/aggregate")) return createJsonResponse({ data: { v: 1 }, attachments: [] });
      if (url.includes("/channels/c1/messages")) return createJsonResponse([{ id: SNOWFLAKE_1, data: {}, attachments: [], author_id: "a", channel: { agent_id: "dev7", name: "c1" } }]);
      if (url.includes("/channels/c1")) return createJsonResponse({ name: "c1", is_private: false, owner_id: "o" });
      return createJsonResponse({});
    });
    const c = makeLocal({ fetchImpl: fetchMock as typeof fetch });
    const list = await c.channels.listChannels("dev7");
    expect(list[0].__source?.client.kind).to.equal("local");
    expect(list[0].__source?.via).to.include({ transport: "rest", method: "channels.listChannels" });
    const agg = await c.aggregates.getAggregate("dev7", "c1");
    expect(agg.__source?.client.id).to.equal("local:192.168.0.7:49100");
    const msgs = await c.messages.listMessages("dev7", "c1");
    expect(msgs[0].__source?.via).to.include({ transport: "rest" });
  });

  it("postMessage / putMessage / putAggregate / patchAggregate go through to the local REST base", async () => {
    const seen: Array<{ method?: string; url: string }> = [];
    const fetchMock = createFetchMock((url, init) => {
      seen.push({ method: init?.method, url });
      if (url.includes("/messages")) return createJsonResponse({ id: SNOWFLAKE_2, data: {}, attachments: [], author_id: "a", channel: { agent_id: "dev7", name: "c1" } });
      return createJsonResponse({ data: {}, attachments: [] });
    });
    const c = makeLocal({ fetchImpl: fetchMock as typeof fetch });
    const m = await c.messages.postMessage("dev7", "c1", { hello: 1 } as never);
    expect(m.__source?.client.kind).to.equal("local");
    await c.aggregates.putAggregate("dev7", "c1", { v: 2 });
    await c.aggregates.patchAggregate("dev7", "c1", { v: 3 });
    await c.messages.putMessage("dev7", "c1", SNOWFLAKE_2, { v: 4 } as never);
    expect(seen.some((s) => s.method === "POST" && s.url.includes("/messages"))).to.equal(true);
    expect(seen.some((s) => s.method === "PUT" && s.url.includes("/aggregate"))).to.equal(true);
    expect(seen.some((s) => s.method === "PATCH" && s.url.includes("/aggregate"))).to.equal(true);
  });

  it("status reflects the local gateway: disconnected before connect, connected after Ready", async () => {
    const c = makeLocal();
    expect(c.isConnected()).to.equal(false);
    expect(c.getStatus().state).to.equal("disconnected");
    await c.gateway.connect();
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws.open();
    ws.receive({ op: 0, t: "Hello", d: {} });
    ws.receive({ op: 0, t: "Ready", d: { session_id: "s1", session_token: "t", subscriptions: [] } });
    expect(c.isConnected()).to.equal(true);
    expect(c.getStatus().state).to.equal("connected");
    expect(c.getStatus().clientId).to.equal("local:192.168.0.7:49100");
  });

  it("realtime: subscribeToChannel handlers receive stamped MessageCreate", async () => {
    const c = makeLocal();
    await c.gateway.connect();
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws.open();
    ws.receive({ op: 0, t: "Ready", d: { session_id: "s1", session_token: "t", subscriptions: [] } });
    let got: unknown;
    c.gateway.subscribeToChannel({ agent_id: "dev7", name: "c1" }, { onMessage: (m) => { got = m; } });
    ws.receive({ op: 0, t: "MessageCreate", d: { id: SNOWFLAKE_1, data: {}, attachments: [], author_id: "a", channel: { agent_id: "dev7", name: "c1" } } });
    expect((got as { __source?: { client: { kind: string } } }).__source?.client.kind).to.equal("local");
  });

  it("getAgentScope resolves to { mode: 'list', agentIds: [deviceId] } via listAgents, caches it, and getKnownAgentScope is 'unknown' first", async () => {
    let agentCalls = 0;
    const fetchMock = createFetchMock((url) => {
      if (url.includes("/agents")) { agentCalls += 1; return createJsonResponse({ agents: [{ id: "dev7", name: "Device 7" }] }); }
      return createJsonResponse({});
    });
    const c = makeLocal({ fetchImpl: fetchMock as typeof fetch });
    expect(c.getKnownAgentScope()).to.equal("unknown");
    const scope = await c.getAgentScope();
    expect(scope).to.deep.equal({ mode: "list", agentIds: ["dev7"] });
    expect(c.getKnownAgentScope()).to.deep.equal({ mode: "list", agentIds: ["dev7"] });
    await c.getAgentScope(); // cached
    expect(agentCalls).to.equal(1);
  });

  it("reconnect (Ready frame) invalidates the scope cache and re-fetches the agent id", async () => {
    let agentCalls = 0;
    const fetchMock = createFetchMock((url) => {
      if (url.includes("/agents")) { agentCalls += 1; return createJsonResponse({ agents: [{ id: "dev7", name: "Device 7" }] }); }
      return createJsonResponse({});
    });
    const c = makeLocal({ fetchImpl: fetchMock as typeof fetch });

    // 1. Initial resolve — agentCalls becomes 1, scope is cached.
    const scope1 = await c.getAgentScope();
    expect(scope1).to.deep.equal({ mode: "list", agentIds: ["dev7"] });
    expect(agentCalls).to.equal(1);

    // 2. Connect the gateway, open the socket, and send a Ready frame — this
    //    should null the cache and kick off a background re-fetch.
    await c.gateway.connect();
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws.open();
    ws.receive({ op: 0, t: "Hello", d: {} });
    ws.receive({ op: 0, t: "Ready", d: { session_id: "s2", session_token: "t2", subscriptions: [] } });

    // 3. The "ready" handler fires synchronously, nulling resolvedScope and
    //    firing off an async re-fetch.  Flush the microtask queue so the async
    //    listAgents() call has time to complete before we assert.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // 4. Re-fetch should have run: agentCalls === 2 and scope is still [dev7].
    expect(agentCalls).to.equal(2);
    const scope2 = await c.getAgentScope(); // now served from refreshed cache
    expect(scope2).to.deep.equal({ mode: "list", agentIds: ["dev7"] });
    expect(agentCalls).to.equal(2); // no third fetch — cache hit
  });
});
