import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { afterEach, beforeEach, describe, it } from "mocha";
import sinon from "sinon";

import { AuthProfile } from "../auth/auth-profile";
import type { AuthProfileStore } from "../auth/auth-store";
import { buildAuth } from "../auth/build-auth";
import { CookieAuth } from "../auth/cookie-auth";
import { DooverTokenAuth } from "../auth/doover-token-auth";
import { DooverAuthError } from "../auth/errors";
import { decodeTokenExpiry } from "../auth/jwt";
import { DooverClient } from "../client/doover-client";
import { GatewayClient } from "../gateway/gateway-client";
import { RestClient } from "../http/rest-client";
import {
  createFetchMock,
  createJsonResponse,
  installSessionStorageMock,
  MockWebSocket,
} from "./helpers";

use(chaiAsPromised);

// ---------------------------------------------------------------------------
// Helper: create a minimal JWT with a given `exp` claim
// ---------------------------------------------------------------------------
function makeJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `${header}.${payload}.fakesig`;
}

// ---------------------------------------------------------------------------
// Helper: in-memory AuthProfileStore
// ---------------------------------------------------------------------------
class MemoryProfileStore implements AuthProfileStore {
  currentProfile: string | null = null;
  current: AuthProfile | null = null;
  private profiles = new Map<string, AuthProfile>();
  writeCalled = 0;

  get(name: string) {
    return this.profiles.get(name);
  }
  create(entry: AuthProfile) {
    this.profiles.set(entry.profile, entry);
  }
  delete(name: string) {
    this.profiles.delete(name);
  }
  write() {
    this.writeCalled++;
  }
}

// ---------------------------------------------------------------------------
// Helpers: cookie-auth session state
// ---------------------------------------------------------------------------
/** An `app.at_exp` cookie string expiring `secondsFromNow` from now. */
function expiryCookie(secondsFromNow: number): string {
  return `app.at_exp=${Math.floor(Date.now() / 1000) + secondsFromNow}`;
}

/** A refresh-capable CookieAuth over a fixed cookie string. */
function cookieAuth(options: {
  cookie: string;
  fetchMock?: sinon.SinonStub;
}): CookieAuth {
  return new CookieAuth({
    authServerUrl: "https://auth.example.com",
    fetchImpl: (options.fetchMock ?? createFetchMock()) as typeof fetch,
    cookieReader: () => options.cookie,
  });
}

