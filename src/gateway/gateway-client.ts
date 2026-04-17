import type { DooverAuth } from "../auth/doover-auth";
import type { DooverClientConfig } from "../http/rest-client";
import { DooverGatewayError } from "../http/errors";
import { addTimestampToMessage } from "../utils/snowflake";
import type {
  GatewayInboundMessage,
  GatewayListenerMap,
  GatewayMessageUpdate,
  WebSocketSession,
} from "./types";
import type { ChannelRef, JSONValue } from "../types/common";

type ListenerSet<K extends keyof GatewayListenerMap> = Set<GatewayListenerMap[K]>;

export class GatewayClient {
  private socket: WebSocket | null = null;
  private session: WebSocketSession | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatAt: number | null = null;
  private missedHeartbeats = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: { [K in keyof GatewayListenerMap]: ListenerSet<K> } = {
    ready: new Set(),
    channelSync: new Set(),
    messageCreate: new Set(),
    messageUpdate: new Set(),
    aggregateUpdate: new Set(),
    alarmTrigger: new Set(),
    oneShotMessage: new Set(),
    channelSubscription: new Set(),
    channelUnsubscription: new Set(),
    wssError: new Set(),
    sessionCancelled: new Set(),
    open: new Set(),
    close: new Set(),
    heartbeatAck: new Set(),
  };
  private subscriptions = new Map<string, { channel: ChannelRef; diff_only: boolean }>();
  private readonly auth: DooverAuth | null;

  constructor(private readonly config: DooverClientConfig, auth?: DooverAuth) {
    this.auth = auth ?? null;
  }

  async connect(): Promise<void> {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      return;
    }

    if (this.auth) {
      await this.auth.ensureReady();
    }

    const hasFactory = !!this.config.webSocketFactory;
    const wsParams = this.auth
      ? await this.auth.prepareWebSocket(this.config.dataWssUrl, hasFactory)
      : { url: this.config.dataWssUrl };

    if (this.config.webSocketFactory) {
      this.socket = this.config.webSocketFactory({
        url: wsParams.url,
        headers: wsParams.headers,
      });
    } else {
      const WebSocketImpl = this.config.webSocketImpl ?? WebSocket;
      this.socket = new WebSocketImpl(wsParams.url);
    }

    this.socket.onopen = () => this.emit("open");
    this.socket.onclose = (event) => {
      this.stopHeartbeat();
      this.emit("close", event);
      this.scheduleReconnect();
    };
    this.socket.onerror = () => undefined;
    this.socket.onmessage = (event) => this.handleMessage(event.data);
  }

  disconnect(code?: number, reason?: string) {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close(code, reason);
    this.socket = null;
  }

  on<K extends keyof GatewayListenerMap>(eventName: K, listener: GatewayListenerMap[K]) {
    this.listeners[eventName].add(listener as never);
  }

  off<K extends keyof GatewayListenerMap>(eventName: K, listener: GatewayListenerMap[K]) {
    this.listeners[eventName].delete(listener as never);
  }

  subscribe(channel: ChannelRef, options?: { diff_only?: boolean }) {
    this.subscriptions.set(this.channelKey(channel), {
      channel,
      diff_only: options?.diff_only ?? false,
    });
    if (!this.isConnected()) {
      void this.connect();
      return;
    }
    this.send({
      op: 12,
      d: {
        channel,
        organisation_id: this.config.organisationId ?? null,
        diff_only: options?.diff_only ?? false,
      },
    });
  }

  unsubscribe(channel: ChannelRef) {
    this.subscriptions.delete(this.channelKey(channel));
    if (!this.isConnected()) {
      return;
    }
    this.send({
      op: 13,
      d: {
        channel,
        organisation_id: this.config.organisationId ?? null,
      },
    });
  }

  syncChannel(channel: ChannelRef) {
    if (!this.isConnected()) {
      void this.connect();
      return;
    }
    this.send({
      op: 14,
      d: {
        channel,
        organisation_id: this.config.organisationId ?? null,
      },
    });
  }

  sendOneShotMessage(channel: ChannelRef, data: JSONValue) {
    if (!this.isConnected()) {
      void this.connect();
      return;
    }
    this.send({
      op: 15,
      d: {
        channel,
        data,
      },
    });
  }

  getSession() {
    return this.session;
  }

  getLatency() {
    return this.lastHeartbeatAt === null ? null : Date.now() - this.lastHeartbeatAt;
  }

  isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private handleMessage(raw: string) {
    const message = JSON.parse(raw) as GatewayInboundMessage;
    if (message.op === 2) {
      this.missedHeartbeats = 0;
      const latency = this.lastHeartbeatAt === null ? null : Date.now() - this.lastHeartbeatAt;
      this.emit("heartbeatAck", latency);
      return;
    }
    if (message.op === 3) {
      this.session = null;
      this.emit("sessionCancelled");
      return;
    }
    if (message.op !== 0 || !message.t) {
      return;
    }

    switch (message.t) {
      case "Hello":
        this.identifyOrResume();
        this.startHeartbeat();
        break;
      case "Ready":
        this.session = message.d;
        this.emit("ready", message.d);
        this.resubscribeAll();
        break;
      case "ChannelSync":
        this.emit("channelSync", message.d);
        break;
      case "MessageCreate":
        this.emit("messageCreate", addTimestampToMessage(message.d));
        break;
      case "MessageUpdate":
        this.emit("messageUpdate", addTimestampToMessage(message.d) as GatewayMessageUpdate["d"] & { timestamp: number });
        break;
      case "AggregateUpdate":
        this.emit("aggregateUpdate", message.d);
        break;
      case "AlarmTrigger":
        this.emit("alarmTrigger", message.d);
        break;
      case "OneShotMessage":
        this.emit("oneShotMessage", message.d);
        break;
      case "ChannelSubscription":
        this.emit("channelSubscription", message.d);
        break;
      case "ChannelUnsubscription":
        this.emit("channelUnsubscription", message.d);
        break;
      case "WSSErrorEvent":
        this.emit("wssError", message.d);
        break;
      default:
        break;
    }
  }

  private identifyOrResume() {
    if (this.session) {
      this.send({
        op: 11,
        d: {
          session_id: this.session.session_id,
          session_token: this.session.session_token,
          default_connection: false,
        },
      });
      return;
    }
    this.send({
      op: 10,
      d: {
        default_connection: false,
        organisation_id: this.config.organisationId ?? null,
        sharing_mode: this.config.sharing ?? "internal",
      },
    });
  }

  private resubscribeAll() {
    for (const entry of this.subscriptions.values()) {
      this.subscribe(entry.channel, { diff_only: entry.diff_only });
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return;
      }
      this.lastHeartbeatAt = Date.now();
      this.missedHeartbeats += 1;
      if (this.missedHeartbeats > 3) {
        this.socket.close(4000, "Missed heartbeats");
        return;
      }
      this.send({ op: 1, d: {} });
    }, 20000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.missedHeartbeats = 0;
  }

  private send(payload: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new DooverGatewayError("WebSocket is not connected");
    }
    this.socket.send(JSON.stringify(payload));
  }

  private emit<K extends keyof GatewayListenerMap>(
    eventName: K,
    ...args: Parameters<GatewayListenerMap[K]>
  ) {
    this.listeners[eventName].forEach((listener) => {
      (listener as (...innerArgs: Parameters<GatewayListenerMap[K]>) => void)(...args);
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, 1000);
  }

  private channelKey(channel: ChannelRef) {
    return `${channel.agent_id}/${channel.name}`;
  }
}
