import type { RpcRequest, RpcStatus } from "../types/common";

export class DooverRpcError extends Error {
  readonly status: RpcStatus<unknown> & { code: "error" };
  readonly request: RpcRequest;

  constructor(
    status: RpcStatus<unknown> & { code: "error" },
    request: RpcRequest,
  ) {
    const text =
      typeof status.message === "string"
        ? status.message
        : (() => {
            try {
              return JSON.stringify(status.message);
            } catch {
              return "Unknown RPC error";
            }
          })();
    super(text);
    this.name = "DooverRpcError";
    this.status = status;
    this.request = request;
    Object.setPrototypeOf(this, DooverRpcError.prototype);
  }
}
