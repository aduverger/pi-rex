import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { ConversationView } from "../src/conversation.ts";

function assistant(content: AssistantMessage["content"]): AssistantMessage {
  return { role: "assistant", content, api: "test", provider: "test", model: "test", stopReason: "stop", timestamp: 1,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
const context = (sessionManager: SessionManager) => ({ sessionManager });

test("projection preserves reasoning/tool order, source arguments/diffs, nested identities, and image placeholders without hidden metadata", () => {
  const manager = SessionManager.inMemory();
  const view = new ConversationView();
  manager.appendMessage({ role: "user", content: [{ type: "text", text: "Please inspect" }, { type: "image", data: "secret-image-bytes", mimeType: "image/png" }], timestamp: 0 });
  manager.appendMessage(assistant([{ type: "thinking", thinking: "First reason" }, { type: "toolCall", id: "parent", name: "edit", arguments: { path: "file.ts", oldText: "old", newText: "new" } }, { type: "text", text: "After tool" }]));
  manager.appendMessage({ role: "toolResult", toolCallId: "parent", toolName: "edit", isError: false, timestamp: 2,
    content: [{ type: "image", data: "secret-result-bytes", mimeType: "image/png" }], details: { diff: "-old\n+new" },
    nestedCalls: { complete: true, calls: [{ id: "nested", name: "read", arguments: { path: "nested.ts" }, status: "ok" }] } });
  manager.appendCustomEntry("private-state", { privateKey: "must not render" });
  manager.appendCustomMessageEntry("hidden", "Hidden message", false);
  manager.appendCustomMessageEntry("notice", "Visible message", true);
  const projected = view.project(context(manager));
  assert.deepEqual(projected.nodes.map((node) => node.kind === "tool" ? node.id : node.text), ["Please inspect", "[Image omitted: text-only viewer]", "First reason", "parent", "nested", "After tool", "Visible message"]);
  assert.equal(projected.nodes.find((node) => node.id === "nested")?.parentId, "parent");
  assert.deepEqual(view.detail("parent").args, { path: "file.ts", oldText: "old", newText: "new" });
  assert.deepEqual(view.detail("parent").details, { diff: "-old\n+new" });
  assert.equal(view.detail("nested").unavailable, true);
  assert.doesNotMatch(JSON.stringify(projected) + JSON.stringify(view.detail("parent")), /secret-|private-state|must not render|Hidden message/);
  view.updateTool({ toolCallId: "nested", toolName: "read", args: { path: "nested.ts" }, parentToolCallId: "parent", partialResult: { content: [{ type: "text", text: "partial" }] } });
  view.updateTool({ toolCallId: "nested", toolName: "read", result: { content: [{ type: "text", text: "finished" }] } });
  assert.equal(view.project(context(manager)).nodes.filter((node) => node.id === "nested").length, 1);
  assert.notEqual(view.detail("nested").unavailable, true);
  assert.deepEqual(view.detail("nested").content, [{ type: "text", text: "finished" }]);
});

test("history pages cover the active branch, and live tool calls do not move ahead of their reasoning", () => {
  const manager = SessionManager.inMemory();
  const view = new ConversationView();
  for (let index = 0; index < 110; index++) manager.appendMessage({ role: "user", content: `Message ${index}`, timestamp: index });
  let projected = view.project(context(manager));
  const nodes = [...projected.nodes];
  while (projected.before) { projected = view.project(context(manager), projected.before); nodes.unshift(...projected.nodes); }
  assert.deepEqual(nodes.map((node) => node.text), Array.from({ length: 110 }, (_, index) => `Message ${index}`));
  assert.throws(() => view.project(context(manager), "wrong-branch"));
  view.updateMessage(assistant([{ type: "thinking", thinking: "Live reasoning" }, { type: "toolCall", id: "live", name: "bash", arguments: { command: "true" } }]), "live-message");
  assert.deepEqual(view.project(context(manager)).nodes.slice(-2).map((node) => node.text ?? node.id), ["Live reasoning", "live"]);
  assert.deepEqual(view.detail("live").args, { command: "true" });
  view.updateTool({ toolCallId: "live", toolName: "bash", args: { command: "true" } });
  assert.deepEqual(view.project(context(manager)).nodes.slice(-2).map((node) => node.text ?? node.id), ["Live reasoning", "live"]);
});
