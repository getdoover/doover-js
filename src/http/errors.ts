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
