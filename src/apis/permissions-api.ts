import type { RestClient } from "../http/rest-client";
import type {
  AgentPermission,
  PermissionDebugResponse,
  SuccessListResponse,
  SyncPermissionRequest,
} from "../types/openapi";
import { resolveAgentArgs } from "./_args";

export class PermissionsApi {
  constructor(private readonly rest: RestClient) {}

  getAgentPermission(agentId: string): Promise<AgentPermission>;
  getAgentPermission(identifier: { agentId: string }): Promise<AgentPermission>;
  getAgentPermission(...args: unknown[]): Promise<AgentPermission> {
    const { agentId } = resolveAgentArgs<undefined>(args);
    return this._getAgentPermission(agentId);
  }
  private _getAgentPermission(agentId: string) {
    return this.rest.get<AgentPermission>(`/agents/${agentId}/permissions`);
  }

  getAgentPermissionDebug(agentId: string): Promise<PermissionDebugResponse>;
  getAgentPermissionDebug(identifier: { agentId: string }): Promise<PermissionDebugResponse>;
  getAgentPermissionDebug(...args: unknown[]): Promise<PermissionDebugResponse> {
    const { agentId } = resolveAgentArgs<undefined>(args);
    return this._getAgentPermissionDebug(agentId);
  }
  private _getAgentPermissionDebug(agentId: string) {
    return this.rest.get<PermissionDebugResponse>(
      `/agents/${agentId}/permissions/debug`,
    );
  }

  syncPermissions(body: SyncPermissionRequest) {
    return this.rest.post<SuccessListResponse>("/permissions/sync", body);
  }
}
