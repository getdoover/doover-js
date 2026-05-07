import { expect } from "chai";
import { EventEmitter } from "node:events";
import type { GatewayClient, ChannelHandlers } from "../gateway/gateway-client";
import type { MessagesApi } from "../apis/messages-api";
import type {
  ChannelRef,
  JSONValue,
  MessageStructure,
  RpcMessageData,
  RpcStatus,
} from "../types/common";
import { RpcDispatcher } from "../rpc/rpc-dispatcher";
import { DooverRpcError } from "../rpc/errors";
import { DooverStatsCollector } from "../client/stats";

interface FakeGateway {
  emitMessageUpdate(msg: MessageStructure, requestData?: JSONValue): void;
  subscribeCalls: number;
  unsubscribeCalls: number;
  subscribeToChannel: GatewayClient["subscribeToChannel"];
}

function makeFakeGateway(): FakeGateway & Pick<GatewayClient, "subscribeToChannel"> {
  const ee = new EventEmitter();
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  const channels = new Map<string, Set<ChannelHandlers>>();
  const key = (c: ChannelRef) => `${c.agent_id}/${c.name}`;
  const subscribeToChannel = (channel: ChannelRef, handlers: ChannelHandlers) => {
    const k = key(channel);
    let set = channels.get(k);
    if (!set) {
      set = new Set();
      channels.set(k, set);
      subscribeCalls += 1;
    }
    set.add(handlers);
    ee.on("messageUpdate", (msg: MessageStructure, requestData?: JSONValue) => {
      if (msg.channel.agent_id !== channel.agent_id || msg.channel.name !== channel.name) return;
      handlers.onMessageUpdate?.(msg, requestData);
    });
    let off = false;
    return () => {
      if (off) return;
      off = true;
      set!.delete(handlers);
      if (set!.size === 0) {
        channels.delete(k);
        unsubscribeCalls += 1;
      }
    };
  };
  return {
    subscribeToChannel: subscribeToChannel as GatewayClient["subscribeToChannel"],
    emitMessageUpdate: (msg, rd) => ee.emit("messageUpdate", msg, rd),
    get subscribeCalls() { return subscribeCalls; },
    get unsubscribeCalls() { return unsubscribeCalls; },
  };
}

interface FakeMessagesApi {
  postMessage: MessagesApi["postMessage"];
  posts: Array<{ agentId: string; channelName: string; body: unknown }>;
  setNextId(id: string): void;
}

function makeFakeMessagesApi(): FakeMessagesApi {
  let nextId = "msg-1";
  const posts: FakeMessagesApi["posts"] = [];
  const postMessage = (async (
    a: string | { agentId: string; channelName: string },
    b: string | unknown,
    c?: unknown,
  ) => {
    const isPositional = typeof a === "string";
    const agentId = isPositional ? a : a.agentId;
    const channelName = isPositional ? (b as string) : a.channelName;
    const body = isPositional ? c : b;
    posts.push({ agentId, channelName, body });
    const message: MessageStructure = {
      id: nextId,
      data: body as JSONValue,
      attachments: [],
      author_id: "auth",
      channel: { agent_id: agentId, name: channelName },
      timestamp: 1,
    };
    return message;
  }) as MessagesApi["postMessage"];
  return {
    postMessage,
    posts,
    setNextId: (id) => { nextId = id; },
  };
}

function rpcMessage<TReq = object, TRes = object, TPending = undefined>(
  id: string,
  channel: ChannelRef,
  status: RpcStatus<TPending>,
  request: TReq,
  response?: TRes,
): MessageStructure<RpcMessageData<TReq, TRes, TPending>> {
  return {
    id,
    data: { method: "do", request, status, response: response as TRes },
    attachments: [],
    author_id: "auth",
    channel,
    timestamp: 1,
  };
}

describe("RpcDispatcher", () => {
  it("send resolves on terminal success status", async () => {
    const gw = makeFakeGateway();
    const messages = makeFakeMessagesApi();
    messages.setNextId("rpc-1");
    const dispatcher = new RpcDispatcher(
      gw as unknown as GatewayClient,
      messages as unknown as MessagesApi,
    );

    const channel: ChannelRef = { agent_id: "a1", name: "c1" };
    const promise = dispatcher.send(
      { agentId: "a1", channelName: "c1" },
      { method: "do", request: { x: 1 } },
    );

    // wait one microtask so postMessage settles and pending is registered
    await new Promise<void>((r) => setImmediate(r));
    gw.emitMessageUpdate(
      rpcMessage("rpc-1", channel, { code: "success" }, { x: 1 }, { ok: true }) as unknown as MessageStructure,
    );
    const result = await promise;
    expect(result).to.deep.equal({ ok: true });
    expect(gw.subscribeCalls).to.equal(1);
    expect(gw.unsubscribeCalls).to.equal(1);
  });
});

