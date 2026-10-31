import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Dialogs } from "../src/dialogs.ts";

function setup() {
  const local: { resolve: (value: unknown) => void; signal?: AbortSignal }[] = [];
  const ask = (...args: unknown[]) => new Promise((resolve) => { local.push({ resolve, signal: (args.at(-1) as { signal?: AbortSignal })?.signal }); });
  const ui = { select: ask, confirm: ask, input: ask, editor: ask, custom: ask, notify() {} } as unknown as ExtensionUIContext;
  const original = { ...ui };
  let changes = 0;
  const dialogs = new Dialogs(() => changes++);
  const restore = dialogs.install(ui);
  return { ui, local, dialogs, restore, original, changes: () => changes };
}

test("standard dialogs accept only valid mobile answers, cancel native UI, and ignore its later answer", async () => {
  const { ui, local, dialogs, restore, original } = setup();
  const pending = ui.select("Choose", ["One", "Two"]);
  await delay(0);
  const id = dialogs.visible[0].id;
  assert.throws(() => dialogs.answer(id, "Other", false), /Invalid dialog choice/);
  assert.equal(dialogs.visible.length, 1);
  dialogs.answer(id, "Two", false);
  assert.equal(await pending, "Two");
  assert.equal(local[0].signal?.aborted, true);
  local[0].resolve("One");
  await delay(0);
  assert.equal(dialogs.visible.length, 0);
  assert.throws(() => dialogs.answer(id, "One", false), /no longer/);
  restore();
  assert.equal(ui.select, original.select);
  assert.equal(ui.editor, original.editor);
});

test("native answers win, timeout and external cancellation remove dialogs, and shutdown restores pending callers", async () => {
  const { ui, local, dialogs, restore, changes } = setup();
  const native = ui.confirm("Continue?", "Message");
  await delay(0);
  const nativeId = dialogs.visible[0].id;
  local[0].resolve(true);
  assert.equal(await native, true);
  assert.throws(() => dialogs.answer(nativeId, false, false), /no longer/);
  assert.equal(await ui.confirm("Timeout", "Message", { timeout: 1 }), false);
  const cancellation = new AbortController();
  const input = ui.input("Input", "Hint", { signal: cancellation.signal });
  cancellation.abort();
  assert.equal(await input, undefined);
  assert.equal(dialogs.visible.length, 0);
  const remaining = ui.input("Pending");
  restore();
  assert.equal(await remaining, undefined);
  assert.ok(changes() >= 8);
});
