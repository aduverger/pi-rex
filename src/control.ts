import { execFile } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";
import type { RexContext } from "./rex.ts";

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}

export function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a string");
  return value;
}

export class RexError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export interface PerformRequest {
  action: string;
  args: unknown;
  requester: { client_id: string; principal?: { kind?: string; uid?: number; pid?: number } };
}

export async function rexEndpoint(context: RexContext): Promise<string> {
  if (context.server) return context.server;
  const { stdout } = await promisify(execFile)(context.command, ["--autostart=false", "--timeout", "2s", "server", "status", "--json"], { timeout: 2500 });
  return string(object(JSON.parse(stdout)).endpoint);
}

export class RexControl {
  private socket?: WebSocket;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private sequence = 0;
  readonly events = new Set<(event: Record<string, unknown>) => void>();
  onPerform?: (request: PerformRequest) => unknown | Promise<unknown>;
  onClose?: () => void;
  id = "";
  limit = 65536;

  async connect(endpoint: string, label: string, info: { kind?: string; platform?: string } = {}): Promise<void> {
    const url = new URL(endpoint);
    let address: string;
    if (url.protocol === "unix:") {
      const path = decodeURIComponent(url.pathname);
      if (path.includes(":")) throw new Error("Rex Unix socket paths containing ':' are not supported");
      address = `ws+unix://${path}:/api/control`;
    } else {
      throw new Error("The Pi viewer requires the existing local Rex Unix socket");
    }
    const socket = new WebSocket(address, "rex.control.v1", { perMessageDeflate: false, maxPayload: 1024 * 1024, handshakeTimeout: 2500 });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error("Rex handshake timed out")); socket.terminate(); }, 4000);
      socket.on("open", () => socket.send(JSON.stringify({ type: "hello", api_revision: 7, api_min_revision: 7,
        client: { kind: "agent", name: "pi-rex", platform: process.platform === "darwin" ? "macos" : process.platform, label, ...info } })));
      socket.on("message", (bytes) => {
        try {
          const message = object(JSON.parse(bytes.toString()));
          if (message.type === "welcome") {
            if (message.protocol !== "rex.control.v1" || message.api_revision !== 7) throw new Error("Rex control API revision 7 is required");
            this.id = string(object(message.client).id);
            this.limit = Math.min(1024 * 1024, Number(object(message.limits).max_message_bytes));
            if (!Number.isSafeInteger(this.limit) || this.limit < 65536) throw new Error("Invalid Rex message limit");
            clearTimeout(timer);
            resolve();
          } else if (message.type === "response") {
            const pending = this.pending.get(string(message.id));
            if (!pending) return;
            this.pending.delete(string(message.id));
            clearTimeout(pending.timer);
            if (message.error) {
              const error = object(message.error);
              pending.reject(new RexError(string(error.code), string(error.message)));
            } else pending.resolve(message.payload);
          } else if (message.type === "event") {
            const event = object(message.payload);
            if (event.type === "client_perform_requested") void this.perform(object(event.payload));
            else for (const listener of this.events) listener(event);
          }
        } catch (error) {
          clearTimeout(timer);
          reject(error);
          socket.terminate();
        }
      });
      socket.on("error", (error) => { clearTimeout(timer); reject(error); });
      socket.on("close", () => {
        clearTimeout(timer);
        reject(new Error("Rex disconnected during handshake"));
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error("Rex disconnected; request outcome may be uncertain"));
        }
        this.pending.clear();
        this.onClose?.();
      });
    });
  }

  request<T = unknown>(method: string, payload: unknown = {}): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.id) return Promise.reject(new Error("Rex is not connected"));
    const id = String(++this.sequence);
    const body = JSON.stringify({ type: "request", id, method, payload });
    if (Buffer.byteLength(body) > this.limit - 2048) return Promise.reject(new RexError("too_large", "Rex request exceeds the negotiated message limit"));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new RexError("timeout", "Rex request timed out; outcome may be uncertain")); }, 12000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      socket.send(body, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async performClient<T = unknown>(client: string, action: string, args: unknown = {}): Promise<T> {
    const response = await this.request<{ result: T }>("client.perform", { client_id: client, action, args, timeout_ms: 10000 });
    return response.result;
  }

  private async perform(payload: Record<string, unknown>) {
    try {
      if (!this.onPerform) throw new RexError("not_supported", "No Pi action handler");
      const result = await this.onPerform({ action: string(payload.action), args: payload.args ?? {}, requester: object(payload.requester) as unknown as PerformRequest["requester"] });
      await this.request("client.reply", { call_id: string(payload.call_id), result: result ?? null });
    } catch (error) {
      try {
        await this.request("client.reply", { call_id: payload.call_id, error: { code: error instanceof RexError ? error.code : "refused", message: error instanceof Error ? error.message : "Pi action failed" } });
      } catch { /* A disconnected caller cannot receive a reply. */ }
    }
  }

  close() {
    this.onClose = undefined;
    this.socket?.close();
  }
}
