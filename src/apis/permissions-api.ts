import type { RestClient } from "../http/rest-client";
import type {
  AgentPermission,
  PermissionDebugResponse,
  SuccessListResponse,
  SyncPermissionRequest,
} from "../types/openapi";

export class PermissionsApi {
  constructor(private readonly rest: RestClient) {}

  getAgentPermission(agentId: string) {
    return this.rest.get<AgentPermission>(`/agents/${agentId}/permissions`);
  }

  getAgentPermissionDebug(agentId: string) {
    return this.rest.get<PermissionDebugResponse>(
      `/agents/${agentId}/permissions/debug`,
    );
  }

  syncPermissions(body: SyncPermissionRequest) {
    return this.rest.post<SuccessListResponse>("/permissions/sync", body);
  }
}
