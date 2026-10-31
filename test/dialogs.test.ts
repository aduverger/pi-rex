import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Dialogs } from "../src/dialogs.ts";

function setup() {
  const local: { resolve: (value: unknown) => void; signal?: AbortSignal }[] = [];
  const ask = (...args: unknown[]) => new Promise((resolve) => { local.push({ resolve, signal: (args.at(-1) as { signal?: AbortSignal })?.signal }); });
  const ui = { select: ask, confirm: ask, input: ask, editor: ask, custom: ask, notify() {} } as unknown as ExtensionUIContext;
  const dialogs = new Dialogs(() => {}, () => undefined);
  const restore = dialogs.install(ui);
  return { ui, local, dialogs, restore };
}

test("standard dialogs accept only valid mobile answers, cancel native UI, and ignore its later answer", async () => {
  const { ui, local, dialogs, restore } = setup();
  const cases = [
    { ask: (ui: ExtensionUIContext) => ui.select("Choose", ["One", "Two"]), invalid: [true, "Other"], remote: "Two", late: "One" },
    { ask: (ui: ExtensionUIContext) => ui.confirm("Allow action?", "Details"), invalid: ["true", 1], remote: true, late: false },
  ];
  for (const example of cases) {
    const pending = example.ask(ui);
    await delay(0);
    const native = local.at(-1)!;
    const id = dialogs.visible[0].id;
    for (const invalid of example.invalid) {
      assert.throws(() => dialogs.answer(id, invalid, false));
      assert.equal(dialogs.visible.length, 1, "invalid input must not consume the pending dialog");
    }
    dialogs.answer(id, example.remote, false);
    assert.equal(await pending, example.remote);
    assert.equal(native.signal?.aborted, true);
    native.resolve(example.late);
    await delay(0);
    assert.equal(dialogs.visible.length, 0);
    assert.throws(() => dialogs.answer(id, example.late, false));
  }
  restore();
  for (const ask of [() => ui.select("Native selector", ["Native answer"]), () => ui.editor("Native editor")]) {
    const answer = ask();
    assert.equal(dialogs.visible.length, 0, "restored UI must not publish another mobile dialog");
    await delay(0);
    local.at(-1)!.resolve("Native answer");
    assert.equal(await answer, "Native answer");
  }
});

test("native answers win, timeout and external cancellation remove dialogs, and shutdown restores pending callers", async () => {
  const { ui, local, dialogs, restore } = setup();
  const native = ui.confirm("Continue?", "Message");
  await delay(0);
  const nativeId = dialogs.visible[0].id;
  local[0].resolve(true);
  assert.equal(await native, true);
  assert.throws(() => dialogs.answer(nativeId, false, false));
  assert.equal(await ui.confirm("Timeout", "Message", { timeout: 1 }), false);
  const cancellation = new AbortController();
  const input = ui.input("Input", "Hint", { signal: cancellation.signal });
  cancellation.abort();
  assert.equal(await input, undefined);
  assert.equal(dialogs.visible.length, 0);
  const remaining = ui.input("Pending");
  restore();
  assert.equal(await remaining, undefined);
  assert.equal(dialogs.visible.length, 0);
});

test("restoring UI preserves a later extension's replacement", async () => {
  const { ui, local, dialogs, restore } = setup();
  ui.input = async () => "Other extension answer";
  restore();
  const answer = ui.input("After shutdown");
  await delay(0);
  for (const request of local) request.resolve("Original UI answer");
  assert.equal(await answer, "Other extension answer");
  assert.equal(dialogs.visible.length, 0);
});
