import { expect } from "chai";
import sinon from "sinon";
import { afterEach, describe, it } from "mocha";
import { DooverClient } from "../client/doover-client.js";
import { createNetworkStatusStore } from "../client/network-status.js";

function setup() {
  const network = createNetworkStatusStore(true);
  let available = true;
  let commands = 0;
  let probes = 0;
  const client = new DooverClient({
    dataRestUrl: "https://data.example.test/api",
    controlApiUrl: "https://control.example.test/api",
    dataWssUrl: "wss://data.example.test",
    networkStatus: network,
    disableBrowserLifecycleHooks: true,
    fetchImpl: async (_url, init) => {
      if (init?.method === "HEAD") probes++;
      if (init?.method === "POST") commands++;
      if (!available) throw new TypeError("Failed to fetch: ERR_NAME_NOT_RESOLVED");
      return new Response(null, { status: 404 });
    },
  });
  return { client, network, setAvailable(value: boolean) { available = value; },
    counts: () => ({ commands, probes }) };
}

function observe(client: DooverClient, listener = () => {}): () => void {
  if (!client.reachability) throw new Error("Expected a reachability source");
  return client.reachability.subscribe(listener);
}

describe("service reachability through DooverClient", () => {
  afterEach(() => sinon.restore());

  it("detects an idle outage with the browser still online and recovers without replaying commands", async () => {
    const clock = sinon.useFakeTimers();
    const { client, network, setAvailable, counts } = setup();
    const stop = observe(client);
    try {
      await clock.tickAsync(0);
      expect(client.reachability?.getSnapshot()).to.equal("reachable");
      setAvailable(false);
      await clock.tickAsync(30_000);
      expect(network.getSnapshot().online).to.equal(true);
      expect(client.reachability?.getSnapshot()).to.equal("unreachable");
      try { await client.rest.post("/command", { value: false }); } catch { /* expected transport failure */ }
      expect(counts().commands).to.equal(1);
      setAvailable(true);
      await clock.tickAsync(5_000);
      expect(client.reachability?.getSnapshot()).to.equal("reachable");
      expect(counts().commands).to.equal(1);
    } finally { stop(); }
    const previous = counts().probes;
    await clock.tickAsync(60_000);
    expect(counts().probes).to.equal(previous);
  });
  it("checks promptly after a transport failure and coalesces multiple observers", async () => {
    const clock = sinon.useFakeTimers();
    const { client, setAvailable, counts } = setup();
    const stopA = observe(client);
    const stopB = observe(client);
    try {
      await clock.tickAsync(2000);
      expect(counts().probes).to.equal(1);
      setAvailable(false);
      await Promise.all(Array.from({ length: 10 }, () => client.rest.post("/command", {}).catch(() => {})));
      await clock.tickAsync(0);
      expect(client.reachability?.getSnapshot()).to.equal("unreachable");
      expect(counts()).to.deep.equal({ probes: 2, commands: 10 });
      stopA();
      await clock.tickAsync(5000);
      expect(counts().probes).to.equal(3);
    } finally { stopA(); stopB(); }
  });

  it("treats HTTP errors as reachable without triggering extra probes", async () => {
    const clock = sinon.useFakeTimers();
    let probes = 0;
    const client = new DooverClient({
      dataRestUrl: "https://data.example.test", controlApiUrl: "https://control.example.test",
      dataWssUrl: "wss://data.example.test", disableBrowserLifecycleHooks: true,
      fetchImpl: async (_url, init) => {
        if (init?.method === "HEAD") probes++;
        return new Response(null, { status: 500 });
      },
    });
    const stop = observe(client);
    try {
      await clock.tickAsync(0);
      expect(client.reachability?.getSnapshot()).to.equal("reachable");
      await client.rest.get("/test").catch(() => {});
      await clock.tickAsync(2000);
      expect(probes).to.equal(1);
    } finally { stop(); }
  });

  it("bounds hung probes and ignores late responses after recovery or unsubscribe", async () => {
    const clock = sinon.useFakeTimers();
    const network = createNetworkStatusStore(true);
    const pending: Array<(response: Response) => void> = [];
    const client = new DooverClient({
      dataRestUrl: "https://data.example.test", controlApiUrl: "https://control.example.test",
      dataWssUrl: "wss://data.example.test", networkStatus: network, disableBrowserLifecycleHooks: true,
      fetchImpl: () => new Promise<Response>((resolve) => pending.push(resolve)),
    });
    const notifications = sinon.spy();
    const stop = observe(client, notifications);
    try {
      await clock.tickAsync(5000);
      expect(client.reachability?.getSnapshot()).to.equal("unreachable");
      await clock.tickAsync(5000);
      pending[1](new Response(null, { status: 204 }));
      await clock.tickAsync(0);
      expect(client.reachability?.getSnapshot()).to.equal("reachable");
      network.setOnline(false);
      pending[0](new Response(null, { status: 200 }));
      await clock.tickAsync(0);
      expect(client.reachability?.getSnapshot()).to.equal("unreachable");
      network.setOnline(true);
      await clock.tickAsync(0);
      stop();
      const count = notifications.callCount;
      pending[2](new Response(null, { status: 200 }));
      await clock.tickAsync(60_000);
      expect(notifications.callCount).to.equal(count);
      expect(pending.length).to.equal(3);
      expect(clock.countTimers()).to.equal(0);
    } finally { stop(); }
  });

  it("can disable probes and never starts them for an unobserved client", async () => {
    const clock = sinon.useFakeTimers();
    const { client: unobserved, counts } = setup();
    const stopStatus = unobserved.onStatusChange(() => {});
    const fetchImpl = sinon.stub().resolves(new Response(null, { status: 200 }));
    const client = new DooverClient({
      dataRestUrl: "https://data.example.test", controlApiUrl: "https://control.example.test",
      dataWssUrl: "wss://data.example.test", disableBrowserLifecycleHooks: true,
      reachability: false, fetchImpl,
    });
    const stop = client.onStatusChange(() => {});
    await clock.tickAsync(120_000);
    expect(counts().probes).to.equal(0);
    stopStatus();
    expect(fetchImpl.called).to.equal(false);
    expect(client.reachability?.getSnapshot()).to.equal(undefined);
    stop();
  });

});
