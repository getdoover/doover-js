import { expect } from "chai";
import { describe, it } from "mocha";

import { ClientStatusTracker } from "../client/status-tracker";

// Minimal GatewayClientLike stub: just on/off + isConnected + getSession.
function makeGatewayStub() {
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
  let connected = false;
  let session: { session_id: string } | null = null;
  return {
    gw: {
      on(e: string, h: (...a: unknown[]) => void) {
        (listeners.get(e) ?? listeners.set(e, new Set()).get(e)!).add(h);
      },
      off(e: string, h: (...a: unknown[]) => void) {
        listeners.get(e)?.delete(h);
      },
      isConnected: () => connected,
      getSession: () => session,
    } as unknown as import("../client/data-client").GatewayClientLike,
    emit(e: string, ...args: unknown[]) {
      listeners.get(e)?.forEach((h) => h(...args));
    },
    setConnected(v: boolean) { connected = v; },
    setSession(s: { session_id: string } | null) { session = s; },
  };
}

describe("ClientStatusTracker", () => {
  it("derives state from gateway lifecycle and notifies listeners", () => {
    const { gw, emit, setConnected, setSession } = makeGatewayStub();
    const tracker = new ClientStatusTracker("cloud", gw, () => "all");
    const seen: string[] = [];
    const off = tracker.onChange((s) => seen.push(s.state));

    expect(tracker.getStatus().state).to.equal("disconnected");
    expect(tracker.getStatus().agentScope).to.equal("all");

    emit("open");
    expect(tracker.getStatus().lastEvent).to.equal("open");

    setConnected(true);
    setSession({ session_id: "s1" });
    emit("ready", { session_id: "s1" });
    const ready = tracker.getStatus();
    expect(ready.connected).to.equal(true);
    expect(ready.state).to.equal("connected");
    expect(ready.session).to.deep.equal({ id: "s1" });

    setConnected(false);
    emit("close", { code: 1006 });
    expect(tracker.getStatus().connected).to.equal(false);
    expect(tracker.getStatus().state).to.equal("connecting");

    emit("wssError", { message: "boom" });
    expect(tracker.getStatus().state).to.equal("error");
    expect(tracker.getStatus().lastError).to.equal("boom");

    expect(seen.length).to.be.greaterThan(3);
    off();
    emit("open");
    const len = seen.length;
    emit("ready", { session_id: "s2" });
    expect(seen.length).to.equal(len); // unsubscribed
  });

  it("recovers from error state after reconnect", () => {
    const { gw, emit, setConnected, setSession } = makeGatewayStub();
    const tracker = new ClientStatusTracker("cloud", gw, () => "all");

    // Drive to error state first
    emit("open");
    setConnected(true);
    setSession({ session_id: "s1" });
    emit("ready", { session_id: "s1" });
    setConnected(false);
    emit("close", { code: 1006 });
    emit("wssError", { message: "connection lost" });
    expect(tracker.getStatus().state).to.equal("error");
    expect(tracker.getStatus().lastError).to.equal("connection lost");

    // Reconnect: open clears error, transitions to connecting
    emit("open");
    expect(tracker.getStatus().state).to.equal("connecting");
    expect(tracker.getStatus().lastError).to.be.undefined;

    // Session established: transitions to connected with new session
    setConnected(true);
    setSession({ session_id: "s2" });
    emit("ready", { session_id: "s2" });
    const status = tracker.getStatus();
    expect(status.state).to.equal("connected");
    expect(status.session).to.deep.equal({ id: "s2" });
  });
});