// ---------------------------------------------------------------------------
// CookieAuth
// ---------------------------------------------------------------------------
describe("CookieAuth", () => {
  it("sends no auth header and uses credentials: include", async () => {
    const auth = new CookieAuth();
    expect(await auth.getHttpHeaders()).to.deep.equal({});
    expect(auth.getFetchCredentials()).to.equal("include");
  });

  it("prepareWebSocket returns the URL unchanged", async () => {
    const auth = new CookieAuth();
    const result = await auth.prepareWebSocket("wss://example.com/ws", true);
    expect(result).to.deep.equal({ url: "wss://example.com/ws" });
  });

  it("ensureReady resolves immediately", async () => {
    const auth = new CookieAuth();
    await auth.ensureReady(); // should not throw
  });

  it("does not refresh when no authServerUrl is configured", async () => {
    const fetchMock = createFetchMock();
    const auth = new CookieAuth({
      fetchImpl: fetchMock as typeof fetch,
      cookieReader: () => expiryCookie(-60),
    });

    expect(await auth.handleUnauthorized()).to.equal(false);
    await auth.ensureReady();
    expect(fetchMock.callCount).to.equal(0);
  });

  // -- Session inspection ---------------------------------------------------

  it("reads the expiry cookie", () => {
    const auth = cookieAuth({ cookie: expiryCookie(3600) });
    expect(auth.isAccessTokenValid()).to.equal(true);
    expect(auth.isAccessTokenStale()).to.equal(false);
    expect(auth.getAccessTokenExpiry()).to.be.instanceOf(Date);
  });

  it("treats an expired cookie as invalid but refreshable", () => {
    const auth = cookieAuth({ cookie: expiryCookie(-60) });
    expect(auth.isAccessTokenValid()).to.equal(false);
    expect(auth.isAccessTokenStale()).to.equal(true);
  });

  it("reports a near-expiry token as stale while still valid", () => {
    const auth = cookieAuth({ cookie: expiryCookie(60) });
    expect(auth.isAccessTokenValid()).to.equal(true);
    expect(auth.isAccessTokenStale(5 * 60_000)).to.equal(true);
  });

  it("reports no session when the cookie is absent", () => {
    const auth = cookieAuth({ cookie: "other=1" });
    expect(auth.getAccessTokenExpiry()).to.equal(null);
    expect(auth.isAccessTokenValid()).to.equal(false);
    // Nothing to refresh — must not read as "stale".
    expect(auth.isAccessTokenStale()).to.equal(false);
  });

  it("ignores a non-numeric expiry cookie", () => {
    const auth = cookieAuth({ cookie: "app.at_exp=garbage" });
    expect(auth.getAccessTokenExpiry()).to.equal(null);
    expect(auth.isAccessTokenValid()).to.equal(false);
  });

  it("honours a custom expiry cookie name", () => {
    const auth = new CookieAuth({
      authServerUrl: "https://auth.example.com",
      accessTokenExpiryCookieName: "custom.exp",
      cookieReader: () =>
        `custom.exp=${Math.floor(Date.now() / 1000) + 3600}`,
    });
    expect(auth.isAccessTokenValid()).to.equal(true);
  });

  // -- Refresh behaviour ----------------------------------------------------

  it("refreshes an expired token via the hosted-backend endpoint", async () => {
    const fetchMock = createFetchMock(() => createJsonResponse({}));
    const auth = cookieAuth({ cookie: expiryCookie(-60), fetchMock });

    expect(await auth.handleUnauthorized()).to.equal(true);
    expect(fetchMock.callCount).to.equal(1);
    expect(fetchMock.firstCall.args[0]).to.equal(
      "https://auth.example.com/app/refresh/",
    );
    const init = fetchMock.firstCall.args[1] as RequestInit;
    expect(init.method).to.equal("POST");
    expect(init.credentials).to.equal("include");
  });

  it("honours a custom refresh path", async () => {
    const fetchMock = createFetchMock(() => createJsonResponse({}));
    const auth = new CookieAuth({
      authServerUrl: "https://auth.example.com",
      refreshPath: "/proxy/renew",
      fetchImpl: fetchMock as typeof fetch,
      cookieReader: () => expiryCookie(-60),
    });

    await auth.refreshAccessToken();
    expect(fetchMock.firstCall.args[0]).to.equal(
      "https://auth.example.com/proxy/renew",
    );
  });

  it("reports failure when the refresh endpoint rejects", async () => {
    const fetchMock = createFetchMock(() =>
      createJsonResponse({}, { status: 400 }),
    );
    const auth = cookieAuth({ cookie: expiryCookie(-60), fetchMock });

    expect(await auth.handleUnauthorized()).to.equal(false);
  });

  it("reports failure when the refresh request throws", async () => {
    const fetchMock = sinon.stub().rejects(new Error("offline"));
    const auth = cookieAuth({ cookie: expiryCookie(-60), fetchMock });

    expect(await auth.handleUnauthorized()).to.equal(false);
  });

  it("skips the refresh call when there is no session cookie", async () => {
    const fetchMock = createFetchMock(() => createJsonResponse({}));
    const auth = cookieAuth({ cookie: "", fetchMock });

    expect(await auth.handleUnauthorized()).to.equal(false);
    expect(fetchMock.callCount).to.equal(0);
  });

  it("collapses concurrent refreshes onto one request", async () => {
    const fetchMock = createFetchMock(() => createJsonResponse({}));
    const auth = cookieAuth({ cookie: expiryCookie(-60), fetchMock });

    const results = await Promise.all([
      auth.handleUnauthorized(),
      auth.handleUnauthorized(),
      auth.handleUnauthorized(),
    ]);

    expect(results).to.deep.equal([true, true, true]);
    expect(fetchMock.callCount).to.equal(1);
  });

  it("reuses a recent failure instead of retrying in a loop", async () => {
    const fetchMock = createFetchMock(() =>
      createJsonResponse({}, { status: 400 }),
    );
    const auth = cookieAuth({ cookie: expiryCookie(-60), fetchMock });

    expect(await auth.handleUnauthorized()).to.equal(false);
    expect(await auth.handleUnauthorized()).to.equal(false);
    expect(await auth.handleUnauthorized()).to.equal(false);
    expect(fetchMock.callCount).to.equal(1);
  });

  it("ensureReady refreshes an expired token before the request goes out", async () => {
    const fetchMock = createFetchMock(() => createJsonResponse({}));
    const auth = cookieAuth({ cookie: expiryCookie(-60), fetchMock });

    await auth.ensureReady();
    expect(fetchMock.callCount).to.equal(1);
  });

  it("ensureReady leaves a valid token alone", async () => {
    const fetchMock = createFetchMock(() => createJsonResponse({}));
    const auth = cookieAuth({ cookie: expiryCookie(30), fetchMock });

    await auth.ensureReady();
    expect(fetchMock.callCount).to.equal(0);
  });

  it("ensureReady does not reject when the refresh fails", async () => {
    const fetchMock = sinon.stub().rejects(new Error("offline"));
    const auth = cookieAuth({ cookie: expiryCookie(-60), fetchMock });

    await auth.ensureReady(); // should not throw
  });
});

