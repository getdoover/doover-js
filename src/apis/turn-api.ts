import type { RestClient } from "../http/rest-client.js";
import type { TurnCredential, TurnTokenRequest } from "../types/openapi.js";

export class TurnApi {
  constructor(private readonly rest: RestClient) {}

  createTurnToken(body: TurnTokenRequest) {
    return this.rest.post<TurnCredential>("/turn/token", body);
  }
}
