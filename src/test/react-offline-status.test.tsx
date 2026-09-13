import { expect } from "chai";
import { afterEach, describe, it } from "mocha";
import { act, cleanup, renderHook } from "@testing-library/react";
import React from "react";
import { DooverClient } from "../client/doover-client.js";
import { MemoryOfflineStorageAdapter, OfflineDataClient } from "../client/offline-cache.js";
import { DooverProvider } from "../react/context.js";
import { browserNetworkStatus, createNetworkStatusStore } from "../client/network-status.js";
import sinon from "sinon";
import { useOfflineStatus } from "../react/useOfflineStatus.js";

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: online });
  window.dispatchEvent(new window.Event(online ? "online" : "offline"));
}

function makeClient(networkStatus = browserNetworkStatus) {
  return new DooverClient({
    networkStatus,
    dataRestUrl: "https://api.example.com", controlApiUrl: "https://control.example.com",
    dataWssUrl: "wss://ws.example.com", disableBrowserLifecycleHooks: true,
  });
}

describe("offline status in React", () => {
  afterEach(() => { cleanup(); setOnline(true); sinon.restore(); });

  it("reports an initially offline browser with a regular client", () => {
    setOnline(false);
    const client = makeClient();
    const { result } = renderHook(useOfflineStatus, {
      wrapper: ({ children }) => <DooverProvider client={client}>{children}</DooverProvider>,
    });
    expect(result.current.online).to.equal(false);
    expect(result.current.isOfflineFallback).to.equal(false);
  });

  it("reports disconnect and recovery without any requests", () => {
    setOnline(true);
    const client = makeClient();
    const { result } = renderHook(useOfflineStatus, {
      wrapper: ({ children }) => <DooverProvider client={client}>{children}</DooverProvider>,
    });
    expect(result.current.online).to.equal(true);
    act(() => setOnline(false));
    expect(result.current.online).to.equal(false);
    act(() => setOnline(true));
    expect(result.current.online).to.equal(true);
  });

  it("notifies React even if a request reads the new network status before the event", () => {
    setOnline(true);
    const client = makeClient();
    const { result } = renderHook(useOfflineStatus, {
      wrapper: ({ children }) => <DooverProvider client={client}>{children}</DooverProvider>,
    });
    act(() => {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
      expect(client.networkStatus.getSnapshot().online).to.equal(false);
      window.dispatchEvent(new window.Event("offline"));
    });
    expect(result.current.online).to.equal(false);
  });

  it("returns a stable cache snapshot between changes", () => {
    const client = new OfflineDataClient({ client: makeClient(), storage: new MemoryOfflineStorageAdapter(), scope: { userId: "u1" } });
    expect(client.getOfflineStatus()).to.equal(client.getOfflineStatus());
  });
  it("updates an offline wrapper from browser events without requests", () => {
    setOnline(true);
    const client = new OfflineDataClient({ client: makeClient(), storage: new MemoryOfflineStorageAdapter(), scope: { userId: "u1" } });
    const { result } = renderHook(useOfflineStatus, {
      wrapper: ({ children }) => <DooverProvider client={client}>{children}</DooverProvider>,
    });
    act(() => setOnline(false));
    expect(result.current.online).to.equal(false);
    act(() => setOnline(true));
    expect(result.current.online).to.equal(true);
  });

  it("uses the native source for both regular and caching clients", () => {
    const network = createNetworkStatusStore(false);
    const regular = makeClient(network);
    const cached = new OfflineDataClient({ client: regular, storage: new MemoryOfflineStorageAdapter(), scope: { userId: "u1" } });
    for (const client of [regular, cached]) {
      const { result, unmount } = renderHook(useOfflineStatus, {
        wrapper: ({ children }) => <DooverProvider client={client}>{children}</DooverProvider>,
      });
      expect(result.current.online).to.equal(false);
      act(() => network.setOnline(true));
      expect(result.current.online).to.equal(true);
      act(() => network.setOnline(false));
      expect(result.current.online).to.equal(false);
      unmount();
    }
  });

  it("switches sources when the provider client changes", () => {
    const first = createNetworkStatusStore(true);
    const second = createNetworkStatusStore(false);
    const subscribe = sinon.spy(first, "subscribe");
    let client = makeClient(first);
    const { result, rerender, unmount } = renderHook(useOfflineStatus, {
      wrapper: ({ children }) => <DooverProvider client={client}>{children}</DooverProvider>,
    });
    const original = result.current;
    act(() => first.setOnline(true));
    expect(result.current).to.equal(original);
    client = makeClient(second);
    rerender();
    expect(result.current.online).to.equal(false);
    expect(subscribe.calledOnce).to.equal(true);
    act(() => first.setOnline(false));
    expect(result.current.online).to.equal(false);
    unmount();
  });

  it("removes browser listeners after the last hook unmounts", () => {
    const add = sinon.spy(window, "addEventListener");
    const remove = sinon.spy(window, "removeEventListener");
    const client = makeClient();
    const wrapper = ({ children }: React.PropsWithChildren) => <DooverProvider client={client}>{children}</DooverProvider>;
    const first = renderHook(useOfflineStatus, { wrapper });
    const second = renderHook(useOfflineStatus, { wrapper });
    expect(add.getCalls().filter((call) => call.args[0] === "offline")).to.have.length(1);
    first.unmount();
    expect(remove.getCalls().filter((call) => call.args[0] === "offline")).to.have.length(0);
    second.unmount();
    expect(remove.getCalls().filter((call) => call.args[0] === "offline")).to.have.length(1);
    setOnline(false);
    const remount = renderHook(useOfflineStatus, { wrapper });
    expect(remount.result.current.online).to.equal(false);
  });

});