// ---------------------------------------------------------------------------
// DooverTokenAuth
// ---------------------------------------------------------------------------
describe("DooverTokenAuth", () => {
  afterEach(() => sinon.restore());

  it("sends bearer header and uses credentials: omit", async () => {
    const auth = new DooverTokenAuth({ token: "tok123" });
    expect(await auth.getHttpHeaders()).to.deep.equal({
      Authorization: "Bearer tok123",
    });
    expect(auth.getFetchCredentials()).to.equal("omit");
  });

  it("returns empty headers when no token is set", async () => {
    const auth = new DooverTokenAuth({});
    expect(await auth.getHttpHeaders()).to.deep.equal({});
  });

  it("setToken updates the token", async () => {
    const auth = new DooverTokenAuth({ token: "old" });
    auth.setToken("new-token");
    expect(await auth.getHttpHeaders()).to.deep.equal({
      Authorization: "Bearer new-token",
    });
  });

  it("setRefreshToken updates the refresh token used by ensureReady", async () => {
    const fetchMock = createFetchMock(() =>
      createJsonResponse({
        access_token: "new-access-token",
        expires_in: 3600,
      }),
    );
    const auth = new DooverTokenAuth({
      token: null,
      authServerUrl: "https://auth.example.com",
      authServerClientId: "client-1",
      fetchImpl: fetchMock as typeof fetch,
    });
    auth.setRefreshToken("new-refresh-token");

    await auth.ensureReady();

    expect(fetchMock.callCount).to.equal(1);
    expect(fetchMock.firstCall.args[0]).to.contain(
      "refresh_token=new-refresh-token",
    );
    expect(await auth.getHttpHeaders()).to.deep.equal({
      Authorization: "Bearer new-access-token",
    });
  });

  // -- Refresh behaviour ----------------------------------------------------

  it("does not refresh when token is clearly valid", async () => {
    const farFuture = Date.now() + 3600_000;
    const fetchMock = createFetchMock();
    const auth = new DooverTokenAuth({
      token: "valid",
      tokenExpires: new Date(farFuture),
      refreshToken: "rt",
      authServerUrl: "https://auth.example.com",
      authServerClientId: "client-1",
      fetchImpl: fetchMock as typeof fetch,
    });
    await auth.ensureReady();
    expect(fetchMock.callCount).to.equal(0);
  });

  it("triggers refresh when token is missing", async () => {
    const fetchMock = createFetchMock(() =>
      createJsonResponse({
        access_token: "new-tok",
        expires_in: 3600,
      }),
    );
    const auth = new DooverTokenAuth({
      token: null,
      refreshToken: "rt",
      authServerUrl: "https://auth.example.com",
      authServerClientId: "client-1",
      fetchImpl: fetchMock as typeof fetch,
    });
    await auth.ensureReady();
    expect(fetchMock.callCount).to.equal(1);
    expect(await auth.getHttpHeaders()).to.deep.equal({
      Authorization: "Bearer new-tok",
    });
  });

  it("triggers refresh within the 30-second expiry buffer", async () => {
    const almostExpired = Date.now() + 15_000; // 15 s left
    const fetchMock = createFetchMock(() =>
      createJsonResponse({
        access_token: "refreshed-tok",
        expires_in: 3600,
      }),
    );
    const auth = new DooverTokenAuth({
      token: "old-tok",
      tokenExpires: new Date(almostExpired),
      refreshToken: "rt",
      authServerUrl: "https://auth.example.com",
      authServerClientId: "client-1",
      fetchImpl: fetchMock as typeof fetch,
    });
    await auth.ensureReady();
    expect(fetchMock.callCount).to.equal(1);
    expect(await auth.getHttpHeaders()).to.deep.equal({
      Authorization: "Bearer refreshed-tok",
    });
  });

  it("throws DooverAuthError when refresh metadata is incomplete", async () => {
    const auth = new DooverTokenAuth({
      token: null,
      // No refreshToken, authServerUrl, or authServerClientId
    });
    await expect(auth.ensureReady()).to.be.rejectedWith(
      DooverAuthError,
      /missing authServerUrl/,
    );
  });

  it("throws DooverAuthError when refresh HTTP request fails", async () => {
    const fetchMock = createFetchMock(() =>
      createJsonResponse({ error: "invalid_grant" }, { status: 400 }),
    );
    const auth = new DooverTokenAuth({
      token: null,
      refreshToken: "rt",
      authServerUrl: "https://auth.example.com",
      authServerClientId: "client-1",
      fetchImpl: fetchMock as typeof fetch,
    });
    await expect(auth.ensureReady()).to.be.rejectedWith(
      DooverAuthError,
      /status 400/,
    );
  });

  it("writes refreshed token back to the attached ConfigManager", async () => {
    const store = new MemoryProfileStore();
    const profile = new AuthProfile({
      profile: "test",
      refreshToken: "rt",
      authServerUrl: "https://auth.example.com",
      authServerClientId: "client-1",
    });
    store.create(profile);

    const fetchMock = createFetchMock(() =>
      createJsonResponse({
        access_token: "refreshed",
        expires_in: 3600,
        refresh_token: "new-rt",
      }),
    );

    // Construct with no token so refresh is triggered
    const auth = new DooverTokenAuth({
      refreshToken: "rt",
      authServerUrl: "https://auth.example.com",
      authServerClientId: "client-1",
      fetchImpl: fetchMock as typeof fetch,
    });
    auth.attachProfile(profile, store);

    await auth.ensureReady();

    expect(profile.token).to.equal("refreshed");
    expect(profile.refreshToken).to.equal("new-rt");
    expect(store.writeCalled).to.equal(1);
  });

  // -- WebSocket auth -------------------------------------------------------

  it("prepareWebSocket uses Authorization header when canUseHeaders is true", async () => {
    const auth = new DooverTokenAuth({ token: "ws-tok" });
    const result = await auth.prepareWebSocket("wss://ws.example.com", true);
    expect(result.url).to.equal("wss://ws.example.com");
    expect(result.headers).to.deep.equal({
      Authorization: "Bearer ws-tok",
    });
  });

  it("prepareWebSocket appends ?token= when canUseHeaders is false", async () => {
    const auth = new DooverTokenAuth({ token: "ws-tok" });
    const result = await auth.prepareWebSocket("wss://ws.example.com/path", false);
    expect(result.url).to.equal("wss://ws.example.com/path?token=ws-tok");
    expect(result.headers).to.be.undefined;
  });
});

