# doover-js

TypeScript client for Doover.

## Exports

- `DooverClient`
- `DooverDataProvider`
- `GatewayClient`
- `AgentsApi`
- `ChannelsApi`
- `MessagesApi`
- `AggregatesApi`
- `AlarmsApi`
- `ConnectionsApi`
- `NotificationsApi`
- `PermissionsApi`
- `ProcessorsApi`
- `TurnApi`

## Usage

```ts
import { DooverClient } from "doover-js";

const client = new DooverClient({
  dataRestUrl: "https://example.com/api",
  controlApiUrl: "https://example.com/control",
  dataWssUrl: "wss://example.com/gateway",
});

const channels = await client.viewer.getChannels({ agentId: "123" });
```

`DooverDataProvider` preserves the older viewer-oriented interface. `DooverClient` exposes the broader API surface through subclients.
