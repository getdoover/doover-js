import sinon from "sinon";

export function createJsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export function createTextResponse(body: string, init?: ResponseInit) {
  return new Response(body, {
    status: init?.status ?? 200,
    headers: init?.headers,
  });
}

export function createBlobResponse(body: string, init?: ResponseInit) {
  return new Response(new Blob([body]), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/octet-stream",
      ...(init?.headers ?? {}),
    },
  });
}

export function createFetchMock(responseFactory?: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return sinon.stub().callsFake(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (responseFactory) {
      return responseFactory(url, init);
    }
    return createJsonResponse({ ok: true });
  });
}

class StorageMock implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

export function installSessionStorageMock() {
  Object.defineProperty(globalThis, "sessionStorage", {
    value: new StorageMock(),
    configurable: true,
    writable: true,
  });
}

type MessageHandler = ((event: MessageEvent<string>) => void) | null;
type CloseHandler = ((event: CloseEvent) => void) | null;
type OpenHandler = (() => void) | null;
type ErrorHandler = ((event: Event) => void) | null;

export class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onmessage: MessageHandler = null;
  onclose: CloseHandler = null;
  onopen: OpenHandler = null;
  onerror: ErrorHandler = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: code ?? 1000, reason: reason ?? "" } as CloseEvent);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  receive(payload: unknown) {
    this.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify(payload),
      }),
    );
  }

  error() {
    this.onerror?.(new Event("error"));
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}
