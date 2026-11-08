import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { channel } from "node:diagnostics_channel";
import { chmod, copyFile, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate, setTimeout } from "node:timers/promises";
import { test } from "node:test";
import { AssistantMessageComponent, createBashToolDefinition, CustomEditor, getSelectListTheme, initTheme, SettingsManager, ToolExecutionComponent, type ExtensionAPI, type ExtensionContext, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { getKeybindings, ProcessTerminal, setKeybindings, stripTerminalSequences, TuiAltScreen, TuiMainScreen, type Component, type Terminal, type TUI } from "@earendil-works/pi-tui";
import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import { createInteractiveTuiReference } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/tui-renderer.js";
import rexExtension from "../src/index.ts";
import { getRexContext, hasIosOwner, watchRexOwner } from "../src/rex.ts";

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 4000;
  while (!(await predicate())) {
    assert.ok(Date.now() < deadline, "timed out waiting for Rex fixture");
    await setTimeout(20);
  }
}

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), "pi-rex-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const command = join(directory, "rex");
  await copyFile(new URL("./fixtures/rex.mjs", import.meta.url), command);
  await chmod(command, 0o755);
  const state = {
    owner: "client:desktop" as string | null,
    clients: {
      "client:desktop": { kind: "app", platform: "macos" },
      "client:ios": { kind: "app", platform: "ios" },
      "client:cli": { kind: "cli", platform: "ios" },
      "client:unknown": { kind: "app", platform: "other" },
    },
    events: [] as unknown[],
    queryError: false,
    malformed: false,
    exit: false,
    holdOwner: "",
    holdKey: false,
    holdReply: false,
    sendError: false,
  };
  async function save() {
    await writeFile(join(directory, "state.tmp"), JSON.stringify(state));
    await rename(join(directory, "state.tmp"), join(directory, "state.json"));
  }
  await save();
  const context = { command, session: "session:test", block: "block:test" };
  async function ownerChanged(block = context.block) {
    state.events.push({ type: "session_event", payload: {
      session_id: context.session,
      event: { type: "block_owner_changed", payload: { block_id: block, owner: state.owner } },
    } });
    await save();
  }
  async function ready() {
    await waitFor(async () => {
      try { await readFile(join(directory, "pid")); return true; } catch { return false; }
    });
  }
  return { state, save, context, ownerChanged, ready, directory };
}

test("Rex detection requires session and block context, not terminal width or TERM_PROGRAM", () => {
  assert.equal(getRexContext({ TERM_PROGRAM: "rex", COLUMNS: "30" }), undefined);
  assert.equal(getRexContext({ REX_SESSION: "session:test" }), undefined);
  assert.deepEqual(getRexContext({ REX_SESSION: "session:test", REX_BLOCK: "block:test" }), {
    command: "rex", session: "session:test", block: "block:test",
  });
  assert.equal(getRexContext({ REX_SESSION: "s", REX_BLOCK: "b", REX_BIN_DIR: "/rex/bin" })?.command, "/rex/bin/rex");
});

test("only an iOS app that owns this block enables mobile rendering", async (t) => {
  const f = await fixture(t);
  for (const owner of ["client:desktop", "client:cli", "client:unknown", null, "client:ios"]) {
    f.state.owner = owner;
    await f.save();
    assert.equal(await hasIosOwner(f.context), owner === "client:ios");
  }
});

test("owner events switch modes without relying on size changes; stopping restores normal mode", async (t) => {
  const f = await fixture(t);
  const transitions: boolean[] = [];
  const stop = watchRexOwner(f.context, (mobile) => transitions.push(mobile));
  t.after(async () => stop());
  await f.ready();
  await setTimeout(100);
  assert.deepEqual(transitions, []);
  f.state.owner = "client:ios";
  await f.ownerChanged("block:unrelated");
  await setTimeout(100);
  assert.deepEqual(transitions, []);
  await f.ownerChanged();
  await waitFor(() => transitions.length === 1);
  assert.deepEqual(transitions, [true]);
  f.state.owner = "client:desktop";
  await f.ownerChanged();
  await waitFor(() => transitions.length === 2);
  assert.deepEqual(transitions, [true, false]);
  f.state.owner = "client:ios";
  await f.ownerChanged();
  await waitFor(() => transitions.length === 3);
  stop();
  stop();
  assert.deepEqual(transitions, [true, false, true, false]);
});

