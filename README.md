# doover-js

TypeScript client for Doover.

## Exports

### Root (`doover-js`)

- `DooverClient`
- `DooverDataProvider`
- `GatewayClient`
- `RestClient`
- `DooverAuth`, `CookieAuth`, `DooverTokenAuth`
- `AuthProfile`, `DooverAuthError`
- `buildAuth`
- `AgentsApi`, `ChannelsApi`, `MessagesApi`, `AggregatesApi`, `AlarmsApi`, `ConnectionsApi`, `NotificationsApi`, `PermissionsApi`, `ProcessorsApi`, `TurnApi`

### Node subpath (`doover-js/node`)

- `ConfigManager` — file-backed profile store (Node-only, uses `fs`)

## Usage

### Cookie-only browser usage (default)

When no auth inputs are provided, the client uses ambient cookies (`credentials: "include"`). This is the default browser behaviour and matches the original API.

```ts
import { DooverClient } from "doover-js";

const client = new DooverClient({
  dataRestUrl: "https://example.com/api",
  controlApiUrl: "https://example.com/control",
  dataWssUrl: "wss://example.com/gateway",
});

const channels = await client.viewer.getChannels({ agentId: "123" });
```

### Explicit token usage

Pass a token directly to use bearer auth. The client will send `Authorization: Bearer <token>` on every HTTP request and use `credentials: "omit"`.

```ts
import { DooverClient } from "doover-js";

const client = new DooverClient({
  dataRestUrl: "https://example.com/api",
  controlApiUrl: "https://example.com/control",
  dataWssUrl: "wss://example.com/gateway",
  token: "your-access-token",
  refreshToken: "your-refresh-token",
  authServerUrl: "https://auth.example.com",
  authServerClientId: "your-client-id",
});

// Token refresh happens automatically when the token expires
const me = await client.rest.get("/users/me", undefined, client.rest.config.controlApiUrl);
```

### Profile / ConfigManager usage (Node)

Use the `ConfigManager` from the `doover-js/node` subpath to load profiles from `~/.doover/config`, matching pydoover's config format.

```ts
import { DooverClient } from "doover-js";
import { ConfigManager } from "doover-js/node";

const configManager = new ConfigManager(); // reads ~/.doover/config
const client = new DooverClient({
  dataRestUrl: "https://example.com/api",
  controlApiUrl: "https://example.com/control",
  dataWssUrl: "wss://example.com/gateway",
  profile: "production",
  configManager,
});
```

You can also pass an `AuthProfile` instance directly:

```ts
import { DooverClient, AuthProfile } from "doover-js";

const profile = new AuthProfile({
  profile: "custom",
  token: "my-token",
  refreshToken: "my-refresh-token",
  authServerUrl: "https://auth.example.com",
  authServerClientId: "client-id",
});

const client = new DooverClient({
  dataRestUrl: "https://example.com/api",
  controlApiUrl: "https://example.com/control",
  dataWssUrl: "wss://example.com/gateway",
  profile,
});
```

### WebSocket auth behaviour

The auth layer automatically handles websocket authentication:

- **Cookie auth**: Uses the original websocket URL and relies on ambient cookies.
- **Token auth with `webSocketFactory`**: Passes `Authorization: Bearer <token>` via headers.
- **Token auth with standard `WebSocket`**: Appends `?token=<token>` to the websocket URL.

For Node.js websocket clients that support custom headers, provide a `webSocketFactory`:

```ts
import WebSocket from "ws";
import { DooverClient } from "doover-js";

const client = new DooverClient({
  dataRestUrl: "https://example.com/api",
  controlApiUrl: "https://example.com/control",
  dataWssUrl: "wss://example.com/gateway",
  token: "your-token",
  webSocketFactory: ({ url, headers }) => new WebSocket(url, { headers }),
});
```

Reconnections automatically use the latest (potentially refreshed) token.

## Architecture

`DooverClient` builds one shared `DooverAuth` instance and injects it into `RestClient`, `DooverDataProvider`, and `GatewayClient`. Token refreshes propagate everywhere automatically.

`DooverDataProvider` preserves the older viewer-oriented interface. `DooverClient` exposes the broader API surface through subclients.
