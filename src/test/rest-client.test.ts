import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { beforeEach, describe, it } from "mocha";

import { DooverApiError } from "../http/errors";
import { RestClient } from "../http/rest-client";
import {
  createBlobResponse,
  createFetchMock,
  createJsonResponse,
  createTextResponse,
  installSessionStorageMock,
} from "./helpers";

use(chaiAsPromised);

describe("RestClient", () => {
  beforeEach(() => {
    installSessionStorageMock();
  });

  it("adds query params and compatibility headers", async () => {
    sessionStorage.setItem("impersonate_user_id", "user-2");
    const fetchMock = createFetchMock();
    const client = new RestClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      organisationId: "org-1",
      fetchImpl: fetchMock as typeof fetch,
    });

    await client.get("/items", { tag: ["a", "b"], enabled: true });

    expect(fetchMock.callCount).to.equal(1);
    const [url, init] = fetchMock.getCall(0).args;
    expect(url).to.equal("https://api.example.com/items?tag=a&tag=b&enabled=true");
    expect(init?.credentials).to.equal("include");

    const headers = init?.headers as Headers;
    expect(headers.get("X-Doover-Sharing")).to.equal("internal");
    expect(headers.get("X-Doover-Organisation")).to.equal("org-1");
    expect(headers.get("X-Doover-Assume")).to.equal("user-2");
  });

  it("serializes JSON request bodies", async () => {
    const fetchMock = createFetchMock();
    const client = new RestClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
    });

    await client.post("/items", { name: "alpha" });

    const [, init] = fetchMock.getCall(0).args;
    expect(init?.method).to.equal("POST");
    expect(init?.body).to.equal(JSON.stringify({ name: "alpha" }));
    const headers = init?.headers as Headers;
    expect(headers.get("Content-Type")).to.equal("application/json");
  });

  it("passes through FormData bodies without forcing JSON content type", async () => {
    const fetchMock = createFetchMock();
    const client = new RestClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
    });
    const formData = new FormData();
    formData.set("a", "1");

    await client.post("/upload", formData);

    const [, init] = fetchMock.getCall(0).args;
    expect(init?.body).to.equal(formData);
    const headers = init?.headers as Headers;
    expect(headers.get("Content-Type")).to.equal(null);
  });

  it("parses blob responses for attachments", async () => {
    const fetchMock = createFetchMock(() => createBlobResponse("hello"));
    const client = new RestClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
    });

    const blob = await client.get<Blob>("/blob");
    expect(blob).to.be.instanceOf(Blob);
    expect(await blob.text()).to.equal("hello");
  });

  it("returns undefined for empty 204 responses", async () => {
    const fetchMock = createFetchMock(() => new Response(null, { status: 204 }));
    const client = new RestClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(client.delete("/items/1")).to.eventually.equal(undefined);
  });

  it("throws a DooverApiError on non-2xx responses", async () => {
    const fetchMock = createFetchMock(() =>
      createJsonResponse({ message: "bad request" }, { status: 400 }),
    );
    const client = new RestClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(client.get("/broken")).to.be.rejected.then((error: DooverApiError) => {
      expect(error.name).to.equal("DooverApiError");
      expect(error.status).to.equal(400);
      expect(error.message).to.equal("bad request");
      expect(error.url).to.equal("https://api.example.com/broken");
      expect(error.method).to.equal("GET");
    });
  });

  it("returns text bodies when the response is not JSON", async () => {
    const fetchMock = createFetchMock(() => createTextResponse("plain text"));
    const client = new RestClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(client.get<string>("/text")).to.eventually.equal("plain text");
  });
});
