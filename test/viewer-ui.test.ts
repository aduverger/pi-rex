import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { TuiAltScreen, visibleWidth, type Terminal } from "@earendil-works/pi-tui";
import { ViewerApp, safeText } from "../src/viewer-ui.ts";
import { ViewerConnection } from "../src/viewer-connection.ts";
import type { ViewState } from "../src/view-state.ts";

class MemoryTerminal implements Terminal {
  columns = 80; rows = 24; kittyProtocolActive = false;
  input: (data: string) => void = () => {};
  resized = () => {};
  start(input: (data: string) => void, resized: () => void) { this.input = input; this.resized = resized; }
  stop() {}
  async drainInput() {}
  write() {}
  moveBy() {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle() {}
  setProgress() {}
  setProgramStatus() {}
}
class UIConnection extends ViewerConnection {
  calls: Record<string, unknown>[] = [];
  accept?: () => Promise<void>;
  constructor() { super({ endpoint: "", session: "", block: "", pid: 1, viewerBlock: "" }, () => {}, () => {}); this.connected = true; }
  override async command(action: Record<string, unknown>) { this.calls.push(action); await this.accept?.(); return { dispatched: true }; }
  override async detail(id: string) { return { args: { path: `${id}.ts` }, content: [{ type: "text", text: `Output for ${id}` }] }; }
}
const state = (overrides: Partial<ViewState> = {}): ViewState => ({ generation: "generation", revision: 1, sessionId: "session", name: "Fixture", busy: false, nodes: [], dialogs: [], customUI: false, ...overrides });
function assertCommand(actual: Record<string, unknown> | undefined, expected: Record<string, unknown>) {
  assert.ok(actual, "expected a command");
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, `command.${key}`);
}
async function setup(t: TestContext, initial: ViewState) {
  initTheme("dark", false);
  const terminal = new MemoryTerminal();
  const tui = new TuiAltScreen(terminal, true, undefined, { mouse: true });
  const connection = new UIConnection();
  const app = new ViewerApp(tui, connection);
  tui.setLayoutRoot(app.root); app.update(initial); tui.start();
  t.after(() => tui.stop());
  const screen = async () => { await delay(30); return tui.getScreenLines().map(safeText); };
  const click = async (label: string) => {
    const lines = await screen();
    const y = lines.findLastIndex((line) => line.includes(label));
    assert.ok(y >= 0, `Expected ${label}:\n${lines.join("\n")}`);
    const x = lines[y].indexOf(label) + 1;
    terminal.input(`\x1b[<0;${x};${y + 1}M`);
    terminal.input(`\x1b[<0;${x};${y + 1}m`);
    await delay(30);
  };
  await screen();
  return { terminal, tui, connection, app, screen, click };
}

test("real TUI mouse press/release activates controls and retains edits made while an acknowledgement is pending", async (t) => {
  const { app, connection, click } = await setup(t, state());
  let acknowledge!: () => void;
  connection.accept = () => new Promise((resolve) => { acknowledge = resolve; });
  app.editor.setText("First prompt");
  await click("Send");
  assert.equal(connection.calls.length, 1);
  assertCommand(connection.calls[0], { kind: "prompt", text: "First prompt", delivery: "send" });
  app.editor.setText("New draft while sending"); acknowledge(); await delay(30);
  assert.equal(app.editor.getExpandedText(), "New draft while sending");
  connection.accept = undefined;
  await click("Follow-up");
  assert.equal(connection.calls.at(-1)?.delivery, "followUp");
  assert.equal(app.editor.getExpandedText(), "");
  await click("Stop");
  assertCommand(connection.calls.at(-1), { kind: "abort" });
  connection.accept = () => new Promise((resolve) => { acknowledge = resolve; });
  app.editor.setText("Same text in two sessions");
  await click("Send");
  app.update(state({ generation: "new", sessionId: "different-session" }));
  app.editor.setText("Same text in two sessions");
  acknowledge(); await delay(30);
  assert.equal(app.editor.getExpandedText(), "Same text in two sessions", "an old acknowledgement must not clear the new conversation draft");
  app.update(state({ generation: "resumed" }));
  assert.equal(app.editor.getExpandedText(), "", "the dispatched original draft must not return automatically on resume");
});

test("tool groups and individual cards expand by touch, folds and scrolling survive updates, and narrow resizes fit", async (t) => {
  const initial = state({ nodes: [
    { id: "intro", kind: "text", role: "assistant", text: "# A heading\n\n```ts\nconst value = 1;\n```" },
    ...Array.from({ length: 6 }, (_, index) => ({ id: `tool-${index}`, kind: "tool" as const, name: "bash", label: `command-${index}`, status: index === 5 ? "error" as const : "success" as const })),
    { id: "nested", kind: "tool", parentId: "tool-5", name: "read", label: "nested-child", status: "success" },
    { id: "after", kind: "text", role: "assistant", text: "After tools" },
  ] });
  const { app, tui, terminal, screen, click } = await setup(t, initial);
  const folded = (await screen()).join("\n");
  assert.match(folded, /7 tool calls/);
  assert.match(folded, /1 failed/);
  assert.doesNotMatch(folded, /command-5/);
  await click("7 tool calls");
  await click("command-5");
  assert.match((await screen()).join("\n"), /Output for tool-5/);
  await click("nested-child");
  assert.match((await screen()).join("\n"), /Output for nested/);
  const reloaded = { ...initial, generation: "after-reload", name: "Reloaded fixture", revision: 2 };
  app.update(reloaded);
  const afterReload = (await screen()).join("\n");
  assert.match(afterReload, /Reloaded fixture/);
  assert.match(afterReload, /Output for tool-5/);
  tui.scrollToTop();
  assert.match((await screen()).join("\n"), /A heading/);
  app.update({ ...reloaded, name: "Streaming fixture", revision: 3, nodes: [...initial.nodes, { id: "later", kind: "text", text: "New streaming text" }] });
  const whileScrolled = (await screen()).join("\n");
  assert.match(whileScrolled, /Streaming fixture/);
  assert.match(whileScrolled, /A heading/);
  assert.doesNotMatch(whileScrolled, /New streaming text/);
  for (const width of [40, 20, 6, 3, 1, 80]) {
    terminal.columns = width; terminal.resized();
    for (const line of await screen()) assert.ok(visibleWidth(line) <= width, `overflow at ${width}: ${line}`);
  }
});