// ---------------------------------------------------------------------------
// JWT expiry decoding
// ---------------------------------------------------------------------------
describe("JWT decodeTokenExpiry", () => {
  it("decodes token exp claim", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeJwt(exp);
    const result = decodeTokenExpiry(token);
    expect(result).to.be.instanceOf(Date);
    expect(result!.getTime()).to.equal(exp * 1000);
  });

  it("returns null for tokens without exp", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "user" })).toString("base64url");
    expect(decodeTokenExpiry(`${header}.${payload}.sig`)).to.equal(null);
  });

  it("returns null for malformed tokens", () => {
    expect(decodeTokenExpiry("not-a-jwt")).to.equal(null);
    expect(decodeTokenExpiry("")).to.equal(null);
  });
});

// ---------------------------------------------------------------------------
// AuthProfile parse / dump
// ---------------------------------------------------------------------------
describe("AuthProfile", () => {
  it("parses reduced-format config lines", () => {
    const lines = [
      "TOKEN=abc123",
      "TOKEN_EXPIRES=2026-01-01T00:00:00.000Z",
      "AGENT_ID=agent-1",
      "BASE_URL=https://control.example.com",
      "BASE_DATA_URL=https://data.example.com",
      "REFRESH_TOKEN=rt-xyz",
      "REFRESH_TOKEN_ID=rti-1",
      "AUTH_SERVER_URL=https://auth.example.com",
      "AUTH_SERVER_CLIENT_ID=client-1",
    ];
    const profile = AuthProfile.parse("prod", lines);
    expect(profile.profile).to.equal("prod");
    expect(profile.token).to.equal("abc123");
    expect(profile.tokenExpires).to.equal("2026-01-01T00:00:00.000Z");
    expect(profile.agentId).to.equal("agent-1");
    expect(profile.controlBaseUrl).to.equal("https://control.example.com");
    expect(profile.dataBaseUrl).to.equal("https://data.example.com");
    expect(profile.refreshToken).to.equal("rt-xyz");
    expect(profile.refreshTokenId).to.equal("rti-1");
    expect(profile.authServerUrl).to.equal("https://auth.example.com");
    expect(profile.authServerClientId).to.equal("client-1");
  });

  it("dumps back to the same reduced format", () => {
    const profile = new AuthProfile({
      profile: "test",
      token: "tok",
      agentId: "a1",
      refreshToken: "rt",
    });
    const dumped = profile.dump();
    expect(dumped).to.include("TOKEN=tok");
    expect(dumped).to.include("AGENT_ID=a1");
    expect(dumped).to.include("REFRESH_TOKEN=rt");
    // Null fields should be absent
    expect(dumped).not.to.include("TOKEN_EXPIRES");
    expect(dumped).not.to.include("BASE_URL");
  });

  it("dumpBlock includes the [profile=...] header", () => {
    const profile = new AuthProfile({ profile: "dev", token: "t1" });
    const block = profile.dumpBlock();
    expect(block).to.match(/^\[profile=dev\]/);
    expect(block).to.include("TOKEN=t1");
  });
});

