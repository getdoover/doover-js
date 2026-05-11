import { expect } from "chai";
import { describe, it } from "mocha";

import { DooverClient } from "../client/doover-client";
import { MockWebSocket, createFetchMock, createJsonResponse } from "./helpers";

describe("DooverClient REST provenance", () => {
  it("stamps __source on REST results", async () => {
    const fetchMock = createFetchMock((url) => {
      if (url.includes("/channels/c1")) return createJsonResponse({ name: "c1", is_private: false, owner_id: "o" });
      return createJsonResponse({});
    });
    const client = new DooverClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      disableBrowserLifecycleHooks: true,
      sourceId: "cloud",
    });
    const channel = await client.channels.getChannel("a1", "c1");
    expect(channel.name).to.equal("c1");
    expect(channel.__source?.client).to.deep.include({ id: "cloud", kind: "cloud" });
    expect(channel.__source?.via).to.include({ transport: "rest", method: "channels.getChannel" });
    if (channel.__source?.via.transport === "rest") {
      expect(channel.__source.via.durationMs).to.be.a("number");
      expect(channel.__source.via.request).to.have.property("args");
    }
  });
});
