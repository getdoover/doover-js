import { expect } from "chai";
import { describe, it } from "mocha";

import { DooverClient } from "../client/doover-client";
import { MockWebSocket, createFetchMock } from "./helpers";

describe("DooverClient", () => {
  it("wires all public subclients", () => {
    const client = new DooverClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: createFetchMock() as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    expect(client.viewer).to.exist;
    expect(client.channels).to.exist;
    expect(client.messages).to.exist;
    expect(client.aggregates).to.exist;
    expect(client.alarms).to.exist;
    expect(client.connections).to.exist;
    expect(client.notifications).to.exist;
    expect(client.permissions).to.exist;
    expect(client.processors).to.exist;
    expect(client.turn).to.exist;
    expect(client.agents).to.exist;
    expect(client.gateway).to.exist;
  });
});
