import { randomUUID } from "node:crypto";
import { object, RexError, string } from "./control.ts";

export interface ViewNode {
  id: string;
  kind: "text" | "tool";
  role?: string;
  text?: string;
  thinking?: boolean;
  name?: string;
  label?: string;
  status?: "running" | "success" | "error" | "unknown";
  parentId?: string;
}
export interface ViewDialog {
  id: string;
  kind: "confirm" | "select" | "input" | "editor";
  title: string;
  message?: string;
  options?: string[];
  prefill?: string;
}
export interface ViewState {
  generation: string;
  revision: number;
  sessionId: string;
  name: string;
  busy: boolean;
  nodes: ViewNode[];
  before?: string;
  dialogs: ViewDialog[];
  customUI: boolean;
  notice?: string;
}
export interface ViewDetail { args: unknown; content: unknown; details?: unknown; unavailable?: boolean }
export const bridgeLabel = (pid: number) => `pi-rex:${pid}`;
export interface ReadPage { id: string; text: string; next: number | null }

export class ViewReads {
  private reads = new Map<string, { id: string; text: string }>();
  read(readKey: string, args: Record<string, unknown>, value: () => unknown): ReadPage {
    let read = this.reads.get(readKey);
    let offset = 0;
    if (args.readId === undefined) {
      read = { id: randomUUID(), text: JSON.stringify(value()) };
      this.reads.set(readKey, read);
    } else {
      if (!read || read.id !== string(args.readId)) throw new RexError("conflict", "View read expired; fetch a fresh snapshot");
      offset = Number(args.offset);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > read.text.length) throw new Error("Invalid view read offset");
    }
    const end = Math.min(read.text.length, offset + 8000);
    if (end === read.text.length) this.reads.delete(readKey);
    return { id: read.id, text: read.text.slice(offset, end), next: end < read.text.length ? end : null };
  }
  clear() { this.reads.clear(); }
}

export async function readView<T>(request: (args: Record<string, unknown>) => Promise<ReadPage>, args: Record<string, unknown>): Promise<T> {
  let page = await request(args);
  let text = string(page.text);
  const id = string(page.id);
  let previous = 0;
  while (page.next !== null) {
    const offset = page.next;
    if (!Number.isSafeInteger(offset) || offset <= previous) throw new Error("Invalid view page cursor");
    page = await request({ ...args, readId: id, offset });
    if (page.id !== id) throw new Error("View changed during read");
    text += string(page.text);
    previous = offset;
  }
  return JSON.parse(text) as T;
}

export class ViewCommands {
  private outcomes = new Map<string, { fingerprint: string; result: Promise<unknown> }>();
  execute(args: Record<string, unknown>, run: () => unknown): Promise<unknown> {
    const id = string(args.id);
    if (!id || id.length > 128) throw new Error("Invalid command ID");
    const fingerprint = JSON.stringify(args);
    const previous = this.outcomes.get(id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new RexError("conflict", "Command ID already used for different input");
      return previous.result;
    }
    const result = Promise.resolve().then(run);
    this.outcomes.set(id, { fingerprint, result });
    return result;
  }
}

export function parseView(value: unknown): ViewState {
  const state = object(value);
  string(state.generation);
  string(state.sessionId);
  string(state.name);
  if (!Number.isSafeInteger(state.revision) || Number(state.revision) < 0 || typeof state.customUI !== "boolean") throw new Error("Invalid Pi view metadata");
  if (state.before !== undefined) string(state.before);
  if (state.notice !== undefined) string(state.notice);
  if (!Array.isArray(state.nodes) || !Array.isArray(state.dialogs) || typeof state.busy !== "boolean") throw new Error("Invalid Pi view");
  for (const node of state.nodes) {
    const item = object(node);
    string(item.id);
    if (item.kind !== "text" && item.kind !== "tool") throw new Error("Invalid Pi view item");
  }
  for (const dialog of state.dialogs) {
    const item = object(dialog);
    string(item.id);
    string(item.title);
    if (!["confirm", "select", "input", "editor"].includes(string(item.kind))) throw new Error("Invalid Pi dialog");
  }
  return state as unknown as ViewState;
}
