import type {
  AgentScope,
  DataClientConnectionState,
  DataClientStatus,
  GatewayClientLike,
} from "./data-client";

/**
 * Tracks a `DataClient`'s realtime status by subscribing to its gateway's
 * `open` / `ready` / `close` / `wssError` events. Emits a fresh
 * `DataClientStatus` to listeners whenever the derived snapshot changes.
 */
export class ClientStatusTracker {
  private lastEvent: string | undefined = "init";
  private lastError: string | undefined;
  private session: { id: string } | null = null;
  private listeners = new Set<(status: DataClientStatus) => void>();
  private detach: Array<() => void> = [];

  constructor(
    private readonly clientId: string,
    private readonly gateway: GatewayClientLike,
    private readonly knownScope: () => AgentScope | "unknown" | string,
  ) {
    const onOpen = () => this.transition("open");
    const onReady = (s?: { session_id?: string }) => {
      if (s?.session_id) this.session = { id: s.session_id };
      this.transition("ready");
    };
    const onClose = () => this.transition("close");
    const onErr = (e?: { message?: string }) => {
      this.lastError = e?.message ?? "gateway error";
      this.transition("error");
    };
    gateway.on("open", onOpen as never);
    gateway.on("ready", onReady as never);
    gateway.on("close", onClose as never);
    gateway.on("wssError", onErr as never);
    this.detach.push(
      () => gateway.off("open", onOpen as never),
      () => gateway.off("ready", onReady as never),
      () => gateway.off("close", onClose as never),
      () => gateway.off("wssError", onErr as never),
    );
  }

  /** Call when the agent scope resolves (so listeners re-render). */
  notifyScopeChanged(): void {
    this.emit();
  }

  getStatus(): DataClientStatus {
    const connected = this.gateway.isConnected();
    let state: DataClientConnectionState;
    if (this.lastEvent === "error") state = "error";
    else if (connected) state = "connected";
    else if (this.lastEvent === "init") state = "disconnected";
    else state = "connecting"; // saw open/close but not currently connected → reconnecting
    return {
      clientId: this.clientId,
      connected,
      state,
      session: this.session,
      lastEvent: this.lastEvent,
      latencyMs: null,
      ...(this.lastError ? { lastError: this.lastError } : {}),
      agentScope: this.knownScope() as AgentScope | "unknown",
      at: Date.now(),
    };
  }

  onChange(listener: (status: DataClientStatus) => void): () => void {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.detach.forEach((fn) => fn());
    this.detach = [];
    this.listeners.clear();
  }

  private transition(event: string): void {
    this.lastEvent = event;
    if (event !== "error") {
      // a successful lifecycle event clears a stale error so state can recover
      this.lastError = undefined;
    }
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getStatus();
    this.listeners.forEach((l) => l(snapshot));
  }
}