// ---------------------------------------------------------------------------
// buildAuth
// ---------------------------------------------------------------------------
describe("buildAuth", () => {
  it("returns provided auth as-is", () => {
    const auth = new CookieAuth();
    expect(buildAuth({ auth })).to.equal(auth);
  });

  it("throws when auth is combined with raw auth config", () => {
    const auth = new CookieAuth();
    expect(() => buildAuth({ auth, token: "tok" })).to.throw(
      DooverAuthError,
      /Cannot combine/,
    );
  });

  it("builds CookieAuth when no token-related input is present", () => {
    expect(buildAuth({})).to.be.instanceOf(CookieAuth);
  });

  it("builds a refresh-capable CookieAuth from authServerUrl alone", async () => {
    const fetchMock = createFetchMock(() => createJsonResponse({}));
    const auth = buildAuth({
      authServerUrl: "https://auth.example.com",
      fetchImpl: fetchMock as typeof fetch,
    });

    // authServerUrl says where to refresh; it is not token material, so this
    // stays cookie auth rather than becoming a tokenless DooverTokenAuth.
    expect(auth).to.be.instanceOf(CookieAuth);
    expect(await auth.handleUnauthorized()).to.equal(false); // no session cookie
  });

  it("still builds DooverTokenAuth when token material accompanies authServerUrl", () => {
    const auth = buildAuth({
      authServerUrl: "https://auth.example.com",
      refreshToken: "rt",
    });
    expect(auth).to.be.instanceOf(DooverTokenAuth);
  });

  it("builds DooverTokenAuth when token is provided", () => {
    const auth = buildAuth({ token: "tok" });
    expect(auth).to.be.instanceOf(DooverTokenAuth);
  });

  it("builds DooverTokenAuth from an AuthProfile with token", () => {
    const profile = new AuthProfile({ profile: "test", token: "t1" });
    const auth = buildAuth({ profile });
    expect(auth).to.be.instanceOf(DooverTokenAuth);
  });

  it("explicit raw fields override profile-loaded values", async () => {
    const profile = new AuthProfile({ profile: "test", token: "profile-tok" });
    const auth = buildAuth({ profile, token: "override-tok" });
    expect(auth).to.be.instanceOf(DooverTokenAuth);
    expect(await auth.getHttpHeaders()).to.deep.equal({
      Authorization: "Bearer override-tok",
    });
  });

  it("resolves a string profile via configManager", () => {
    const store = new MemoryProfileStore();
    store.create(new AuthProfile({ profile: "staging", token: "st" }));
    const auth = buildAuth({ profile: "staging", configManager: store });
    expect(auth).to.be.instanceOf(DooverTokenAuth);
  });

  it("throws when profile is a string without configManager", () => {
    expect(() => buildAuth({ profile: "staging" })).to.throw(
      DooverAuthError,
      /configManager/,
    );
  });

  it("throws when string profile is not found in configManager", () => {
    const store = new MemoryProfileStore();
    expect(() => buildAuth({ profile: "nope", configManager: store })).to.throw(
      DooverAuthError,
      /not found/,
    );
  });
});

