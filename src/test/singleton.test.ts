import { expect } from "chai";
import { afterEach, beforeEach, describe, it } from "mocha";
import sinon from "sinon";

import { DooverClient } from "../client/doover-client";
import {
  getDooverClient,
  peekDooverClient,
  resetDooverClient,
} from "../client/singleton";
import { installSessionStorageMock, MockWebSocket } from "./helpers";

describe("getDooverClient", () => {
  beforeEach(() => {
    installSessionStorageMock();
    MockWebSocket.reset();
    Object.defineProperty(globalThis, "WebSocket", {
      value: MockWebSocket,
      configurable: true,
      writable: true,
    });
    resetDooverClient();
  });

  afterEach(() => {
    sinon.restore();
    resetDooverClient();
  });

  const config = {
    dataRestUrl: "https://api.example.com",
    controlApiUrl: "https://control.example.com",
    dataWssUrl: "wss://ws.example.com",
    webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    disableBrowserLifecycleHooks: true,
  };

  it("creates a client on first call and returns the same instance after", () => {
    const a = getDooverClient(config);
    const b = getDooverClient(config);
    expect(a).to.be.instanceOf(DooverClient);
    expect(a).to.equal(b);
  });

  it("peekDooverClient returns null until the first call, then the instance", () => {
    expect(peekDooverClient()).to.equal(null);
    const a = getDooverClient(config);
    expect(peekDooverClient()).to.equal(a);
  });

  it("resetDooverClient clears the singleton so the next call creates a new one", () => {
    const a = getDooverClient(config);
    resetDooverClient();
    const b = getDooverClient(config);
    expect(a).to.not.equal(b);
  });

  it("warns and reuses the existing client when a later caller differs in config", () => {
    const warn = sinon.stub(console, "warn");
    const a = getDooverClient(config);
    const b = getDooverClient({
      ...config,
      dataRestUrl: "https://other.example.com",
    });
    expect(b).to.equal(a);
    expect(warn.calledOnce).to.equal(true);
    expect(warn.getCall(0).args[0] as string).to.match(
      /differs from the already-initialised singleton/,
    );
  });
});
