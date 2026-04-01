import type { RestClient } from "../http/rest-client";
import type { TurnCredential, TurnTokenRequest } from "../types/openapi";

export class TurnApi {
  constructor(private readonly rest: RestClient) {}

  createTurnToken(body: TurnTokenRequest) {
    return this.rest.post<TurnCredential>("/turn/token", body);
  }
}
