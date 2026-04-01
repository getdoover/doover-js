import type { RestClient } from "../http/rest-client";
import type {
  CreateEndpointRequest,
  CreateNotificationSubscriptionRequest,
  NotificationDataResponse,
  NotificationEndpoint,
  NotificationEndpointsResponse,
  NotificationSubscribersResponse,
  NotificationSubscriptionCreateResponse,
  NotificationSubscriptionsResponse,
  UpdateEndpointRequest,
  UpdateMeWebPushEndpointRequest,
  UpdateNotificationSubscriptionRequest,
} from "../types/openapi";

export class NotificationsApi {
  constructor(private readonly rest: RestClient) {}

  getAgentNotifications(agentId: string) {
    return this.rest.get<NotificationDataResponse>(`/agents/${agentId}/notifications`);
  }

  getAgentNotificationEndpoints(agentId: string, name?: string) {
    return this.rest.get<NotificationEndpointsResponse>(
      `/agents/${agentId}/notifications/endpoints`,
      { name },
    );
  }

  createNotificationEndpoint(agentId: string, body: CreateEndpointRequest) {
    return this.rest.post<NotificationEndpoint>(
      `/agents/${agentId}/notifications/endpoints`,
      body,
    );
  }

  updateNotificationEndpoint(
    agentId: string,
    endpointId: string,
    body: UpdateEndpointRequest,
  ) {
    return this.rest.patch<NotificationEndpoint>(
      `/agents/${agentId}/notifications/endpoints/${endpointId}`,
      body,
    );
  }

  deleteNotificationEndpoint(agentId: string, endpointId: string) {
    return this.rest.delete<unknown>(
      `/agents/${agentId}/notifications/endpoints/${endpointId}`,
    );
  }

  testNotificationEndpoint(agentId: string, endpointId: string) {
    return this.rest.post<unknown>(
      `/agents/${agentId}/notifications/endpoints/${endpointId}/test`,
      {},
    );
  }

  getAgentNotificationSubscriptions(agentId: string, subscribed_to?: string) {
    return this.rest.get<NotificationSubscriptionsResponse>(
      `/agents/${agentId}/notifications/subscriptions`,
      { subscribed_to },
    );
  }

  createNotificationSubscription(
    agentId: string,
    body: CreateNotificationSubscriptionRequest,
  ) {
    return this.rest.post<NotificationSubscriptionCreateResponse>(
      `/agents/${agentId}/notifications/subscriptions`,
      body,
    );
  }

  getAgentDefaultNotificationSubscriptions(agentId: string, subscribed_to?: string) {
    return this.rest.get<NotificationSubscriptionsResponse>(
      `/agents/${agentId}/notifications/subscriptions/default`,
      { subscribed_to },
    );
  }

  deleteDefaultNotificationSubscription(agentId: string, subscribedTo: string) {
    return this.rest.delete<unknown>(
      `/agents/${agentId}/notifications/subscriptions/default/${subscribedTo}`,
    );
  }

  updateNotificationSubscription(
    agentId: string,
    subscriptionId: string,
    body: UpdateNotificationSubscriptionRequest,
  ) {
    return this.rest.patch<unknown>(
      `/agents/${agentId}/notifications/subscriptions/${subscriptionId}`,
      body,
    );
  }

  deleteNotificationSubscription(agentId: string, subscriptionId: string) {
    return this.rest.delete<unknown>(
      `/agents/${agentId}/notifications/subscriptions/${subscriptionId}`,
    );
  }

  getAgentNotificationSubscribers(agentId: string) {
    return this.rest.get<NotificationSubscribersResponse>(
      `/agents/${agentId}/notifications/subscribers`,
    );
  }

  updateMeWebPushEndpoint(body: UpdateMeWebPushEndpointRequest) {
    return this.rest.post<unknown>(
      "/agents/me/notifications/update_web_push",
      body,
    );
  }

  getWebPushPublicKey() {
    return this.rest.get<{ key: string }>("/notifications/webpush-public-key");
  }
}
