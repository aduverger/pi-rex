import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { DefaultPackageManager, getPackageDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { RexControl } from "../src/control.ts";
import { viewerLabel } from "../src/bridge.ts";
import { bridgeLabel } from "../src/view-state.ts";
import { startRex } from "./fixtures/rex-server.ts";

interface AgentState { pid: number; sessionId: string; sessionFile?: string; name: string; toolsExpanded: boolean; compacting: boolean }

async function until<T>(run: () => Promise<T | undefined | false>, description: string, timeout = 12000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await run();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}

async function installPackedViewer(directory: string) {
  const agentDir = join(directory, "agent");
  await mkdir(agentDir);
  const { stdout } = await promisify(execFile)("npm", ["pack", "--dry-run=false", "--ignore-scripts", "--json", "--pack-destination", directory], { env: { ...process.env, npm_config_cache: resolve(".npm-cache") } });
  const packageSource = `npm:@aduverger/pi-rex@file:${join(directory, JSON.parse(stdout)[0].filename)}`;
  const packages = new DefaultPackageManager({ cwd: directory, agentDir, settingsManager: SettingsManager.inMemory({ npmCommand: ["npm", "--dry-run=false", "--prefer-offline", "--cache", resolve(".npm-cache")] }) });
  await packages.install(packageSource);
  const installation = packages.getInstalledPath(packageSource, "user");
  assert.ok(installation);
  await assert.rejects(access(join(dirname(dirname(installation)), "@earendil-works")), { code: "ENOENT" });
  assert.throws(() => createJiti(join(installation, "src/viewer.ts")).esmResolve("@earendil-works/pi-coding-agent"), "the viewer must not find a physical Pi peer through its installation ancestry");
  return { agentDir, installation };
}

test("Pi-managed viewer bootstrap imports host exports without physical Pi peers or Rex", { timeout: 60000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pirex-package-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { installation } = await installPackedViewer(directory);
  const alias = {
    "@earendil-works/pi-coding-agent": fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
    "@earendil-works/pi-tui": fileURLToPath(import.meta.resolve("@earendil-works/pi-tui")),
  };
  const bootstrap = join(installation, "src/viewer-bootstrap.mjs");
  // Missing source flags stop main before terminal setup; this probe checks imports only.
  const probe = `process.argv = [process.execPath, ${JSON.stringify(bootstrap)}, ${JSON.stringify(JSON.stringify(alias))}];
    await import(${JSON.stringify(pathToFileURL(bootstrap).href)});
    process.exitCode = 0;`;
  await promisify(execFile)(process.execPath, ["--input-type=module", "--eval", probe]);
});

test("real Pi and Rex: automatic unfocused viewer, live messages/dialogs, reload, reopen, and process exit", { timeout: 90000 }, async (t) => {
  const lab = await startRex(t);
  if (!lab) return;
  const { agentDir, installation } = await installPackedViewer(lab.directory);
  const hostPackage = JSON.parse(await readFile(join(getPackageDir(), "package.json"), "utf8"));
  const piCli = join(getPackageDir(), hostPackage.bin.pi);
  const stateFile = join(lab.directory, "pi-state.json");
  const editorMarker = join(lab.directory, "editor-used.txt");
  const editorCommand = async (name: string) => {
    const script = join(lab.directory, `${name}-editor.mjs`);
    await writeFile(script, `import {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(editorMarker)}, ${JSON.stringify(name)}); writeFileSync(process.argv.at(-1), ${JSON.stringify(`Edited by ${name} editor`)});`);
    return `${process.execPath} ${script}`;
  };
  const configuredEditor = await editorCommand("configured");
  const environmentEditor = await editorCommand("environment");
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ externalEditor: configuredEditor, compaction: { enabled: false, keepRecentTokens: 0 } }));
  const compactionRelease = join(lab.directory, "release-compaction");
  const readState = async (): Promise<AgentState | undefined> => {
    try { return JSON.parse(await readFile(stateFile, "utf8")); } catch { return undefined; }
  };
  const command = ["/usr/bin/env", `PI_CODING_AGENT_DIR=${agentDir}`, `PIREX_TEST_STATE_FILE=${stateFile}`, `PIREX_TEST_COMPACTION_RELEASE=${compactionRelease}`, `VISUAL=${environmentEditor}`, `EDITOR=${environmentEditor}`, "PI_TELEMETRY=0", process.execPath,
    piCli, "--no-extensions", "-e", join(installation, "src/index.ts"), "-e", resolve("test/fixtures/viewer-agent.ts"),
    "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-approve", "--provider", "pirex-test", "--model", "test", "--use-theme", "dark"];
  const created = await lab.control.request<{ session_id: string }>("session.create", { label: "Viewer integration", initial_windows: [{ window_label: "Pi", layout: { block: { flavor: "com.superlogical.terminal.shell", options: { shell: "none", command, cwd: lab.directory } } } }] });
  const session = created.session_id;
  await lab.control.request("session.attach", { session_id: session });
  const blocks = async () => (await lab.control.request<{ blocks: { block_id: string; label: string; window_id: string }[] }>("session.list_blocks", { session_id: session })).blocks;
  const source = (await blocks())[0];
  const capture = async (block: string) => (await lab.control.request<{ content: string }>("com.superlogical.terminal.format", { session_id: session, block_id: block, args: { format: "text" } })).content;
  const type = async (block: string, text: string) => lab.control.request("com.superlogical.terminal.write", { session_id: session, block_id: block, args: { data: text } });
  let initialState: AgentState;
  try { initialState = await until(readState, "Pi fixture startup"); }
  catch (error) { throw new Error(`${error}\n${await capture(source.block_id)}`); }
  const pid = initialState.pid;
  const clients = async () => (await lab.control.request<{ clients: { client_id: string; info?: { label?: string } }[] }>("client.list", { session_id: session })).clients;
  await until(async () => (await clients()).find((client) => client.info?.label === bridgeLabel(pid)), "Pi bridge registration");
  assert.equal((await blocks()).length, 1, "desktop startup must not create a viewer");
  await until(async () => (await capture(source.block_id)).includes("─"), "Pi input ready");
  await type(source.block_id, "/fixture-editor\r");
  await until(async () => (await capture(source.block_id)).includes("Prefilled answer"), "desktop standard editor");
  await type(source.block_id, "\x07");
  const usedEditor = await until(async () => { try { return await readFile(editorMarker, "utf8"); } catch { return undefined; } }, "external editor executed");
  assert.equal(usedEditor, "configured", "Pi's configured editor must take precedence over VISUAL/EDITOR");
  await until(async () => (await capture(source.block_id)).includes("Edited by configured editor"), "native editor received external edits");
  await type(source.block_id, "\r");
  await until(async () => (await capture(source.block_id)).includes("Answered editor: Edited by configured editor"), "desktop editor returned its value");
  assert.equal((await blocks()).length, 1, "desktop editor behavior must not require a viewer");
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
  const waitForViewer = (state: AgentState) => until(async () => (await capture(viewer.block_id)).split("\n")[0].includes(state.name), "viewer received the current Pi snapshot");
  await waitForViewer(initialState).catch(async (error) => {
    throw new Error(`${error}\nViewer:\n${await capture(viewer.block_id)}\nPi:\n${await capture(source.block_id)}\nClients: ${JSON.stringify(await clients())}\nProcess: ${JSON.stringify(await lab.control.request("com.superlogical.terminal.process", { session_id: session, block_id: viewer.block_id, args: {} }))}`);
  });
  const bridge = (await clients()).find((client) => client.info?.label === bridgeLabel(pid))!;
  await assert.rejects(lab.control.performClient(bridge.client_id, "pirex.attach", { sourceBlock: source.block_id, sourcePid: pid, viewerBlock: viewer.block_id }), /not the viewer block's process/);
  await type(viewer.block_id, "hello fixture\r");
  await until(async () => (await capture(viewer.block_id)).includes("Local reply: hello fixture"), "viewer send and streamed reply");
  assert.match(await capture(source.block_id), /hello fixture/);
  const click = async (label: string) => {
    const lines = (await capture(viewer.block_id)).split("\n");
    const y = lines.findLastIndex((line) => line.includes(label));
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
  await type(source.block_id, "/compact\r");
  await until(async () => (await readState())?.compacting, "manual compaction entered its public hook");
  await until(async () => (await capture(viewer.block_id)).split("\n")[0].includes("· working"), "viewer observed compaction");
  await type(viewer.block_id, "blocked during compaction");
  await click("Steer");
  await until(async () => (await capture(viewer.block_id)).includes("Pi is compacting"), "compaction rejection visible on mobile");
  assert.match(await capture(viewer.block_id), /blocked during compaction/);
  await writeFile(compactionRelease, "");
  await idle();
  await type(viewer.block_id, "\x01\x0b");
  await type(viewer.block_id, "/fixture-throw\r");
  await until(async () => (await capture(source.block_id)).includes("Fixture command failure"), "Pi reported the throwing command through its error channel");
  await until(async () => (await capture(viewer.block_id)).includes("acceptance unconfirmed"), "dispatch did not claim command acceptance");
  await click("Submission recovery");
  await until(async () => (await capture(viewer.block_id)).includes("/fixture-throw"), "rejected command text remains visibly recoverable");
  await type(viewer.block_id, "\x01\x0b");
  for (const delivery of ["Steer", "Follow-up"] as const) {
    await type(viewer.block_id, `slow initial ${delivery}\r`);
    await until(async () => (await capture(viewer.block_id)).split("\n")[0].includes("· working"), "streaming response");
    const prompt = `queued ${delivery}`;
    await type(viewer.block_id, prompt);
    await click(delivery);
    await until(async () => (await capture(viewer.block_id)).includes(`Local reply: ${prompt}`), `${delivery} delivered`);
    await idle();
  }
  await type(viewer.block_id, "slow interrupted response\r");
  await until(async () => (await capture(viewer.block_id)).split("\n")[0].includes("· working"), "response to abort");
  await click("Stop");
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
  const restartSource = async (command: string, viewerOpen = true) => {
    const before = await until(readState, "current source session");
    const previousClients = new Set((await clients()).map((client) => client.client_id));
    await type(source.block_id, `${command}\r`);
    const state = await until(async () => { const current = await readState(); return current && current.name !== before.name ? current : undefined; }, command);
    await until(async () => (await clients()).some((client) => client.info?.label === bridgeLabel(pid) && !previousClients.has(client.client_id)), "replacement Pi bridge");
    if (viewerOpen) {
      await waitForViewer(state);
      const viewers = (await blocks()).filter((block) => block.label === viewerLabel(pid));
      assert.equal(viewers.length, 1);
      assert.equal(viewers[0].block_id, beforeReload);
    }
    return state;
  };
  const reloaded = await restartSource("/reload").catch(async (error) => {
    throw new Error(`${error}\nPi:\n${await capture(source.block_id)}\nViewer:\n${await capture(viewer.block_id)}`);
  });
  assert.equal(reloaded.sessionId, initialState.sessionId);
  await type(viewer.block_id, "after reload\r");
  await until(async () => (await capture(viewer.block_id)).includes("Local reply: after reload"), "viewer reconnect after reload");
  await idle();
  assert.ok(initialState.sessionFile, "the fixture must use a saved Pi session");
  const originalFile = initialState.sessionFile;
  await type(viewer.block_id, "Draft before fork");
  const forked = await restartSource("/fixture-fork");
  assert.notEqual(forked.sessionId, initialState.sessionId);
  assert.doesNotMatch(await capture(viewer.block_id), /Draft before fork/);
  await type(viewer.block_id, "fork reply\r");
  await until(async () => (await capture(viewer.block_id)).includes("Local reply: fork reply"), "forked conversation");
  await idle();
  const resumed = await restartSource(`/fixture-resume ${originalFile}`);
  assert.equal(resumed.sessionId, initialState.sessionId);
  assert.match(await capture(viewer.block_id), /Draft before fork/);
  await type(viewer.block_id, "\r");
  await until(async () => (await capture(viewer.block_id)).includes("Local reply: Draft before fork"), "resumed conversation and retained draft");
  await idle();
  const newSession = await restartSource("/new");
  assert.notEqual(newSession.sessionId, initialState.sessionId);
  assert.doesNotMatch(await capture(viewer.block_id), /Draft before fork|after reload/);
  await type(viewer.block_id, "new conversation\r");
  await until(async () => (await capture(viewer.block_id)).includes("Local reply: new conversation"), "new conversation");
  await idle();
  await lab.control.request("block.close", { session_id: session, block_id: viewer.block_id });
  await delay(1300);
  assert.equal((await blocks()).length, 1, "manual close must not respawn the viewer");
  process.kill(pid, 0);
  await restartSource("/reload", false);
  await delay(2000);
  assert.equal((await blocks()).length, 1, "reload must respect an intentionally closed viewer");
  await lab.control.request("session.own_block", { session_id: session, block_ids: [source.block_id] });
  await until(async () => {
    await rm(stateFile, { force: true });
    await type(source.block_id, "/fixture-state\r");
    return (await until(readState, "public Pi UI state")).toolsExpanded;
  }, "desktop restored the pre-mobile expansion preference");
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
