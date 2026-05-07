import type { RestClient } from "../http/rest-client";
import type { User } from "../types/viewer";

export class UsersApi {
  constructor(
    private readonly rest: RestClient,
    private readonly controlApiUrl?: string,
  ) {}

  getMe(): Promise<User> {
    return this.rest.get<User>("/users/me", undefined, this.controlApiUrl);
  }
}
