/**
 * One capability per distinct endpoint-or-ability across the full `DataClient`
 * surface. A backend advertises exactly what it can do; callers gate calls on
 * these and an unsupported call throws `UnsupportedCapabilityError`.
 *
 * String-literal union (not a TS enum) so values serialise cleanly and can
 * appear in error messages / debug UIs verbatim.
 */
export type Capability =
  // agents
  | "agents.list"
  | "agents.multiAgentMessages"
  | "agents.multiAgentAggregates"
  // channels
  | "channels.list"
  | "channels.get"
  | "channels.create" // covers createChannel + putChannel
  | "channels.archive" // covers archive + unarchive
  | "channels.dataSeries" // listDataSeries
  // aggregates
  | "aggregates.get"
  | "aggregates.put"
  | "aggregates.patch"
  | "aggregates.attachment"
  // messages
  | "messages.list" // list recent / windowed-by-cursor (latest N)
  | "messages.listHistorical" // pagination beyond the live buffer (deep history)
  | "messages.get"
  | "messages.post"
  | "messages.put" // covers putMessage + patchMessage
  | "messages.delete"
  | "messages.attachment"
  | "messages.timeseries" // getTimeseries
  | "messages.invocationLogs" // getInvocationLogs
  // gateway / realtime
  | "gateway.subscribe" // can open a subscription channel at all
  | "gateway.realtime" // pushes live message/aggregate updates over that subscription
  | "gateway.oneShot" // sendOneShotMessage
  // rpc
  | "rpc.send"
  // alarms / connections / notifications / permissions / processors / turn / users
  | "alarms.read" // listAlarms, getAlarm
  | "alarms.write" // createAlarm, putAlarm, patchAlarm, deleteAlarm
  | "connections.read" // all ConnectionsApi reads
  | "connections.write" // syncConnection
  | "notifications.read" // all NotificationsApi reads + getWebPushPublicKey
  | "notifications.write" // all NotificationsApi mutations
  | "permissions.read" // getAgentPermission, getAgentPermissionDebug
  | "permissions.write" // syncPermissions
  | "processors.read" // getScheduleInfo*, getProcessorSubscriptionInfo*
  | "processors.write" // all ProcessorsApi mutations + invokeIngestionEndpoint
  | "turn.credentials" // createTurnToken
  | "users.me"; // getMe

export const ALL_CAPABILITIES: readonly Capability[] = [
  "agents.list",
  "agents.multiAgentMessages",
  "agents.multiAgentAggregates",
  "channels.list",
  "channels.get",
  "channels.create",
  "channels.archive",
  "channels.dataSeries",
  "aggregates.get",
  "aggregates.put",
  "aggregates.patch",
  "aggregates.attachment",
  "messages.list",
  "messages.listHistorical",
  "messages.get",
  "messages.post",
  "messages.put",
  "messages.delete",
  "messages.attachment",
  "messages.timeseries",
  "messages.invocationLogs",
  "gateway.subscribe",
  "gateway.realtime",
  "gateway.oneShot",
  "rpc.send",
  "alarms.read",
  "alarms.write",
  "connections.read",
  "connections.write",
  "notifications.read",
  "notifications.write",
  "permissions.read",
  "permissions.write",
  "processors.read",
  "processors.write",
  "turn.credentials",
  "users.me",
] as const;
