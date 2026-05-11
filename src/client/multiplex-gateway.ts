import type { GatewayClientLike } from "./data-client";
import type { ChannelRef } from "../types/common";
import type { WebSocketSession } from "../gateway/types";

/** Minimal view of what MultiplexGateway needs from the owning multiplex. */
export interface MultiplexGatewayHost {
  /** Enabled members with `gateway.subscribe`. */
  gatewayMembers(): Array<{ id: string; gateway: GatewayClientLike }>;
  /** Enabled members owning `agentId` that have `gateway.subscribe`. */
  gatewayMembersForAgent(agentId: string): Array<{ id: string; gateway: GatewayClientLike }>;
}

type AnyGateway = GatewayClientLike & {
  on(e: string, h: (...a: unknown[]) => void): void;
  off(e: string, h: (...a: unknown[]) => void): void;
  subscribeToChannel(c: ChannelRef, h: Record<string, (...a: unknown[]) => void>): () => void;
};

/**
 * `GatewayClientLike` facade over the members' gateways:
 *  - connect/disconnect/reconnect → fan out to members with `gateway.subscribe`.
 *  - subscribe/unsubscribe/subscribeToChannel → route to owning members.
 *  - on/off → register against every member; events forwarded.
 *  - isConnected → all members with `gateway.subscribe` are connected.
 *  - getSession → first connected member's session (locked decision #5).
 *  - getSubscriptions/getSubscriptionCount → union across members.
 */
export class MultiplexGateway implements GatewayClientLike {
  /** consumer event handler → per-member bound handler, so off() can detach. */
  private readonly eventBindings = new Map<
    string,
    Map<(...a: unknown[]) => void, Array<{ gw: AnyGateway; bound: (...a: unknown[]) => void }>>
  >();

  constructor(private readonly host: MultiplexGatewayHost) {}

  setStats(): void { /* members keep their own stats collectors */ }

  setProvenanceHook(): void { /* no-op: members stamp their own payloads */ }

  async connect(): Promise<void> {
    await Promise.all(this.host.gatewayMembers().map((m) => m.gateway.connect()));
  }

  disconnect(code?: number, reason?: string): void {
    for (const m of this.host.gatewayMembers()) m.gateway.disconnect(code, reason);
  }

  async reconnect(): Promise<void> {
    await Promise.all(this.host.gatewayMembers().map((m) => m.gateway.reconnect()));
  }

  on(event: string, handler: (...a: unknown[]) => void): void {
    const perEvent =
      this.eventBindings.get(event) ??
      this.eventBindings.set(event, new Map()).get(event)!;
    const bound: Array<{ gw: AnyGateway; bound: (...a: unknown[]) => void }> = [];
    for (const m of this.host.gatewayMembers()) {
      const gw = m.gateway as AnyGateway;
      const b = (...a: unknown[]) => handler(...a);
      gw.on(event, b);
      bound.push({ gw, bound: b });
    }
    perEvent.set(handler, bound);
  }

  off(event: string, handler: (...a: unknown[]) => void): void {
    const bound = this.eventBindings.get(event)?.get(handler);
    if (!bound) return;
    for (const { gw, bound: b } of bound) gw.off(event, b);
    this.eventBindings.get(event)!.delete(handler);
  }

  subscribe(channel: ChannelRef, options?: { diff_only?: boolean }): void {
    for (const m of this.host.gatewayMembersForAgent(channel.agent_id))
      m.gateway.subscribe(channel, options);
  }

  unsubscribe(channel: ChannelRef): void {
    for (const m of this.host.gatewayMembersForAgent(channel.agent_id))
      m.gateway.unsubscribe(channel);
  }

  subscribeToChannel(
    channel: ChannelRef,
    handlers: Record<string, (...a: unknown[]) => void>,
  ): () => void {
    const offs = this.host
      .gatewayMembersForAgent(channel.agent_id)
      .map((m) => (m.gateway as AnyGateway).subscribeToChannel(channel, handlers));
    let done = false;
    return () => {
      if (done) return;
      done = true;
      offs.forEach((o) => o());
    };
  }

  syncChannel(channel: ChannelRef): void {
    for (const m of this.host.gatewayMembersForAgent(channel.agent_id))
      m.gateway.syncChannel(channel);
  }

  sendOneShotMessage(channel: ChannelRef, data: unknown): void {
    for (const m of this.host.gatewayMembersForAgent(channel.agent_id))
      m.gateway.sendOneShotMessage(channel, data as never);
  }

  getSession(): WebSocketSession | null {
    for (const m of this.host.gatewayMembers()) {
      const s = m.gateway.getSession();
      if (s) return s;
    }
    return null;
  }

  isConnected(): boolean {
    const members = this.host.gatewayMembers();
    if (members.length === 0) return false;
    return members.every((m) => m.gateway.isConnected());
  }

  getSubscriptionCount(): number {
    return this.getSubscriptions().length;
  }

  getSubscriptions(): ChannelRef[] {
    const seen = new Set<string>();
    const out: ChannelRef[] = [];
    for (const m of this.host.gatewayMembers()) {
      for (const c of m.gateway.getSubscriptions()) {
        const k = `${c.agent_id}/${c.name}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(c);
      }
    }
    return out;
  }
}