describe("RpcDispatcher additional outcomes", () => {
  it("rejects with DooverRpcError on terminal error status", async () => {
    const gw = makeFakeGateway();
    const messages = makeFakeMessagesApi();
    messages.setNextId("rpc-2");
    const dispatcher = new RpcDispatcher(
      gw as unknown as GatewayClient,
      messages as unknown as MessagesApi,
    );
    const channel: ChannelRef = { agent_id: "a1", name: "c1" };
    const promise = dispatcher.send(
      { agentId: "a1", channelName: "c1" },
      { method: "do", request: {} },
    );
    await new Promise<void>((r) => setImmediate(r));
    gw.emitMessageUpdate(
      rpcMessage("rpc-2", channel, { code: "error", message: "nope" }, {}),
    );
    let caught: unknown;
    try {
      await promise;
    } catch (e) {
      caught = e;
    }
    expect(caught).to.be.instanceOf(DooverRpcError);
    expect((caught as Error).message).to.equal("nope");
  });

  it("rejects on timeoutMs with no terminal status", async () => {
    const gw = makeFakeGateway();
    const messages = makeFakeMessagesApi();
    const dispatcher = new RpcDispatcher(
      gw as unknown as GatewayClient,
      messages as unknown as MessagesApi,
    );
    const promise = dispatcher.send(
      { agentId: "a1", channelName: "c1" },
      { method: "do", request: {} },
      { timeoutMs: 5 },
    );
    let caught: Error | undefined;
    try {
      await promise;
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).to.equal("RPC timed out");
  });

  it("rejects on AbortSignal.abort()", async () => {
    const gw = makeFakeGateway();
    const messages = makeFakeMessagesApi();
    const dispatcher = new RpcDispatcher(
      gw as unknown as GatewayClient,
      messages as unknown as MessagesApi,
    );
    const ac = new AbortController();
    const promise = dispatcher.send(
      { agentId: "a1", channelName: "c1" },
      { method: "do", request: {} },
      { signal: ac.signal },
    );
    await new Promise<void>((r) => setImmediate(r));
    ac.abort(new Error("user cancelled"));
    let caught: Error | undefined;
    try {
      await promise;
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).to.equal("user cancelled");
  });

  it("two concurrent RPCs on the same channel share one gateway subscription", async () => {
    const gw = makeFakeGateway();
    const messages = makeFakeMessagesApi();
    const dispatcher = new RpcDispatcher(
      gw as unknown as GatewayClient,
      messages as unknown as MessagesApi,
    );
    messages.setNextId("rpc-A");
    const pA = dispatcher.send(
      { agentId: "a1", channelName: "c1" },
      { method: "do", request: { n: 1 } },
    );
    await new Promise<void>((r) => setImmediate(r));
    messages.setNextId("rpc-B");
    const pB = dispatcher.send(
      { agentId: "a1", channelName: "c1" },
      { method: "do", request: { n: 2 } },
    );
    await new Promise<void>((r) => setImmediate(r));
    expect(gw.subscribeCalls).to.equal(1);
    const channel: ChannelRef = { agent_id: "a1", name: "c1" };
    gw.emitMessageUpdate(rpcMessage("rpc-A", channel, { code: "success" }, { n: 1 }, { a: true }));
    gw.emitMessageUpdate(rpcMessage("rpc-B", channel, { code: "success" }, { n: 2 }, { b: true }));
    expect(await pA).to.deep.equal({ a: true });
    expect(await pB).to.deep.equal({ b: true });
    expect(gw.unsubscribeCalls).to.equal(1);
  });
});

describe("RpcDispatcher stats integration", () => {
  it("records start and end via collector when enabled", async () => {
    const gw = makeFakeGateway();
    const messages = makeFakeMessagesApi();
    const dispatcher = new RpcDispatcher(
      gw as unknown as GatewayClient,
      messages as unknown as MessagesApi,
    );
    const stats = new DooverStatsCollector();
    stats.setEnabled(true);
    dispatcher.setStats(stats);
    messages.setNextId("rpc-stats");
    const channel: ChannelRef = { agent_id: "a1", name: "c1" };
    const p = dispatcher.send(
      { agentId: "a1", channelName: "c1" },
      { method: "do", request: {} },
    );
    await new Promise<void>((r) => setImmediate(r));
    expect(stats.snapshot().rpc.pendingRpcs).to.equal(1);
    gw.emitMessageUpdate(rpcMessage("rpc-stats", channel, { code: "success" }, {}, { ok: true }));
    await p;
    const snap = stats.snapshot();
    expect(snap.rpc.totalRpcs).to.equal(1);
    expect(snap.rpc.completedRpcs).to.equal(1);
    expect(snap.rpc.pendingRpcs).to.equal(0);
    expect(snap.rpc.peakPendingRpcs).to.equal(1);
  });
});
