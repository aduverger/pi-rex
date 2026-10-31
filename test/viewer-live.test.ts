import assert from "node:assert/strict";
import { mkdir, readFile, readdir, symlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { RexControl } from "../src/control.ts";
import { viewerLabel } from "../src/bridge.ts";
import { bridgeLabel } from "../src/view-state.ts";
import { startRex } from "./fixtures/rex-server.ts";

async function until<T>(run: () => Promise<T | undefined | false>, description: string, timeout = 12000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await run();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}

test("real Pi and Rex: automatic unfocused viewer, live messages/dialogs, reload, reopen, and process exit", { timeout: 90000 }, async (t) => {
  const lab = await startRex(t);
  if (!lab) return;
  const installation = join(lab.directory, "node_modules", "@aduverger", "pi-rex");
  await mkdir(installation, { recursive: true });
  const { stdout } = await promisify(execFile)("npm", ["pack", "--dry-run=false", "--ignore-scripts", "--json", "--pack-destination", lab.directory], { env: { ...process.env, npm_config_cache: resolve(".npm-cache") } });
  await promisify(execFile)("tar", ["-xzf", join(lab.directory, JSON.parse(stdout)[0].filename), "-C", installation, "--strip-components=1"]);
  for (const dependency of ["@earendil-works", "jiti", "ws"]) await symlink(resolve("node_modules", dependency), join(lab.directory, "node_modules", dependency));
  const agentDir = join(lab.directory, "agent");
  await mkdir(agentDir);
  const pidFile = join(lab.directory, "pi.pid");
  const command = ["/usr/bin/env", `PI_CODING_AGENT_DIR=${agentDir}`, `PIREX_TEST_PID_FILE=${pidFile}`, "PI_TELEMETRY=0", process.execPath,
    resolve("node_modules/@earendil-works/pi-coding-agent/dist/cli.js"), "--no-extensions", "-e", join(installation, "src/index.ts"), "-e", resolve("test/fixtures/viewer-agent.ts"),
    "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-approve", "--provider", "pirex-test", "--model", "test", "--name", "Fixture agent", "--use-theme", "dark"];
  const created = await lab.control.request<{ session_id: string }>("session.create", { label: "Viewer integration", initial_windows: [{ window_label: "Pi", layout: { block: { flavor: "com.superlogical.terminal.shell", options: { shell: "none", command, cwd: lab.directory } } } }] });
  const session = created.session_id;
  await lab.control.request("session.attach", { session_id: session });
  const blocks = async () => (await lab.control.request<{ blocks: { block_id: string; label: string; window_id: string }[] }>("session.list_blocks", { session_id: session })).blocks;
  const source = (await blocks())[0];
  const capture = async (block: string) => (await lab.control.request<{ content: string }>("com.superlogical.terminal.format", { session_id: session, block_id: block, args: { format: "text" } })).content;
  const type = async (block: string, text: string) => lab.control.request("com.superlogical.terminal.write", { session_id: session, block_id: block, args: { data: text } });
  let pid: number;
  try {
    pid = Number(await until(async () => { try { return await readFile(pidFile, "utf8"); } catch { return undefined; } }, "Pi fixture startup"));
  } catch (error) { throw new Error(`${error}\n${await capture(source.block_id)}`); }
  const clients = async () => (await lab.control.request<{ clients: { client_id: string; info?: { label?: string } }[] }>("client.list", { session_id: session })).clients;
  await until(async () => (await clients()).find((client) => client.info?.label === bridgeLabel(pid)), "Pi bridge registration");
  assert.equal((await blocks()).length, 1, "desktop startup must not create a viewer");
  const ios = new RexControl();
  await ios.connect(lab.endpoint, "test-ios", { kind: "app", platform: "ios" });
  t.after(() => ios.close());
  await ios.request("session.attach", { session_id: session });
  await delay(200);
  assert.equal((await blocks()).length, 1, "an attached phone without ownership must not open the viewer");
  const originalView = await lab.control.request<{ active_window_id: string }>("session.view", { session_id: session });
  await ios.request("session.own_block", { session_id: session, block_ids: [source.block_id] });
  let viewer = await until(async () => (await blocks()).find((block) => block.label === viewerLabel(pid)), "automatic viewer creation");
  const view = await lab.control.request<{ active_window_id: string }>("session.view", { session_id: session });
  assert.equal(view.active_window_id, originalView.active_window_id, "creating the viewer must not switch tabs");
  await until(async () => (await capture(viewer.block_id)).includes("Fixture agent"), "viewer attachment").catch(async (error) => {
    throw new Error(`${error}\nViewer:\n${await capture(viewer.block_id)}\nPi:\n${await capture(source.block_id)}\nClients: ${JSON.stringify(await clients())}\nProcess: ${JSON.stringify(await lab.control.request("com.superlogical.terminal.process", { session_id: session, block_id: viewer.block_id, args: {} }))}`);
  });
  const bridge = (await clients()).find((client) => client.info?.label === bridgeLabel(pid))!;
  await assert.rejects(lab.control.performClient(bridge.client_id, "pirex.attach", { sourceBlock: source.block_id, sourcePid: pid, viewerBlock: viewer.block_id }), /not the viewer block's process/);
  await type(viewer.block_id, "hello fixture\r");
  await until(async () => (await capture(viewer.block_id)).includes("Local reply: hello fixture"), "viewer send and streamed reply");
  assert.match(await capture(source.block_id), /hello fixture/);
  const click = async (label: string) => {
    const lines = (await capture(viewer.block_id)).split("\n");
    const y = lines.findIndex((line) => line.includes(label));
    assert.ok(y >= 0, `Missing ${label}: ${lines.join("\n")}`);
    const x = lines[y].indexOf(label) + 2;
    await type(viewer.block_id, `\x1b[<0;${x};${y + 1}M\x1b[<0;${x};${y + 1}m`);
  };
  const idle = () => until(async () => (await capture(viewer.block_id)).split("\n")[0].includes("· idle"), "Pi settled");
  await idle();
  await type(viewer.block_id, "/model\r");
  await until(async () => (await capture(viewer.block_id)).includes("terminal-only slash command"), "unsupported built-in rejected explicitly");
  await type(viewer.block_id, "\x01\x0b");
  await type(viewer.block_id, "/fixture-notice\r");
  await until(async () => (await capture(viewer.block_id)).includes("error: Fixture notification"), "extension notification mirrored");
  for (const delivery of ["Steer", "Follow-up"] as const) {
    await type(viewer.block_id, `slow initial ${delivery}\r`);
    await until(async () => (await capture(viewer.block_id)).split("\n")[0].includes("· working"), "streaming response");
    const prompt = `queued ${delivery}`;
    await type(viewer.block_id, prompt);
    await click(`[ ${delivery} ]`);
    await until(async () => (await capture(viewer.block_id)).includes(`Local reply: ${prompt}`), `${delivery} delivered`);
    await idle();
  }
  await type(viewer.block_id, "slow interrupted response\r");
  await until(async () => (await capture(viewer.block_id)).split("\n")[0].includes("· working"), "response to abort");
  await click("[ Stop ]");
  await idle();
  for (const kind of ["confirm", "select", "input", "editor"] as const) {
    await type(viewer.block_id, `/fixture-${kind}\r`);
    await until(async () => (await capture(viewer.block_id)).includes(`Fixture ${kind === "confirm" ? "confirmation" : kind === "select" ? "selection" : kind}`), `${kind} dialog on mobile`);
    if (kind === "input") await type(viewer.block_id, "Mobile answer");
    await type(viewer.block_id, "\r");
    const expected = kind === "confirm" ? "true" : kind === "select" ? "One" : kind === "input" ? "Mobile answer" : "Prefilled answer";
    await until(async () => (await capture(viewer.block_id)).includes(`Answered ${kind}: ${expected}`), `${kind} answer resolved in Pi`);
  }
  await type(viewer.block_id, "/fixture-confirm\r");
  await until(async () => (await capture(viewer.block_id)).includes("Fixture confirmation"), "native answer mirrored to mobile");
  await type(source.block_id, "\r");
  await until(async () => !(await capture(viewer.block_id)).includes("Fixture confirmation"), "native answer closes mobile dialog");
  await type(viewer.block_id, "tool fixture\r");
  await until(async () => (await capture(viewer.block_id)).includes("6 tool calls"), "grouped tools");
  await until(async () => (await capture(viewer.block_id)).split("\n")[0].includes("· idle"), "tools and final reply settled");
  const beforeReload = viewer.block_id;
  const oldClients = new Set((await clients()).map((client) => client.client_id));
  await type(source.block_id, "/reload\r");
  await until(async () => (await clients()).some((client) => client.info?.label === bridgeLabel(pid) && !oldClients.has(client.client_id)), "bridge after reload").catch(async (error) => {
    throw new Error(`${error}\nPi:\n${await capture(source.block_id)}\nViewer:\n${await capture(viewer.block_id)}`);
  });
  await delay(1500);
  assert.equal((await blocks()).filter((block) => block.label === viewerLabel(pid)).length, 1);
  assert.equal((await blocks()).find((block) => block.label === viewerLabel(pid))?.block_id, beforeReload);
  await type(viewer.block_id, "after reload\r");
  await until(async () => (await capture(viewer.block_id)).includes("Local reply: after reload"), "viewer reconnect after reload");
  await idle();
  const sessionsDir = join(agentDir, "sessions");
  const originalFile = join(sessionsDir, (await readdir(sessionsDir, { recursive: true })).find((path) => path.endsWith(".jsonl"))!);
  const switchSession = async (command: string) => {
    const previous = new Set((await clients()).map((client) => client.client_id));
    await type(source.block_id, `${command}\r`);
    await until(async () => (await clients()).some((client) => client.info?.label === bridgeLabel(pid) && !previous.has(client.client_id)), command);
    await delay(1300);
    assert.equal((await blocks()).find((block) => block.label === viewerLabel(pid))?.block_id, viewer.block_id);
  };
  await type(viewer.block_id, "Draft before fork");
  await switchSession("/fixture-fork");
  assert.doesNotMatch(await capture(viewer.block_id), /Draft before fork/);
  await type(viewer.block_id, "fork reply\r");
  await until(async () => (await capture(viewer.block_id)).includes("Local reply: fork reply"), "forked conversation");
  await idle();
  await switchSession(`/fixture-resume ${originalFile}`);
  assert.match(await capture(viewer.block_id), /Draft before fork/);
  await type(viewer.block_id, "\r");
  await until(async () => (await capture(viewer.block_id)).includes("Local reply: Draft before fork"), "resumed conversation and retained draft");
  await idle();
  await switchSession("/new");
  assert.doesNotMatch(await capture(viewer.block_id), /Draft before fork|after reload/);
  await type(viewer.block_id, "new conversation\r");
  await until(async () => (await capture(viewer.block_id)).includes("Local reply: new conversation"), "new conversation");
  await idle();
  await lab.control.request("block.close", { session_id: session, block_id: viewer.block_id });
  await delay(1300);
  assert.equal((await blocks()).length, 1, "manual close must not respawn the viewer");
  process.kill(pid, 0);
  await type(source.block_id, "/reload\r");
  await delay(2000);
  assert.equal((await blocks()).length, 1, "reload must respect an intentionally closed viewer");
  await lab.control.request("session.own_block", { session_id: session, block_ids: [source.block_id] });
  await delay(200);
  await ios.request("session.own_block", { session_id: session, block_ids: [source.block_id] });
  viewer = await until(async () => (await blocks()).find((block) => block.label === viewerLabel(pid)), "viewer recreated on another iOS handoff");
  assert.notEqual(viewer.block_id, beforeReload);
  await until(async () => (await capture(viewer.block_id)).includes("Local reply: new conversation"), "new viewer attached");
  await lab.control.request("block.close", { session_id: session, block_id: viewer.block_id });
  await type(source.block_id, "/rex-view\r");
  viewer = await until(async () => (await blocks()).find((block) => block.label === viewerLabel(pid)), "manual reopen");
  await lab.control.request("block.close", { session_id: session, block_id: source.block_id });
  await until(async () => (await blocks()).length === 0, "Pi exit closes the viewer");
});
