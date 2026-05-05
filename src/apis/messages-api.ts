import type { RestClient } from "../http/rest-client";
import type {
  CreateMessageRequest,
  DataSeries,
  MessageStructure,
  UpdateMessageRequest,
} from "../types/openapi";
import { addTimestampToMessage } from "../utils/snowflake";

export interface ListMessagesParams {
  before?: string;
  after?: string;
  limit?: number;
  field_name?: string[];
}

export interface MessageMutationParams {
  suppress_response?: boolean;
  clear_attachments?: boolean;
}

export type MessageBody = CreateMessageRequest | UpdateMessageRequest | FormData;

export class MessagesApi {
  constructor(private readonly rest: RestClient) {}

  async listMessages(
    agentId: string,
    channelName: string,
    params?: ListMessagesParams,
  ) {
    const response = await this.rest.get<Array<Omit<MessageStructure, "timestamp">>>(
      `/agents/${agentId}/channels/${channelName}/messages`,
      params,
    );
    return response.map(addTimestampToMessage);
  }

  async postMessage(agentId: string, channelName: string, body: MessageBody) {
    const response = await this.rest.post<Omit<MessageStructure, "timestamp">>(
      `/agents/${agentId}/channels/${channelName}/messages`,
      body,
    );
    return addTimestampToMessage(response);
  }

  getTimeseries(agentId: string, channelName: string, params: ListMessagesParams) {
    return this.rest.get<DataSeries>(
      `/agents/${agentId}/channels/${channelName}/messages/timeseries`,
      params,
    );
  }

  async getMessage(agentId: string, channelName: string, messageId: string) {
    const response = await this.rest.get<Omit<MessageStructure, "timestamp">>(
      `/agents/${agentId}/channels/${channelName}/messages/${messageId}`,
    );
    return addTimestampToMessage(response);
  }

  putMessage(
    agentId: string,
    channelName: string,
    messageId: string,
    body: MessageBody,
    params?: MessageMutationParams,
  ) {
    return this.rest.put<unknown>(
      `/agents/${agentId}/channels/${channelName}/messages/${messageId}`,
      body,
      params,
    );
  }

  patchMessage(
    agentId: string,
    channelName: string,
    messageId: string,
    body: MessageBody,
    params?: MessageMutationParams,
  ) {
    return this.rest.patch<unknown>(
      `/agents/${agentId}/channels/${channelName}/messages/${messageId}`,
      body,
      params,
    );
  }

  deleteMessage(agentId: string, channelName: string, messageId: string) {
    return this.rest.delete<unknown>(
      `/agents/${agentId}/channels/${channelName}/messages/${messageId}`,
    );
  }

  getMessageAttachment(
    agentId: string,
    channelName: string,
    messageId: string,
    attachmentId: string,
  ) {
    return this.rest.get<Blob>(
      `/agents/${agentId}/channels/${channelName}/messages/${messageId}/attachments/${attachmentId}`,
    );
  }

  getInvocationLogs<TLog = unknown>(
    agentId: string,
    channelName: string,
    messageId: string,
  ) {
    return this.rest.get<TLog[]>(
      `/agents/${agentId}/channels/${channelName}/messages/${messageId}/logs`,
    );
  }

  createMultipartPayload(
    jsonPayload: Record<string, unknown>,
    attachments: Array<Blob | File>,
  ) {
    const formData = new FormData();
    formData.set("json_payload", JSON.stringify(jsonPayload));
    attachments.forEach((attachment, index) => {
      formData.set(`attachment-${index}`, attachment);
    });
    return formData;
  }
}
