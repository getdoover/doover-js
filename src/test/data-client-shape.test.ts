import { expect } from "chai";
import { describe, it } from "mocha";

import { DooverClient } from "../client/doover-client";
import type { DataClient } from "../client/data-client";
import { MockWebSocket, createFetchMock } from "./helpers";

describe("DataClient shape", () => {
  it("DooverClient is assignable to DataClient (compile-time) and has the contract methods", () => {
    const client: DataClient = new DooverClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: createFetchMock() as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      disableBrowserLifecycleHooks: true,
    });
    expect(client.agents).to.exist;
    expect(client.gateway).to.exist;
    expect(client.rpc).to.exist;
    expect(typeof client.getCapabilities).to.equal("function");
    expect(typeof client.supports).to.equal("function");
    expect(typeof client.isConnected).to.equal("function");
    expect(typeof client.getStatus).to.equal("function");
    expect(typeof client.onStatusChange).to.equal("function");
    expect(typeof client.getAgentScope).to.equal("function");
    expect(typeof client.getKnownAgentScope).to.equal("function");
  });
});
