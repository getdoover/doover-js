export class DooverApiError extends Error {
  status: number;
  body: unknown;
  url: string;
  method: string;

  constructor(params: {
    status: number;
    body: unknown;
    url: string;
    method: string;
    message?: string;
  }) {
    super(params.message ?? `Request failed with status ${params.status}`);
    this.name = "DooverApiError";
    this.status = params.status;
    this.body = params.body;
    this.url = params.url;
    this.method = params.method;
  }
}

export class DooverMfaRequiredError extends DooverApiError {
  constructor(params: ConstructorParameters<typeof DooverApiError>[0]) {
    super(params);
    this.name = "DooverMfaRequiredError";
  }
}

export function isMfaRequiredBody(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { code?: unknown }).code === "mfa_required"
  );
}

export class DooverValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DooverValidationError";
  }
}

export class DooverGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DooverGatewayError";
  }
}
