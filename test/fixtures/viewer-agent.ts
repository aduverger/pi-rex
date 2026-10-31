import { writeFileSync } from "node:fs";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function viewerAgent(pi: ExtensionAPI) {
  pi.registerProvider("pirex-test", {
    baseUrl: "http://127.0.0.1", apiKey: "local-fixture-only", api: "pirex-test",
    models: [{ id: "test", name: "Viewer test", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4000 }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const user = context.messages.filter((message) => message.role === "user").at(-1);
      const input = typeof user?.content === "string" ? user.content : user?.content.filter((part) => part.type === "text").map((part) => part.text).join(" ") ?? "";
      const message: AssistantMessage = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
        stopReason: "pending", timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      void (async () => {
        if (input === "tool fixture" && context.messages.at(-1)?.role === "user") {
          message.content = Array.from({ length: 6 }, (_, index) => ({ type: "toolCall" as const, id: `fixture-${index}-${Date.now()}`, name: "bash", arguments: { command: `printf 'tool output ${index}'` } }));
          message.stopReason = "toolUse";
          stream.push({ type: "done", reason: "toolUse", message }); stream.end(); return;
        }
        message.content = [{ type: "thinking", thinking: "" }, { type: "text", text: "" }];
        stream.push({ type: "start", partial: message });
        stream.push({ type: "thinking_start", contentIndex: 0, partial: message });
        message.content[0] = { type: "thinking", thinking: "Checking the fixture." };
        stream.push({ type: "thinking_delta", contentIndex: 0, delta: "Checking the fixture.", partial: message });
        stream.push({ type: "thinking_end", contentIndex: 0, content: "Checking the fixture.", partial: message });
        stream.push({ type: "text_start", contentIndex: 1, partial: message });
        for (const word of `Local reply: ${input}`.split(" ")) {
          await new Promise((resolve) => setTimeout(resolve, input.includes("slow") ? 300 : 20));
          if (options?.signal?.aborted) {
            message.stopReason = "aborted"; stream.push({ type: "error", reason: "aborted", error: message }); stream.end(); return;
          }
          const block = message.content[1];
          if (block.type === "text") block.text += `${word} `;
          stream.push({ type: "text_delta", contentIndex: 1, delta: `${word} `, partial: message });
        }
        message.stopReason = "stop";
        stream.push({ type: "done", reason: "stop", message }); stream.end();
      })();
      return stream;
    },
  });
  pi.on("session_start", () => {
    if (process.env.PIREX_TEST_PID_FILE) writeFileSync(process.env.PIREX_TEST_PID_FILE, String(process.pid));
  });
  pi.registerCommand("fixture-notice", { description: "Local notification fixture", handler: async (_args, ctx) => { ctx.ui.notify("Fixture notification", "error"); } });
  pi.registerCommand("fixture-resume", { description: "Resume a local test session", handler: async (path, ctx) => { await ctx.switchSession(path); } });
  pi.registerCommand("fixture-fork", { description: "Fork a local test session", handler: async (_args, ctx) => {
    const entry = ctx.sessionManager.getBranch().find((entry) => entry.type === "message" && entry.message.role === "user");
    if (entry) await ctx.fork(entry.id, { position: "at" });
  } });
  for (const kind of ["confirm", "select", "input", "editor"] as const) {
    pi.registerCommand(`fixture-${kind}`, { description: "Local viewer dialog fixture", handler: async (_args, ctx) => {
      let value: unknown;
      if (kind === "confirm") value = await ctx.ui.confirm("Fixture confirmation", "Allow this local fixture?");
      else if (kind === "select") value = await ctx.ui.select("Fixture selection", ["One", "Two"]);
      else if (kind === "input") value = await ctx.ui.input("Fixture input", "Type an answer");
      else value = await ctx.ui.editor("Fixture editor", "Prefilled answer");
      pi.sendMessage({ customType: "pirex-fixture", content: `Answered ${kind}: ${String(value)}`, display: true });
    } });
  }
}