test("standard editor dialogs keep their answer and touch controls visible in a keyboard-sized viewport", async (t) => {
  const prefill = Array.from({ length: 20 }, (_, index) => `Answer line ${index}`).join("\n");
  const { terminal, screen, app, connection, click } = await setup(t, state({ dialogs: [{ id: "long-editor", kind: "editor", title: "Edit the answer", prefill }] }));
  terminal.columns = 40; terminal.rows = 10; terminal.resized();
  const lines = (await screen()).join("\n");
  assert.match(lines, /Answer line 19/);
  assert.match(lines, /Submit answer/);
  assert.match(lines, /Cancel dialog/);
  await click("Submit answer");
  assert.equal(connection.calls.at(-1)?.value, prefill);
  connection.uncertain = { kind: "answer", generation: "generation", dialogId: "long-editor" };
  app.status();
  await click("Dismiss uncertainty");
  assert.match((await screen()).join("\n"), /Answer line 19/);
  app.update(state({ dialogs: [{ id: "approval", kind: "confirm", title: "Approval details", message: [...Array.from({ length: 20 }, (_, index) => `Detail ${index}`), "Exact command at end"].join("\n") }] }));
  await screen();
  for (let index = 0; index < 30; index++) terminal.input("\x1b[<65;2;2M");
  const approval = (await screen()).join("\n");
  assert.match(approval, /Exact command at end/);
  assert.match(approval, /Yes/);
  assert.match(approval, /Cancel dialog/);
});

test("session changes retain independent drafts, and touch answers pending standard dialogs without submitting the composer", async (t) => {
  const { app, connection, screen, click } = await setup(t, state());
  app.editor.setText("Old session draft");
  app.update(state({ generation: "next", sessionId: "new-session" }));
  assert.equal(app.editor.getExpandedText(), "");
  app.editor.setText("New session draft");
  app.update(state({ generation: "resumed", sessionId: "session" }));
  assert.equal(app.editor.getExpandedText(), "Old session draft");
  app.update(state({ dialogs: [{ id: "confirm", kind: "confirm", title: "Allow action?" }] }));
  assert.match((await screen()).join("\n"), /Allow action\?/);
  await click("Yes");
  assertCommand(connection.calls.at(-1), { kind: "answer", dialogId: "confirm", value: true, cancelled: false });
  assert.equal(app.editor.getExpandedText(), "Old session draft");
  app.update(state({ dialogs: [{ id: "editor", kind: "editor", title: "Edit answer", prefill: "Prefilled content" }] }));
  await click("Cancel dialog");
  assertCommand(connection.calls.at(-1), { kind: "answer", dialogId: "editor", cancelled: true });
  assert.equal(app.editor.getExpandedText(), "Old session draft");
});

test("unconfirmed dispatches retain recoverable text without overwriting drafts or replaying", async (t) => {
  const { app, connection, screen, click, terminal } = await setup(t, state());
  app.editor.setText("Unconfirmed message");
  await click("Send");
  assert.equal(app.editor.getExpandedText(), "");
  assert.match((await screen()).join("\n"), /acceptance unconfirmed/);
  app.update(state({ nodes: [
    { id: "other-surface", kind: "text", role: "user", text: "Unconfirmed message" },
    { id: "reply", kind: "text", role: "assistant", text: "Small viewport reply" },
  ] }));
  terminal.columns = 40; terminal.rows = 10; terminal.resized();
  const phoneViewport = (await screen()).join("\n");
  assert.match(phoneViewport, /Small viewport reply/);
  assert.match(phoneViewport, /Submission recovery/);
  assert.match(phoneViewport, /acceptance unconfirmed/);
  terminal.columns = 80; terminal.rows = 24; terminal.resized();
  app.editor.setText("Keep this newer draft");
  await click("Submission recovery");
  assert.match((await screen()).join("\n"), /Dispatched; acceptance unconfirmed/);
  await click("Insert into draft");
  assert.equal(app.editor.getExpandedText(), "Keep this newer draft\nUnconfirmed message");
  assert.equal(connection.calls.length, 1, "recovering text must not submit it again");
  app.update(state({ generation: "replacement", sessionId: "new-session" }));
  await click("Submission recovery");
  assert.match((await screen()).join("\n"), /Previous conversation/);
  await click("Dismiss");
  assert.doesNotMatch((await screen()).join("\n"), /Submission recovery/);
  assert.equal(connection.calls.length, 1);
});
