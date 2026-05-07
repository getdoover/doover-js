import { expect } from "chai";
import { DooverStatsCollector } from "../client/stats";

describe("DooverStatsCollector RPC counters", () => {
  it("returns zeroed rpc snapshot when disabled", () => {
    const c = new DooverStatsCollector();
    const snap = c.snapshot();
    expect(snap.rpc).to.deep.equal({
      enabled: false,
      totalRpcs: 0,
      pendingRpcs: 0,
      completedRpcs: 0,
      failedRpcs: 0,
      timedOutRpcs: 0,
      abortedRpcs: 0,
      averageLatencyMs: null,
      lastLatencyMs: null,
      peakPendingRpcs: 0,
    });
  });

  it("tracks success/error/timeout/abort separately", () => {
    const c = new DooverStatsCollector();
    c.setEnabled(true);
    const a = c.recordRpcStart();
    const b = c.recordRpcStart();
    const cc = c.recordRpcStart();
    const d = c.recordRpcStart();
    c.recordRpcEnd(a, "success");
    c.recordRpcEnd(b, "error");
    c.recordRpcEnd(cc, "timeout");
    c.recordRpcEnd(d, "abort");
    const snap = c.snapshot();
    expect(snap.rpc.totalRpcs).to.equal(4);
    expect(snap.rpc.pendingRpcs).to.equal(0);
    expect(snap.rpc.completedRpcs).to.equal(1);
    expect(snap.rpc.failedRpcs).to.equal(1);
    expect(snap.rpc.timedOutRpcs).to.equal(1);
    expect(snap.rpc.abortedRpcs).to.equal(1);
    expect(snap.rpc.averageLatencyMs).to.be.a("number");
    expect(snap.rpc.lastLatencyMs).to.be.a("number");
  });

  it("tracks peakPendingRpcs as a high-water mark", () => {
    const c = new DooverStatsCollector();
    c.setEnabled(true);
    const a = c.recordRpcStart();
    const b = c.recordRpcStart();
    const cc = c.recordRpcStart();
    c.recordRpcEnd(a, "success");
    c.recordRpcEnd(b, "success");
    c.recordRpcEnd(cc, "success");
    const d = c.recordRpcStart();
    c.recordRpcEnd(d, "success");
    expect(c.snapshot().rpc.peakPendingRpcs).to.equal(3);
  });

  it("disabled collector short-circuits start (returns null)", () => {
    const c = new DooverStatsCollector();
    expect(c.recordRpcStart()).to.equal(null);
  });

  it("reset() clears RPC counters", () => {
    const c = new DooverStatsCollector();
    c.setEnabled(true);
    const a = c.recordRpcStart();
    c.recordRpcEnd(a, "success");
    c.reset();
    expect(c.snapshot().rpc.totalRpcs).to.equal(0);
    expect(c.snapshot().rpc.peakPendingRpcs).to.equal(0);
  });
});
