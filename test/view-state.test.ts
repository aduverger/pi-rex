import assert from "node:assert/strict";
import { test } from "node:test";
import { readView, ViewCommands, ViewReads } from "../src/view-state.ts";

test("chunked reads preserve large Unicode/control text, obey Rex's minimum message limit, and isolate parallel details", async () => {
  const reads = new ViewReads();
  const value = { text: '👩‍💻中文\u0000\u001b"\\'.repeat(20000) };
  let pages = 0;
  const result = await readView(async (args) => {
    const page = reads.read("viewer:view", args, () => value);
    assert.ok(Buffer.byteLength(JSON.stringify({ type: "response", payload: { result: page } })) < 65536 - 2048);
    const detail = reads.read("viewer:detail:other", {}, () => ({ args: { path: "independent" }, content: [] }));
    assert.match(detail.text, /independent/);
    pages++;
    return page;
  }, {});
  assert.deepEqual(result, value);
  assert.ok(pages > 10);
  assert.throws(() => reads.read("viewer:view", { readId: "expired", offset: 0 }, () => null), /expired/);
  const first = reads.read("viewer:view", {}, () => value);
  assert.throws(() => reads.read("viewer:view", { readId: first.id, offset: -1 }, () => null), /offset/);
  reads.clear();
  assert.throws(() => reads.read("viewer:view", { readId: first.id, offset: first.next }, () => null), /expired/);
});

test("command IDs preserve successful and rejected outcomes instead of repeating uncertain side effects", async () => {
  const commands = new ViewCommands();
  const args = { id: "same-request", generation: "same-pi", kind: "prompt", text: "one message" };
  let runs = 0;
  const run = () => { runs++; return { submitted: true }; };
  const original = commands.execute(args, run);
  assert.equal(commands.execute({ ...args }, run), original);
  assert.deepEqual(await original, { submitted: true });
  assert.deepEqual(await commands.execute(args, run), { submitted: true });
  assert.equal(runs, 1);
  assert.throws(() => commands.execute({ ...args, text: "different" }, run), /different input/);
  const rejected = { ...args, id: "rejected" };
  await assert.rejects(commands.execute(rejected, () => { runs++; throw new Error("stale generation"); }), /stale/);
  await assert.rejects(commands.execute(rejected, run), /stale/);
  assert.equal(runs, 2);
});

test("read consumers reject a replaced snapshot or non-progressing cursor", async () => {
  let calls = 0;
  await assert.rejects(readView(async () => ++calls === 1 ? { id: "one", text: "{", next: 1 } : { id: "two", text: "}", next: null }, {}), /changed/);
  await assert.rejects(readView(async () => ({ id: "one", text: "{", next: 0 }), {}), /cursor/);
});
