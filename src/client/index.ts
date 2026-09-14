export { DooverClient } from "./doover-client.js";
export { getDooverClient, peekDooverClient, resetDooverClient } from "./singleton.js";
export type { DooverClientConfig } from "../http/rest-client.js";
export type * from "./data-client.js";

export { browserNetworkStatus, createNetworkStatusStore } from "./network-status.js";
export type { NetworkStatusSource, NetworkStatusSnapshot } from "./network-status.js";

export type { ServiceReachability, ServiceReachabilitySource, ReachabilityOptions } from "./service-reachability.js";
