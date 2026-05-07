import { expect } from "chai";
import { GatewayClient } from "../gateway/gateway-client";
import type { DooverClientConfig } from "../http/rest-client";
import type { Aggregate, MessageStructure } from "../types/common";

function makeConfig(): DooverClientConfig {
  return {
    dataRestUrl: "https://example.com/api",
    controlApiUrl: "https://example.com/control",
    dataWssUrl: "wss://example.com/gateway",
    disableBrowserLifecycleHooks: true,
  } as DooverClientConfig;
}

function fakeMessage(channel = { agent_id: "a1", name: "c1" }, id = "m1"): MessageStructure {
  return {
    id,
    data: {},
    attachments: [],
    author_id: "auth",
    channel,
    timestamp: 1,
  };
}

describe("GatewayClient.subscribeToChannel", () => {
  it("first handler triggers wire-level subscribe", () => {
    const gw = new GatewayClient(makeConfig());
    let subscribeCalls = 0;
    (gw as unknown as { subscribe: (...a: unknown[]) => void }).subscribe = () => {
      subscribeCalls += 1;
    };
    gw.subscribeToChannel({ agent_id: "a1", name: "c1" }, { onMessage: () => {} });
    expect(subscribeCalls).to.equal(1);
  });

  it("second handler does not trigger another wire-level subscribe", () => {
    const gw = new GatewayClient(makeConfig());
    let subscribeCalls = 0;
    (gw as unknown as { subscribe: (...a: unknown[]) => void }).subscribe = () => {
      subscribeCalls += 1;
    };
    gw.subscribeToChannel({ agent_id: "a1", name: "c1" }, { onMessage: () => {} });
    gw.subscribeToChannel({ agent_id: "a1", name: "c1" }, { onMessage: () => {} });
    expect(subscribeCalls).to.equal(1);
  });

  it("returned unsubscribe drops the handler; last drop unsubscribes", () => {
    const gw = new GatewayClient(makeConfig());
    let unsubCalls = 0;
    (gw as unknown as { subscribe: (...a: unknown[]) => void }).subscribe = () => {};
    (gw as unknown as { unsubscribe: (...a: unknown[]) => void }).unsubscribe = () => {
      unsubCalls += 1;
    };
    const off1 = gw.subscribeToChannel({ agent_id: "a1", name: "c1" }, { onMessage: () => {} });
    const off2 = gw.subscribeToChannel({ agent_id: "a1", name: "c1" }, { onMessage: () => {} });
    off1();
    expect(unsubCalls).to.equal(0);
    off2();
    expect(unsubCalls).to.equal(1);
  });

  it("returned unsubscribe is idempotent", () => {
    const gw = new GatewayClient(makeConfig());
    let unsubCalls = 0;
    (gw as unknown as { subscribe: (...a: unknown[]) => void }).subscribe = () => {};
    (gw as unknown as { unsubscribe: (...a: unknown[]) => void }).unsubscribe = () => {
      unsubCalls += 1;
    };
    const off = gw.subscribeToChannel({ agent_id: "a1", name: "c1" }, { onMessage: () => {} });
    off();
    off();
    off();
    expect(unsubCalls).to.equal(1);
  });

  it("messageCreate event fans out to onMessage handlers for the matching channel", () => {
    const gw = new GatewayClient(makeConfig());
    (gw as unknown as { subscribe: (...a: unknown[]) => void }).subscribe = () => {};
    let received: MessageStructure | undefined;
    gw.subscribeToChannel(
      { agent_id: "a1", name: "c1" },
      { onMessage: (m) => { received = m; } },
    );
    (gw as unknown as { emit: (e: string, m: MessageStructure) => void }).emit(
      "messageCreate",
      fakeMessage(),
    );
    expect(received?.id).to.equal("m1");
  });

  it("messageCreate for a different channel does not fire the handler", () => {
    const gw = new GatewayClient(makeConfig());
    (gw as unknown as { subscribe: (...a: unknown[]) => void }).subscribe = () => {};
    let received = false;
    gw.subscribeToChannel(
      { agent_id: "a1", name: "c1" },
      { onMessage: () => { received = true; } },
    );
    (gw as unknown as { emit: (e: string, m: MessageStructure) => void }).emit(
      "messageCreate",
      fakeMessage({ agent_id: "a1", name: "c2" }, "m2"),
    );
    expect(received).to.equal(false);
  });

  it("aggregateUpdate fans out to onAggregate handlers", () => {
    const gw = new GatewayClient(makeConfig());
    (gw as unknown as { subscribe: (...a: unknown[]) => void }).subscribe = () => {};
    let received: Aggregate | undefined;
    gw.subscribeToChannel(
      { agent_id: "a1", name: "c1" },
      { onAggregate: (a) => { received = a; } },
    );
    const aggregate: Aggregate = { data: { x: 1 }, attachments: [] };
    (gw as unknown as { emit: (e: string, p: { channel: { agent_id: string; name: string }; aggregate: Aggregate }) => void }).emit(
      "aggregateUpdate",
      { channel: { agent_id: "a1", name: "c1" }, aggregate },
    );
    expect(received?.data).to.deep.equal({ x: 1 });
  });
});