test("query failure falls back to normal rendering and a later owner event can recover", async (t) => {
  const f = await fixture(t);
  f.state.owner = "client:ios";
  await f.save();
  const transitions: boolean[] = [];
  const stop = watchRexOwner(f.context, (mobile) => transitions.push(mobile));
  t.after(async () => stop());
  await waitFor(() => transitions.at(-1) === true);
  f.state.queryError = true;
  await f.ownerChanged();
  await waitFor(() => transitions.at(-1) === false);
  f.state.queryError = false;
  await f.ownerChanged();
  await waitFor(() => transitions.length === 3);
  assert.deepEqual(transitions, [true, false, true]);
});

test("a stale iOS owner response cannot override a newer desktop handoff", async (t) => {
  const f = await fixture(t);
  f.state.owner = "client:ios";
  await f.save();
  const transitions: boolean[] = [];
  const stop = watchRexOwner(f.context, (mobile) => transitions.push(mobile));
  t.after(async () => stop());
  await waitFor(() => transitions.at(-1) === true);
  f.state.holdOwner = "client:ios";
  await f.ownerChanged();
  let heldPid = 0;
  await waitFor(async () => {
    try {
      heldPid = Number(await readFile(join(f.directory, "held-query"), "utf8"));
      return heldPid > 0;
    } catch { return false; }
  });
  f.state.owner = "client:desktop";
  await f.ownerChanged();
  await waitFor(() => transitions.at(-1) === false);
  await writeFile(join(f.directory, "release-query"), "");
  await waitFor(() => {
    try { process.kill(heldPid, 0); return false; } catch { return true; }
  });
  await setTimeout(100);
  assert.deepEqual(transitions, [true, false]);
});

test("event stream exit restores normal rendering", async (t) => {
  const f = await fixture(t);
  f.state.owner = "client:ios";
  await f.save();
  const transitions: boolean[] = [];
  const stop = watchRexOwner(f.context, (mobile) => transitions.push(mobile));
  t.after(async () => stop());
  await waitFor(() => transitions.at(-1) === true);
  f.state.exit = true;
  await f.save();
  await waitFor(() => transitions.at(-1) === false);
  assert.deepEqual(transitions, [true, false]);
});

function observeRexCommands(t: Parameters<typeof fixture>[0], command: string) {
  const commands: { child: ChildProcess; closed: Promise<void> }[] = [];
  const subprocesses = channel("child_process");
  const observeCommand = (message: unknown) => {
    const child = (message as { process: ChildProcess }).process;
    child.once("spawn", () => {
      if (child.spawnfile === command) {
        commands.push({ child, closed: new Promise<void>((resolve) => { child.once("close", () => resolve()); }) });
      }
    });
  };
  subprocesses.subscribe(observeCommand);
  t.after(async () => { subprocesses.unsubscribe(observeCommand); });
  return commands;
}

