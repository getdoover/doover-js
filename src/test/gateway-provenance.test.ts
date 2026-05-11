import { expect } from "chai";
import { describe, it } from "mocha";

import { GatewayClient } from "../gateway/gateway-client";
import type { DooverClientConfig } from "../http/rest-client";

function makeConfig(): DooverClientConfig {
  return {
    dataRestUrl: "https://example.com/api",
    controlApiUrl: "https://example.com/control",
    dataWssUrl: "wss://example.com/gateway",
    disableBrowserLifecycleHooks: true,
  } as DooverClientConfig;
}

describe("GatewayClient provenance hook", () => {
  it("stamps emitted payloads when a hook is set; raw when not", () => {
    const gw = new GatewayClient(makeConfig());
    let stamped: unknown;
    gw.on("messageCreate", (m) => { stamped = m; });
    // Use a valid snowflake-format id (epoch-based numeric string)
    const snowflake = String(BigInt(Date.now()) << 22n);
    // no hook → raw
    (gw as unknown as { handleMessage: (raw: string) => void }).handleMessage(
      JSON.stringify({ op: 0, t: "MessageCreate", d: { id: snowflake, data: {}, attachments: [], author_id: "a", channel: { agent_id: "x", name: "c" } } }),
    );
    expect((stamped as { __source?: unknown }).__source).to.equal(undefined);

    // with hook → stamped
    gw.setProvenanceHook((value, ctx) => ({ ...(value as object), __source: { client: { id: "cloud", kind: "cloud" }, retrievedAt: Date.now(), via: { transport: "gateway", event: ctx.event, receivedAt: Date.now() } } }) as never);
    (gw as unknown as { handleMessage: (raw: string) => void }).handleMessage(
      JSON.stringify({ op: 0, t: "MessageCreate", d: { id: snowflake, data: {}, attachments: [], author_id: "a", channel: { agent_id: "x", name: "c" } } }),
    );
    expect((stamped as { __source?: { via: { event: string } } }).__source?.via.event).to.equal("messageCreate");
  });
});
