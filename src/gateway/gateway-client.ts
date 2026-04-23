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

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_CAP_MS = 30_000;

export class GatewayClient {
  private socket: WebSocket | null = null;
  private session: WebSocketSession | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatAt: number | null = null;
  private lastLatencyMs: number | null = null;
  private missedHeartbeats = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  /** Set when the consumer explicitly disconnects — suppresses reconnect. */
  private explicitlyDisconnected = false;
  /** Guards against concurrent connect() callers creating duplicate sockets. */
  private opening = false;
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
    this.installLifecycleListeners();
  }

  async connect(): Promise<void> {
    this.explicitlyDisconnected = false;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      return;
    }
    // De-dupe concurrent callers. Without this, N simultaneous
    // `subscribeToChannel(...)` calls each await auth, then each create
    // their own socket — the last one wins `this.socket`, but the earlier
    // sockets' `onmessage` handlers still fire and try to send() through
    // `this.socket` (a newer, not-yet-open socket → throws). The flag is
    // cleared synchronously as soon as the new socket is assigned in
    // `openSocket`, so reconnects after close still work.
    if (this.opening) {
      return;
    }
    this.opening = true;
    try {
      await this.openSocket();
    } finally {
      this.opening = false;
    }
  }

  private async openSocket(): Promise<void> {
    if (this.auth) {
      await this.auth.ensureReady();
    }

    const hasFactory = !!this.config.webSocketFactory;
    const wsParams = this.auth
      ? await this.auth.prepareWebSocket(this.config.dataWssUrl, hasFactory)
      : { url: this.config.dataWssUrl };

    let socket: WebSocket;
    if (this.config.webSocketFactory) {
      socket = this.config.webSocketFactory({
        url: wsParams.url,
        headers: wsParams.headers,
      });
    } else {
      const WebSocketImpl = this.config.webSocketImpl ?? WebSocket;
      socket = new WebSocketImpl(wsParams.url);
    }
    this.socket = socket;
    // Release the concurrency gate synchronously now that the new socket is
    // assigned — any subsequent connect() will see it via `this.socket`.
    this.opening = false;

    socket.onopen = () => this.emit("open");
    socket.onclose = (event) => {
      this.stopHeartbeat();
      this.emit("close", event);
      this.scheduleReconnect();
    };
    socket.onerror = () => undefined;
    socket.onmessage = (event) => this.handleMessage(event.data);
  }

  disconnect(code?: number, reason?: string) {
    this.explicitlyDisconnected = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
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

  /**
   * Round-trip time of the most recent heartbeat (ms). Null until the
   * first ack lands.
   */
  getLatency() {
    return this.lastLatencyMs;
  }

  isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Force a fresh connection: close the current socket (without suppressing
   * reconnects) and immediately open a new one. Useful for a manual
   * "reconnect now" control in debug UIs.
   */
  async reconnect(): Promise<void> {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    // Drop the session so the new socket identifies fresh (op 10) rather
    // than attempting to resume a just-closed session (op 11) that the
    // server has already torn down.
    this.session = null;
    if (this.socket) {
      // Suppress the auto-reconnect path so we don't double-schedule.
      const prev = this.socket;
      prev.onclose = null;
      prev.close(1000, "manual reconnect");
      this.socket = null;
    }
    await this.connect();
  }

  private handleMessage(raw: string) {
    const message = JSON.parse(raw) as GatewayInboundMessage;
    if (message.op === 2) {
      this.missedHeartbeats = 0;
      this.lastLatencyMs =
        this.lastHeartbeatAt === null ? null : Date.now() - this.lastHeartbeatAt;
      this.emit("heartbeatAck", this.lastLatencyMs);
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
        this.reconnectAttempts = 0;
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
    if (this.reconnectTimer || this.explicitlyDisconnected) {
      return;
    }
    const delay = this.computeReconnectDelay();
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  /** Exponential backoff with full-jitter, capped at RECONNECT_CAP_MS. */
  private computeReconnectDelay() {
    const exp = Math.min(
      RECONNECT_CAP_MS,
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
    );
    return Math.floor(Math.random() * exp);
  }

  private installLifecycleListeners() {
    if (this.config.disableBrowserLifecycleHooks) return;
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("online", this.handleOnline);
    }
  }

  private handleVisibilityChange = () => {
    if (typeof document === "undefined") return;
    if (document.visibilityState !== "visible") return;
    this.tryImmediateReconnect();
  };

  private handleOnline = () => {
    this.tryImmediateReconnect();
  };

  /**
   * Called by lifecycle hooks when we have a strong signal that the network
   * or tab has come back — skip the backoff schedule and reconnect now.
   */
  private tryImmediateReconnect() {
    if (this.explicitlyDisconnected) return;
    if (this.isConnected()) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    void this.connect();
  }

  private channelKey(channel: ChannelRef) {
    return `${channel.agent_id}/${channel.name}`;
  }
}