function loadExtension(f: Awaited<ReturnType<typeof fixture>>, getSettings: ExtensionAPI["getSettings"]) {
  const handlers = new Map<string, (event: unknown, context: ExtensionContext) => void | Promise<void>>();
  let resolver: Parameters<ExtensionAPI["registerToolRenderer"]>[0] | undefined;
  const pi = {
    getSettings,
    registerToolRenderer(value: NonNullable<typeof resolver>) { resolver = value; },
    on(name: string, handler: (event: unknown, context: ExtensionContext) => void) {
      handlers.set(name, handler);
    },
  } as unknown as ExtensionAPI;
  const env = { REX_SESSION: process.env.REX_SESSION, REX_BLOCK: process.env.REX_BLOCK, REX_BIN_DIR: process.env.REX_BIN_DIR };
  try {
    Object.assign(process.env, { REX_SESSION: f.context.session, REX_BLOCK: f.context.block, REX_BIN_DIR: f.directory });
    rexExtension(pi);
  } finally {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  assert.ok(resolver);
  return { handlers, resolver };
}

test("extension watches only in TUI mode and restores expansion on handoff and shutdown", async (t) => {
  const f = await fixture(t);
  const { handlers, resolver } = loadExtension(f, () => ({ hideThinkingBlock: true }));
  const commands = observeRexCommands(t, f.context.command);
  let expanded = true;
  let component: ToolExecutionComponent | undefined;
  const context = {
    mode: "json",
    ui: {
      onTerminalInput: () => () => {},
      setWidget() {},
      getToolsExpanded: () => expanded,
      setToolsExpanded: (value: boolean) => {
        if (value === expanded) return;
        expanded = value;
        component?.setExpanded(value);
      },
    },
  } as unknown as ExtensionContext;
  for (const mode of ["json", "rpc", "print"] as const) {
    context.mode = mode;
    await handlers.get("session_start")!({}, context);
    await setImmediate();
    assert.equal(commands.length, 0);
    assert.equal(expanded, true);
  }
  initTheme("dark", false);
  const definition = createBashToolDefinition(process.cwd()) as ToolRenderers;
  const args = { command: "printf sample" };
  const result = { content: [{ type: "text" as const, text: "sample\n".repeat(20) }], isError: false, durationMs: 50 };
  const ui = { requestRender() {} } as TUI;
  component = new ToolExecutionComponent("bash", "integration", args, { showImages: false },
    resolver("bash", () => definition), ui, process.cwd());
  component.updateResult(result);
  const native = new ToolExecutionComponent("bash", "native", args, { showImages: false }, definition, ui, process.cwd());
  native.updateResult(result);
  native.setExpanded(true);
  f.state.owner = "client:ios";
  await f.save();
  context.mode = "tui";
  await handlers.get("session_start")!({}, context);
  t.after(async () => { await handlers.get("session_shutdown")!({ reason: "quit" }, context); });
  await waitFor(() => !expanded);
  const tool = component;
  const render = () => tool.render(40);
  const clickFrame = () => {
    const lines = render();
    assert.equal(tool.handleMouse({ type: "click", button: "left", x: 2, y: 1, screenX: 2, screenY: 1,
      width: 40, height: lines.length, shift: false, alt: false, ctrl: false })?.handled, true);
  };
  assert.equal(render().length, 4);
  clickFrame();
  assert.ok(render().length > 4);
  context.ui.setToolsExpanded(true);
  clickFrame();
  assert.equal(render().length, 4);
  clickFrame();
  assert.ok(render().length > 4);
  context.ui.setToolsExpanded(false);
  assert.equal(render().length, 4);
  f.state.owner = "client:desktop";
  await f.ownerChanged();
  await waitFor(() => expanded);
  assert.deepEqual(render(), native.render(40));
  f.state.owner = "client:ios";
  await f.ownerChanged();
  await waitFor(() => !expanded);
  await handlers.get("session_shutdown")!({ reason: "quit" }, context);
  assert.equal(expanded, true);
  await handlers.get("session_shutdown")!({ reason: "quit" }, context);
});

async function thinkingSession(t: Parameters<typeof fixture>[0], initiallyHidden = false, binding: "ctrl+t" | "alt+t" = "ctrl+t", fullscreen = false) {
  const f = await fixture(t);
  initTheme("dark", false);
  const settings = SettingsManager.inMemory({ hideThinkingBlock: initiallyHidden });
  const keybindings = new KeybindingsManager({ "app.thinking.toggle": binding });
  const previousKeybindings = getKeybindings();
  setKeybindings(keybindings);
  t.after(async () => { setKeybindings(previousKeybindings); });
  let input = (_data: string) => {};
  const terminal: Terminal = {
    columns: 60, rows: 24, kittyProtocolActive: false,
    start(onInput) { input = onInput; }, stop() { input = () => {}; },
    async drainInput() {}, restoreOnExit() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {},
    clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
  };
  const renderer = fullscreen ? new TuiAltScreen(terminal) : new TuiMainScreen(terminal);
  const tui = createInteractiveTuiReference(() => renderer);
  const message: NonNullable<ConstructorParameters<typeof AssistantMessageComponent>[0]> = {
    role: "assistant", api: "openai-responses", provider: "openai", model: "gpt-5", timestamp: 0, stopReason: "stop",
    content: [{ type: "thinking", thinking: "Private thought" }, { type: "text", text: "Visible answer" }],
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  const assistant = new AssistantMessageComponent(message, initiallyHidden);
  const editor = new CustomEditor(tui, { borderColor: (text) => text, selectList: getSelectListTheme() }, keybindings);
  editor.onAction("app.thinking.toggle", () => {
    const hidden = !settings.getHideThinkingBlock();
    settings.setHideThinkingBlock(hidden);
    assistant.setHideThinkingBlock(hidden);
  });
  tui.addChild(assistant);
  tui.addChild(editor);
  tui.setFocus(editor);
  tui.start();
  const deliveredKeys: string[] = [];
  const server = createServer((socket) => socket.on("data", (data) => {
    input(data.toString());
    deliveredKeys.push(data.toString());
  }));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(join(f.directory, "input.sock"), resolve);
  });
  const commands = observeRexCommands(t, f.context.command);
  const widgets = new Map<string, Component>();
  const warnings: string[] = [];
  let expanded = true;
  const context = {
    mode: "tui",
    ui: {
      getToolsExpanded: () => expanded,
      setToolsExpanded: (value: boolean) => { expanded = value; },
      onTerminalInput: (listener: Parameters<TUI["addInputListener"]>[0]) => tui.addInputListener(listener),
      setWidget(key: string, factory: ((tui: TUI) => Component) | undefined) {
        const previous = widgets.get(key);
        if (previous) { tui.removeChild(previous); widgets.delete(key); }
        if (factory) { const widget = factory(tui); widgets.set(key, widget); tui.addChild(widget); }
        tui.requestRender();
      },
      notify: (message: string, type: string) => {
        if (type === "warning") warnings.push(message);
        tui.requestRender();
      },
    },
  } as unknown as ExtensionContext;
  const { handlers } = loadExtension(f, () => settings.getSettings());
  const start = () => handlers.get("session_start")!({}, context);
  const shutdown = (reason: string) => handlers.get("session_shutdown")!({ reason }, context);
  t.after(async () => {
    await shutdown("quit");
    tui.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await start();
  await f.ready();
  async function own(owner: string) {
    f.state.owner = owner;
    await f.ownerChanged();
    await waitFor(() => expanded === (owner !== "client:ios"));
  }
  async function keys() {
    await setImmediate();
    return commands.filter(({ child }) => child.spawnargs.includes("send-key"));
  }
  async function settleKeys() {
    const keyCommands = await keys();
    await Promise.all(keyCommands.map(({ closed }) => closed));
    await setImmediate();
  }
  const output = () => assistant.render(60).map(stripTerminalSequences).join("\n");
  return { f, settings, tui, terminal, editor, assistant, message, warnings, widgets, start, shutdown, own, keys, settleKeys, deliveredKeys, output, input: (data: string) => input(data) };
}

for (const { initiallyHidden, fullscreen } of [
  { initiallyHidden: false, fullscreen: false },
  { initiallyHidden: true, fullscreen: false },
  { initiallyHidden: false, fullscreen: true },
]) {
  test(`mobile thinking preserves the default label and ${initiallyHidden ? "hidden" : "visible"} desktop preference in ${fullscreen ? "fullscreen" : "regular"} mode`, async (t) => {
    const s = await thinkingSession(t, initiallyHidden, "ctrl+t", fullscreen);
    const savedMessage = structuredClone(s.message);
    await s.own("client:ios");
    await waitFor(() => s.settings.getHideThinkingBlock());
    assert.match(s.output(), /Thinking\.\.\./);
    assert.doesNotMatch(s.output(), /Private thought/);
    assert.match(s.output(), /Visible answer/);
    s.assistant.updateContent(s.message, true);
    assert.doesNotMatch(s.output(), /Private thought/);
    const lines = s.assistant.render(60);
    assert.equal(s.assistant.handleMouse({ type: "click", button: "left", x: 2, y: 1, screenX: 2, screenY: 1,
      width: 60, height: lines.length, shift: false, alt: false, ctrl: false })?.handled, true);
    s.tui.renderNow(true);
    assert.match(s.output(), /Private thought/);
    await s.own("client:desktop");
    await waitFor(() => s.settings.getHideThinkingBlock() === initiallyHidden);
    assert.equal((await s.keys()).length, initiallyHidden ? 0 : 2);
    assert.deepEqual(s.message, savedMessage);
    assert.deepEqual(s.warnings, []);
  });
}

test("thinking collapse waits for the editor and consumes a key if focus changes during delivery", async (t) => {
  const s = await thinkingSession(t);
  const dialogInput: string[] = [];
  const dialog = { render: () => ["Dialog"], invalidate() {}, handleInput: (data: string) => { dialogInput.push(data); } };
  s.tui.addChild(dialog);
  s.tui.setFocus(dialog);
  await s.own("client:ios");
  assert.equal((await s.keys()).length, 0);
  s.f.state.holdKey = true;
  s.f.state.holdReply = true;
  await s.f.save();
  s.tui.setFocus(s.editor);
  s.tui.requestRender();
  await waitFor(async () => (await s.keys()).length === 1);
  s.tui.setFocus(dialog);
  await writeFile(join(s.f.directory, "release-key"), "");
  await waitFor(() => s.deliveredKeys.length === 1);
  assert.deepEqual(dialogInput, []);
  assert.equal(s.settings.getHideThinkingBlock(), false);
  s.tui.setFocus(s.editor);
  s.tui.renderNow(true);
  await writeFile(join(s.f.directory, "release-reply"), "");
  await waitFor(() => s.settings.getHideThinkingBlock());
  await s.own("client:desktop");
  await waitFor(() => !s.settings.getHideThinkingBlock());
  assert.deepEqual(s.warnings, []);
});

test("owner changes do not send keys while Pi has released its terminal to another program", async (t) => {
  const s = await thinkingSession(t);
  const prototype = Object.getPrototypeOf(s.terminal);
  const raw = Object.getOwnPropertyDescriptor(process.stdin, "isRaw");
  t.after(async () => {
    Object.setPrototypeOf(s.terminal, prototype);
    if (raw) Object.defineProperty(process.stdin, "isRaw", raw);
    else Reflect.deleteProperty(process.stdin, "isRaw");
  });
  Object.setPrototypeOf(s.terminal, ProcessTerminal.prototype);
  Object.defineProperty(process.stdin, "isRaw", { value: false, writable: true, configurable: true });
  s.tui.stop();
  await s.own("client:ios");
  assert.equal((await s.keys()).length, 0);
  process.stdin.isRaw = true;
  s.tui.start();
  s.tui.requestRender(true);
  await waitFor(() => s.settings.getHideThinkingBlock());
  await s.own("client:desktop");
  await waitFor(() => !s.settings.getHideThinkingBlock());
  assert.deepEqual(s.warnings, []);
});

test("a delayed mobile key cannot override desktop handoff, and later handoffs still work", async (t) => {
  const s = await thinkingSession(t);
  s.f.state.holdKey = true;
  await s.f.save();
  await s.own("client:ios");
  await waitFor(async () => (await s.keys()).length === 1);
  s.input("\x1b[116;5:3u");
  await s.own("client:desktop");
  await writeFile(join(s.f.directory, "release-key"), "");
  await waitFor(() => s.deliveredKeys.length === 1);
  await s.settleKeys();
  assert.equal(s.settings.getHideThinkingBlock(), false);
  assert.equal((await s.keys()).length, 1);
  await s.own("client:ios");
  await waitFor(() => s.settings.getHideThinkingBlock());
  await s.own("client:desktop");
  await waitFor(() => !s.settings.getHideThinkingBlock());
  assert.equal((await s.keys()).length, 3);
  assert.deepEqual(s.warnings, []);
});

test("manual Ctrl+T racing key delivery cannot cause a double toggle", async (t) => {
  const s = await thinkingSession(t);
  s.f.state.holdKey = true;
  await s.f.save();
  await s.own("client:ios");
  await waitFor(async () => (await s.keys()).length === 1);
  s.input("\x14");
  assert.equal(s.settings.getHideThinkingBlock(), true);
  await writeFile(join(s.f.directory, "release-key"), "");
  await waitFor(() => s.deliveredKeys.length === 1);
  await s.settleKeys();
  assert.equal(s.settings.getHideThinkingBlock(), true);
  await s.own("client:desktop");
  await waitFor(() => !s.settings.getHideThinkingBlock());
  assert.deepEqual(s.warnings, []);
});

test("manual thinking expansion is not repeatedly overridden while mobile", async (t) => {
  const s = await thinkingSession(t);
  await s.own("client:ios");
  await waitFor(() => s.settings.getHideThinkingBlock());
  await s.settleKeys();
  s.input("\x14");
  s.tui.renderNow(true);
  assert.equal(s.settings.getHideThinkingBlock(), false);
  await s.own("client:desktop");
  assert.equal((await s.keys()).length, 1);
});

test("failed key delivery is not retried blindly and a later ownership cycle can recover", async (t) => {
  const s = await thinkingSession(t);
  s.f.state.sendError = true;
  await s.f.save();
  await s.own("client:ios");
  await waitFor(() => s.warnings.length > 0);
  assert.ok(s.warnings[0].trim());
  await s.settleKeys();
  s.tui.renderNow(true);
  assert.equal(s.settings.getHideThinkingBlock(), false);
  assert.equal((await s.keys()).length, 1);
  await s.own("client:desktop");
  s.f.state.sendError = false;
  await s.f.save();
  await s.own("client:ios");
  await waitFor(() => s.settings.getHideThinkingBlock());
  await s.own("client:desktop");
  await waitFor(() => !s.settings.getHideThinkingBlock());
});

test("an intercepted key is reported as unconfirmed rather than claiming a successful collapse", async (t) => {
  const s = await thinkingSession(t);
  const unblock = s.tui.addInputListener(() => ({ consume: true }));
  await s.own("client:ios");
  await waitFor(() => s.warnings.length > 0);
  assert.ok(s.warnings[0].trim());
  s.tui.renderNow(true);
  assert.equal((await s.keys()).length, 1);
  assert.equal(s.settings.getHideThinkingBlock(), false);
  await s.own("client:desktop");
  assert.equal((await s.keys()).length, 1);
  unblock();
  await s.own("client:ios");
  await waitFor(() => s.settings.getHideThinkingBlock());
  await s.own("client:desktop");
  await waitFor(() => !s.settings.getHideThinkingBlock());
});

test("remapped Ctrl+T is left untouched without sending a key", async (t) => {
  const s = await thinkingSession(t, false, "alt+t");
  await s.own("client:ios");
  assert.equal(s.settings.getHideThinkingBlock(), false);
  assert.equal((await s.keys()).length, 0);
  assert.ok(s.warnings[0]?.trim());
});

test("conflicting Ctrl+T overrides cannot trigger another editor action", async (t) => {
  const s = await thinkingSession(t);
  getKeybindings().setUserBindings({ "app.thinking.toggle": "ctrl+t", "app.exit": "ctrl+t" });
  s.editor.onAction("app.exit", () => assert.fail("must not invoke the conflicting exit shortcut"));
  await s.own("client:ios");
  assert.equal((await s.keys()).length, 0);
  assert.equal(s.settings.getHideThinkingBlock(), false);
  assert.ok(s.warnings[0]?.trim());
});

test("live reload restores thinking before reapplying mobile defaults; quit sends no restoration key", async (t) => {
  const s = await thinkingSession(t);
  await s.own("client:ios");
  await waitFor(() => s.settings.getHideThinkingBlock());
  await s.shutdown("reload");
  assert.equal(s.settings.getHideThinkingBlock(), false);
  assert.equal((await s.keys()).length, 2);
  await s.start();
  await waitFor(() => s.settings.getHideThinkingBlock());
  s.tui.stop();
  await s.shutdown("quit");
  assert.equal((await s.keys()).length, 3);
  assert.equal(s.settings.getHideThinkingBlock(), true);
  assert.equal(s.widgets.size, 0);
});

test("missing CLI and malformed responses fail without enabling mobile rendering", async (t) => {
  const f = await fixture(t);
  f.state.malformed = true;
  await f.save();
  await assert.rejects(hasIosOwner(f.context));
  const transitions: boolean[] = [];
  const stop = watchRexOwner({ ...f.context, command: join(f.directory, "missing") }, (mobile) => transitions.push(mobile));
  await setTimeout(100);
  stop();
  assert.deepEqual(transitions, []);
});
