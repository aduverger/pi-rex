import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ViewDetail, ViewNode } from "./view-state.ts";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
function content(value: unknown): Record<string, unknown>[] {
  if (typeof value === "string") return [{ type: "text", text: value }];
  return Array.isArray(value) ? value.map(record) : [];
}
interface Tool {
  id: string;
  name: string;
  args: unknown;
  content: unknown;
  details?: unknown;
  status: NonNullable<ViewNode["status"]>;
  parentId?: string;
  unavailable?: boolean;
}

export class ConversationView {
  private live?: { id: string; message: unknown };
  private tools = new Map<string, Tool>();
  private details = new Map<string, ViewDetail>();

  updateMessage(message: unknown, id: string) {
    if (record(message).role === "assistant") this.live = { id, message };
  }
  endMessage() { this.live = undefined; }
  updateTool(event: { toolCallId: string; toolName: string; args?: unknown; parentToolCallId?: string; partialResult?: unknown; result?: unknown; isError?: boolean }) {
    const previous = this.tools.get(event.toolCallId);
    const result = record(event.result ?? event.partialResult);
    this.tools.set(event.toolCallId, { id: event.toolCallId, name: event.toolName, args: event.args ?? previous?.args,
      parentId: event.parentToolCallId ?? previous?.parentId, content: result.content ?? [], details: result.details,
      status: event.result ? (event.isError ? "error" : "success") : "running" });
  }

  project(ctx: Pick<ExtensionContext, "sessionManager">, before?: string): { nodes: ViewNode[]; before?: string } {
    const entries = ctx.sessionManager.getBranch();
    let end = entries.length;
    if (before) {
      end = entries.findIndex((entry) => entry.id === before);
      if (end < 0) throw new Error("History changed; refresh the viewer");
    }
    const start = Math.max(0, end - 50);
    const tools = new Map<string, Tool>();
    const persisted = new Set<string>();
    for (const entry of entries) {
      const message = record(record(entry).message);
      for (const block of content(message.content)) {
        if (block.type !== "toolCall" || typeof block.id !== "string") continue;
        persisted.add(block.id);
        tools.set(block.id, { id: block.id, name: String(block.name ?? "tool"), args: block.arguments, content: [], status: "unknown", unavailable: true });
      }
      if (message.role === "toolResult" && typeof message.toolCallId === "string") {
        const call = tools.get(message.toolCallId);
        tools.set(message.toolCallId, { id: message.toolCallId, name: String(message.toolName ?? call?.name ?? "tool"), args: call?.args,
          content: message.content, details: message.details, status: message.isError ? "error" : "success" });
        const nested = record(message.nestedCalls);
        if (Array.isArray(nested.calls)) for (const value of nested.calls) {
          const child = record(value);
          if (typeof child.id !== "string") continue;
          tools.set(child.id, { id: child.id, name: String(child.name ?? "tool"), args: child.arguments, parentId: message.toolCallId,
            content: child.error ? [{ type: "text", text: String(child.error) }] : [], unavailable: true,
            status: child.status === "ok" ? "success" : child.status === "error" ? "error" : "unknown" });
        }
      }
    }
    for (const block of content(record(this.live?.message).content)) {
      if (block.type === "toolCall" && typeof block.id === "string") tools.set(block.id, {
        id: block.id, name: String(block.name ?? "tool"), args: block.arguments, content: [], status: "running",
      });
    }
    for (const [id, tool] of this.tools) tools.set(id, tool);
    this.details = new Map([...tools].map(([id, tool]) => [id, { args: tool.args, content: content(tool.content).map((block) => block.type === "image" ? { type: "text", text: "[Image omitted: text-only viewer]" } : block), details: tool.details, unavailable: tool.unavailable }]));
    const nodes: ViewNode[] = [];
    const seen = new Set<string>();
    const addTool = (id: string) => {
      if (seen.has(id)) return;
      const tool = tools.get(id);
      if (!tool) return;
      seen.add(id);
      const args = record(tool.args);
      const label = [args.path, args.file_path, args.command].find((value) => typeof value === "string");
      nodes.push({ id, kind: "tool", name: tool.name, label: typeof label === "string" ? label : "", status: tool.status, parentId: tool.parentId });
      for (const child of tools.values()) if (child.parentId === id) addTool(child.id);
    };
    const addMessage = (id: string, value: unknown) => {
      const message = record(value);
      if (message.role === "toolResult") return;
      content(message.content).forEach((block, index) => {
        if (block.type === "toolCall" && typeof block.id === "string") {
          addTool(block.id);
          return;
        }
        let text = "";
        if (block.type === "text") text = String(block.text ?? "");
        else if (block.type === "thinking") text = String(block.thinking ?? "");
        else if (block.type === "image") text = "[Image omitted: text-only viewer]";
        if (text.trim()) nodes.push({ id: `${id}:${index}`, kind: "text", role: String(message.role ?? "system"), text, thinking: block.type === "thinking" });
      });
      if (message.errorMessage) nodes.push({ id: `${id}:error`, kind: "text", role: "error", text: String(message.errorMessage) });
    };
    for (const entry of entries.slice(start, end)) {
      const value = record(entry);
      if (entry.type === "message") addMessage(entry.id, value.message);
      else if (entry.type === "custom_message" && value.display) addMessage(entry.id, { role: "system", content: value.content });
      else if (entry.type === "compaction" || entry.type === "branch_summary") addMessage(entry.id, { role: "system", content: value.summary });
    }
    if (!before) {
      const liveCalls = new Set(content(record(this.live?.message).content).filter((block) => block.type === "toolCall").map((block) => block.id));
      for (const tool of this.tools.values()) if (!persisted.has(tool.id) && !liveCalls.has(tool.id) && !tool.parentId) addTool(tool.id);
      if (this.live) addMessage(this.live.id, this.live.message);
    }
    return { nodes, before: start > 0 ? entries[start]?.id : undefined };
  }

  detail(id: string): ViewDetail {
    const detail = this.details.get(id);
    if (!detail) throw new Error("Tool details are no longer on this branch");
    return detail;
  }
}
