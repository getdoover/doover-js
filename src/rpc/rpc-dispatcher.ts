import type { MessagesApi } from "../apis/messages-api";
import type { DooverStatsCollector } from "../client/stats";
import type { ChannelHandlers, GatewayClient } from "../gateway/gateway-client";
import type {
  ChannelRef,
  JSONValue,
  MessageStructure,
  RpcMessageData,
  RpcRequest,
  RpcStatus,
} from "../types/common";
import { DooverRpcError } from "./errors";

export interface SendRpcOptions<TPending = undefined> {
  onStatus?: (status: RpcStatus<TPending>) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface ChannelIdentifierLike {
  agentId: string;
  channelName: string;
}

interface PendingRpc<TPending = unknown> {
  resolve: (response: unknown) => void;
  reject: (err: unknown) => void;
  onStatus?: (status: RpcStatus<TPending>) => void;
  request: RpcRequest;
  channelKey: string;
  channel: ChannelRef;
  startedAt: number | null;
  timer?: ReturnType<typeof setTimeout>;
  abortListener?: () => void;
  signal?: AbortSignal;
}

interface ChannelRefEntry {
  unsubscribe: () => void;
  refCount: number;
}

function isRpcMessageData(data: unknown): data is RpcMessageData<unknown, unknown, unknown> {
  return (
    typeof data === "object" &&
    data !== null &&
    "status" in data &&
    "method" in data &&
    "request" in data
  );
}

export class RpcDispatcher {
  private pending = new Map<string, PendingRpc>();
  private channelRefs = new Map<string, ChannelRefEntry>();
  private stats: DooverStatsCollector | null = null;

  constructor(
    private readonly gateway: GatewayClient,
    private readonly messages: MessagesApi,
  ) {}

  setStats(collector: DooverStatsCollector | null): void {
    this.stats = collector;
  }

  send<TReq = object, TRes = object, TPending = undefined>(
    channel: ChannelIdentifierLike,
    request: RpcRequest<TReq>,
    options?: SendRpcOptions<TPending>,
  ): Promise<TRes> {
    return new Promise<TRes>((resolve, reject) => {
      const channelRef: ChannelRef = {
        agent_id: channel.agentId,
        name: channel.channelName,
      };
      const channelKey = `${channelRef.agent_id}/${channelRef.name}`;

      this.acquireChannel(channelKey, channelRef);

      const startedAt = this.stats?.recordRpcStart() ?? null;

      this.messages
        .postMessage(channel.agentId, channel.channelName, {
          data: {
            type: "rpc",
            ...request,
          },
        } as never)
        .then((message) => {
          const pending: PendingRpc<TPending> = {
            resolve: resolve as (r: unknown) => void,
            reject,
            onStatus: options?.onStatus,
            request: request as RpcRequest,
            channelKey,
            channel: channelRef,
            startedAt,
          };

          if (options?.signal) {
            const onAbort = () => this.settle(message.id, "abort", undefined, options.signal?.reason);
            if (options.signal.aborted) {
              this.releaseChannel(channelKey);
              this.stats?.recordRpcEnd(startedAt, "abort");
              reject(options.signal.reason ?? new Error("Aborted"));
              return;
            }
            options.signal.addEventListener("abort", onAbort);
            pending.signal = options.signal;
            pending.abortListener = onAbort;
          }

          if (options?.timeoutMs !== undefined) {
            pending.timer = setTimeout(() => {
              this.settle(message.id, "timeout", undefined, new Error("RPC timed out"));
            }, options.timeoutMs);
          }

          this.pending.set(message.id, pending as PendingRpc);
        })
        .catch((err) => {
          // postMessage failed before we registered pending — release and reject.
          this.releaseChannel(channelKey);
          this.stats?.recordRpcEnd(startedAt, "error");
          reject(err);
        });
    });
  }

  private acquireChannel(channelKey: string, channelRef: ChannelRef): void {
    const existing = this.channelRefs.get(channelKey);
    if (existing) {
      existing.refCount += 1;
      return;
    }
    const handlers: ChannelHandlers = {
      onMessageUpdate: (msg, requestData) => this.route(msg, requestData),
    };
    const unsubscribe = this.gateway.subscribeToChannel(channelRef, handlers);
    this.channelRefs.set(channelKey, { unsubscribe, refCount: 1 });
  }

  private releaseChannel(channelKey: string): void {
    const entry = this.channelRefs.get(channelKey);
    if (!entry) return;
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      entry.unsubscribe();
      this.channelRefs.delete(channelKey);
    }
  }

  private route(msg: MessageStructure, _requestData?: JSONValue): void {
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    if (!isRpcMessageData(msg.data)) return;
    const status = msg.data.status as RpcStatus<unknown>;
    pending.onStatus?.(status as never);
    if (status.code === "success") {
      this.settle(msg.id, "success", msg.data.response);
    } else if (status.code === "error") {
      this.settle(msg.id, "error", undefined, new DooverRpcError(status, pending.request));
    }
  }

  private settle(
    messageId: string,
    outcome: "success" | "error" | "timeout" | "abort",
    response?: unknown,
    rejection?: unknown,
  ): void {
    const pending = this.pending.get(messageId);
    if (!pending) return;
    this.pending.delete(messageId);
    if (pending.timer) clearTimeout(pending.timer);
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
    this.releaseChannel(pending.channelKey);
    this.stats?.recordRpcEnd(pending.startedAt, outcome);
    if (outcome === "success") pending.resolve(response);
    else pending.reject(rejection);
  }
}
