import assert from "node:assert/strict";
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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
  };
  const save = () => writeFile(join(directory, "state.json"), JSON.stringify(state));
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

test("extension starts watching only in TUI mode and restores expansion on shutdown", async (t) => {
  const f = await fixture(t);
  const handlers = new Map<string, (event: unknown, context: ExtensionContext) => void>();
  let rendererRegistered = false;
  const pi = {
    registerToolRenderer() { rendererRegistered = true; },
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
  assert.equal(rendererRegistered, true);
  let expanded = true;
  const context = {
    mode: "json",
    ui: {
      getToolsExpanded: () => expanded,
      setToolsExpanded: (value: boolean) => { expanded = value; },
    },
  } as ExtensionContext;
  handlers.get("session_start")!({}, context);
  await assert.rejects(readFile(join(f.directory, "pid")));
  f.state.owner = "client:ios";
  await f.save();
  context.mode = "tui";
  handlers.get("session_start")!({}, context);
  t.after(async () => { handlers.get("session_shutdown")!({}, context); });
  await waitFor(() => !expanded);
  handlers.get("session_shutdown")!({}, context);
  assert.equal(expanded, true);
  handlers.get("session_shutdown")!({}, context);
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
