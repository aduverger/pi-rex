import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { bridgeLabel, ViewCommands, ViewReads, type ViewState } from "../src/view-state.ts";
import { ViewerConnection } from "../src/viewer-connection.ts";
import { RexControl, RexError } from "../src/control.ts";
import { startRex } from "./fixtures/rex-server.ts";

test("real Rex routes registered actions and caller identity without a separate server", async (t) => {
  const lab = await startRex(t);
  if (!lab) return;
  const receiver = new RexControl();
  await receiver.connect(lab.endpoint, "pirex-receiver");
  t.after(() => receiver.close());
  receiver.onPerform = (request) => {
    assert.equal(request.requester.client_id, lab.control.id);
    assert.equal(request.requester.principal?.uid, process.getuid?.());
    return { received: request.args };
  };
  await receiver.request("client.keymap", { actions: [{ name: "pirex.echo", kind: "client", args: { type: "object" } }] });
  assert.deepEqual(await lab.control.performClient(receiver.id, "pirex.echo", { text: "中文 👩‍💻\nnext" }), { received: { text: "中文 👩‍💻\nnext" } });
  await assert.rejects(lab.control.performClient(receiver.id, "pirex.unknown"), (error: unknown) => error instanceof RexError && error.code === "not_supported");
  await assert.rejects(lab.control.request("server.version", { text: "x".repeat(lab.control.limit) }), (error: unknown) => error instanceof RexError && error.code === "too_large");
  assert.ok(await lab.control.request("server.version"));
});

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 80; attempt++) { if (predicate()) return; await delay(50); }
  assert.ok(predicate(), "condition did not settle");
}

test("real Rex transport: lost acknowledgements are not replayed, explicit retry is deduplicated, and reload invalidates uncertain commands", async (t) => {
  const lab = await startRex(t);
  if (!lab) return;
  const created = await lab.control.request<{ session_id: string }>("session.create", { label: "Uncertain commands" });
  const session = created.session_id;
  const source = new RexControl();
  await source.connect(lab.endpoint, bridgeLabel(process.pid));
  t.after(() => source.close());
  await source.request("session.attach", { session_id: session });
  await source.request("client.keymap", { actions: ["pirex.attach", "pirex.view", "pirex.command"].map((name) => ({ name, kind: "client", args: { type: "object" } })) });
  const commands = new ViewCommands();
  const reads = new ViewReads();
  let generation = "original";
  let viewer = "";
  let deliveries = 0;
  let loseAcknowledgement = true;
  source.onPerform = async (request) => {
    const args = request.args as Record<string, unknown>;
    if (request.action === "pirex.attach") { viewer = request.requester.client_id; return { generation }; }
    if (args.generation !== generation) throw new RexError("conflict", "Stale conversation generation");
    if (request.action === "pirex.view") return reads.read("view", args, (): ViewState => ({ generation, sessionId: "same-session", name: "Fixture", revision: deliveries, nodes: [], dialogs: [], busy: false, customUI: false }));
    const result = await commands.execute(args, () => { deliveries++; return { submitted: true }; });
    if (loseAcknowledgement) { loseAcknowledgement = false; throw new RexError("timeout", "Request timed out after execution; outcome uncertain"); }
    return result;
  };
  const connection = new ViewerConnection({ endpoint: lab.endpoint, session, block: "fixture-source", pid: process.pid, viewerBlock: "fixture-viewer" }, () => {}, () => {});
  const running = connection.run();
  t.after(async () => { connection.stop(); await running; });
  await waitFor(() => connection.connected && !!connection.state);
  await assert.rejects(connection.command({ kind: "prompt", text: "One prompt", delivery: "send" }));
  assert.ok(connection.uncertain);
  await delay(1100);
  assert.equal(deliveries, 1, "background recovery must not replay the prompt");
  await connection.retry();
  assert.equal(deliveries, 1);
  assert.equal(connection.uncertain, undefined);
  loseAcknowledgement = true;
  await assert.rejects(connection.command({ kind: "prompt", text: "Second prompt", delivery: "send" }));
  generation = "after-reload";
  await source.performClient(viewer, "pirex.changed", { generation, revision: deliveries });
  await waitFor(() => connection.state?.generation === generation);
  await assert.rejects(connection.retry());
  assert.ok(connection.uncertain);
  assert.equal(deliveries, 2);
  connection.dismissUncertainty();
  await connection.command({ kind: "abort" });
  assert.equal(deliveries, 3);
  source.close();
  await waitFor(() => !connection.connected);
  await assert.rejects(connection.command({ kind: "prompt", text: "Offline draft", delivery: "send" }));
  assert.equal(connection.uncertain, undefined);
  assert.equal(deliveries, 3);
});
