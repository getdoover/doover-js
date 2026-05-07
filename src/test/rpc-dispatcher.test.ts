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