// ---------------------------------------------------------------------------
// DooverClient shared auth instance
// ---------------------------------------------------------------------------
describe("DooverClient auth sharing", () => {
  beforeEach(() => {
    installSessionStorageMock();
    MockWebSocket.reset();
    Object.defineProperty(globalThis, "WebSocket", {
      value: MockWebSocket,
      configurable: true,
      writable: true,
    });
  });

  it("shares one auth instance across REST and gateway", () => {
    const client = new DooverClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      token: "shared-tok",
      fetchImpl: createFetchMock() as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    expect(client.auth).to.be.instanceOf(DooverTokenAuth);
    expect(client.rest.auth).to.equal(client.auth);
    // viewer's internal rest and gateway should also share the same auth
    expect(client.viewer.rest.auth).to.equal(client.auth);
  });

  it("defaults to CookieAuth when no auth inputs are provided", () => {
    const client = new DooverClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: createFetchMock() as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    expect(client.auth).to.be.instanceOf(CookieAuth);
  });
});

// ---------------------------------------------------------------------------
// GatewayClient auth integration
// ---------------------------------------------------------------------------
describe("GatewayClient auth integration", () => {
  beforeEach(() => {
    MockWebSocket.reset();
    Object.defineProperty(globalThis, "WebSocket", {
      value: MockWebSocket,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => sinon.restore());

  it("appends ?token= when using token auth without webSocketFactory", async () => {
    const auth = new DooverTokenAuth({ token: "gw-tok" });
    const gw = new GatewayClient(
      {
        dataRestUrl: "https://api.example.com",
        controlApiUrl: "https://control.example.com",
        dataWssUrl: "wss://ws.example.com",
        webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      },
      auth,
    );

    await gw.connect();
    const ws = MockWebSocket.instances[0];
    expect(ws.url).to.equal("wss://ws.example.com/?token=gw-tok");
  });

  it("uses webSocketFactory with Authorization header for token auth", async () => {
    const auth = new DooverTokenAuth({ token: "factory-tok" });
    let capturedHeaders: Record<string, string> | undefined;
    const factory = (opts: { url: string; headers?: Record<string, string> }) => {
      capturedHeaders = opts.headers;
      return new MockWebSocket(opts.url) as unknown as WebSocket;
    };

    const gw = new GatewayClient(
      {
        dataRestUrl: "https://api.example.com",
        controlApiUrl: "https://control.example.com",
        dataWssUrl: "wss://ws.example.com",
        webSocketFactory: factory,
      },
      auth,
    );

    await gw.connect();
    expect(capturedHeaders).to.deep.equal({
      Authorization: "Bearer factory-tok",
    });
    // URL should NOT have the token query param
    const ws = MockWebSocket.instances[0];
    expect(ws.url).to.equal("wss://ws.example.com");
  });

  it("cookie auth leaves websocket URL unchanged", async () => {
    const auth = new CookieAuth();
    const gw = new GatewayClient(
      {
        dataRestUrl: "https://api.example.com",
        controlApiUrl: "https://control.example.com",
        dataWssUrl: "wss://ws.example.com",
        webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      },
      auth,
    );

    await gw.connect();
    const ws = MockWebSocket.instances[0];
    expect(ws.url).to.equal("wss://ws.example.com");
  });

  it("reconnect uses newly refreshed token", async () => {
    let callCount = 0;
    const fetchMock = createFetchMock(() => {
      callCount++;
      return createJsonResponse({
        access_token: `refreshed-${callCount}`,
        expires_in: 3600,
      });
    });

    const auth = new DooverTokenAuth({
      token: null,
      refreshToken: "rt",
      authServerUrl: "https://auth.example.com",
      authServerClientId: "c1",
      fetchImpl: fetchMock as typeof fetch,
    });

    const gw = new GatewayClient(
      {
        dataRestUrl: "https://api.example.com",
        controlApiUrl: "https://control.example.com",
        dataWssUrl: "wss://ws.example.com",
        webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      },
      auth,
    );

    await gw.connect();
    const ws1 = MockWebSocket.instances[0];
    expect(ws1.url).to.include("token=refreshed-1");

    // Simulate disconnect + reconnect
    gw.disconnect();
    // Clear the token to force a re-refresh
    auth.setToken(null);
    await gw.connect();
    const ws2 = MockWebSocket.instances[1];
    expect(ws2.url).to.include("token=refreshed-2");
  });
});

// ---------------------------------------------------------------------------
// RestClient auth integration
// ---------------------------------------------------------------------------
describe("RestClient auth integration", () => {
  beforeEach(() => installSessionStorageMock());

  it("sends Authorization header with token auth", async () => {
    const auth = new DooverTokenAuth({ token: "rest-tok" });
    const fetchMock = createFetchMock();
    const client = new RestClient(
      {
        dataRestUrl: "https://api.example.com",
        controlApiUrl: "https://control.example.com",
        dataWssUrl: "wss://ws.example.com",
        fetchImpl: fetchMock as typeof fetch,
      },
      auth,
    );

    await client.get("/items");

    const [, init] = fetchMock.getCall(0).args;
    const headers = init?.headers as Headers;
    expect(headers.get("Authorization")).to.equal("Bearer rest-tok");
    expect(init?.credentials).to.equal("omit");
  });

  it("uses credentials: include with cookie auth", async () => {
    const auth = new CookieAuth();
    const fetchMock = createFetchMock();
    const client = new RestClient(
      {
        dataRestUrl: "https://api.example.com",
        controlApiUrl: "https://control.example.com",
        dataWssUrl: "wss://ws.example.com",
        fetchImpl: fetchMock as typeof fetch,
      },
      auth,
    );

    await client.get("/items");

    const [, init] = fetchMock.getCall(0).args;
    const headers = init?.headers as Headers;
    expect(headers.get("Authorization")).to.equal(null);
    expect(init?.credentials).to.equal("include");
  });

  it("refreshes and replays a 401 with refresh-capable cookie auth", async () => {
    let itemsCalls = 0;
    const fetchMock = createFetchMock((url) => {
      if (url === "https://auth.example.com/app/refresh/") {
        return createJsonResponse({});
      }
      itemsCalls += 1;
      // First attempt uses the dead cookie; the replay succeeds.
      return itemsCalls === 1
        ? createJsonResponse({ detail: "expired" }, { status: 401 })
        : createJsonResponse({ items: [] });
    });
    const auth = cookieAuth({ cookie: expiryCookie(-60), fetchMock });

    const client = new RestClient(
      {
        dataRestUrl: "https://api.example.com",
        controlApiUrl: "https://control.example.com",
        dataWssUrl: "wss://ws.example.com",
        fetchImpl: fetchMock as typeof fetch,
      },
      auth,
    );

    const result = await client.get("/items");

    expect(result).to.deep.equal({ items: [] });
    expect(itemsCalls).to.equal(2);
  });

  it("surfaces the 401 when cookie auth cannot refresh", async () => {
    const fetchMock = createFetchMock(() =>
      createJsonResponse({ detail: "expired" }, { status: 401 }),
    );
    const client = new RestClient(
      {
        dataRestUrl: "https://api.example.com",
        controlApiUrl: "https://control.example.com",
        dataWssUrl: "wss://ws.example.com",
        fetchImpl: fetchMock as typeof fetch,
      },
      new CookieAuth(),
    );

    await expect(client.get("/items")).to.be.rejected;
  });

  it("uses credentials: include when no auth is provided (backward compat)", async () => {
    const fetchMock = createFetchMock();
    const client = new RestClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
    });

    await client.get("/items");

    const [, init] = fetchMock.getCall(0).args;
    expect(init?.credentials).to.equal("include");
  });
});
