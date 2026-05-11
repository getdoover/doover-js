import { expect } from "chai";
import { describe, it } from "mocha";

import { DooverClient } from "../client/doover-client";
import { MockWebSocket, createFetchMock, createJsonResponse } from "./helpers";

function stripSource<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (k, val) => (k === "__source" ? undefined : val)));
}

describe("provenance is additive only", () => {
  it("REST payloads equal the wire body once __source is stripped", async () => {
    const wire = { name: "c1", is_private: false, owner_id: "o", id: "ch1" };
    const client = new DooverClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: createFetchMock(() => createJsonResponse(wire)) as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      disableBrowserLifecycleHooks: true,
    });
    const channel = await client.channels.getChannel("a1", "c1");
    expect(channel.__source).to.exist; // it IS stamped
    expect(stripSource(channel)).to.deep.equal(wire); // …but otherwise byte-identical
  });

  it("listMessages stamps each element, leaving the array shape intact", async () => {
    const wire = [
      { id: "2", data: { v: 2 }, attachments: [], author_id: "a", channel: { agent_id: "a1", name: "c1" } },
      { id: "1", data: { v: 1 }, attachments: [], author_id: "a", channel: { agent_id: "a1", name: "c1" } },
    ];
    const client = new DooverClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: createFetchMock(() => createJsonResponse(wire)) as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      disableBrowserLifecycleHooks: true,
    });
    const msgs = await client.messages.listMessages("a1", "c1", { limit: 2 });
    expect(msgs).to.have.length(2);
    expect(msgs[0].__source?.via).to.include({ method: "messages.listMessages" });
    // shape minus __source and the client-added `timestamp` matches the wire item
    const { __source: _s, timestamp: _t, ...rest } = msgs[0] as Record<string, unknown>;
    expect(rest).to.deep.equal(wire[0]);
  });
});
