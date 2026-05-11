import { expect } from "chai";
import { describe, it } from "mocha";

import { DooverClient } from "../client/doover-client";
import { ALL_CAPABILITIES } from "../client/capabilities";
import { MockWebSocket, createFetchMock } from "./helpers";

function makeClient(extra: Record<string, unknown> = {}) {
  return new DooverClient({
    dataRestUrl: "https://api.example.com",
    controlApiUrl: "https://control.example.com",
    dataWssUrl: "wss://ws.example.com",
    fetchImpl: createFetchMock() as typeof fetch,
    webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    disableBrowserLifecycleHooks: true,
    ...extra,
  });
}

describe("DooverClient as DataClient", () => {
  it("advertises the full capability set", () => {
    const caps = makeClient().getCapabilities();
    for (const c of ALL_CAPABILITIES) expect(caps.has(c)).to.equal(true);
    expect(makeClient().supports("messages.listHistorical")).to.equal(true);
  });

  it("getAgentScope resolves to { mode: 'all' } with no network call", async () => {
    const fetchMock = createFetchMock();
    const client = makeClient({ fetchImpl: fetchMock as typeof fetch });
    expect(await client.getAgentScope()).to.deep.equal({ mode: "all" });
    expect(client.getKnownAgentScope()).to.deep.equal({ mode: "all" });
    expect((fetchMock as { called: boolean }).called).to.equal(false);
  });

  it("isConnected mirrors the gateway; getStatus reflects it; clientId defaults to 'cloud'", () => {
    const client = makeClient();
    expect(client.isConnected()).to.equal(false);
    const status = client.getStatus();
    expect(status.clientId).to.equal("cloud");
    expect(status.connected).to.equal(false);
    expect(status.agentScope).to.deep.equal({ mode: "all" });
  });

  it("honours a custom sourceId", () => {
    expect(makeClient({ sourceId: "cloud-eu" }).getStatus().clientId).to.equal("cloud-eu");
  });

  it("onStatusChange fires on gateway lifecycle and unsubscribes", async () => {
    const client = makeClient();
    const seen: number[] = [];
    const off = client.onStatusChange(() => seen.push(1));
    // Connect gateway and drive a lifecycle event
    await client.gateway.connect();
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws?.open?.();
    expect(seen.length).to.be.greaterThan(0);
    off();
    const len = seen.length;
    ws?.close?.();
    expect(seen.length).to.equal(len);
  });
});
