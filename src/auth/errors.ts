export class DooverAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DooverAuthError";
  }
}
