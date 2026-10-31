import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ConversationView } from "./conversation.ts";
import { object, RexControl, RexError, rexEndpoint, string, type PerformRequest } from "./control.ts";
import { Dialogs } from "./dialogs.ts";
import type { RexContext } from "./rex.ts";
import { bridgeLabel, ViewCommands, ViewReads, type ViewState } from "./view-state.ts";

export const viewerLabel = (pid: number) => `pi-rex-view:${pid}`;
const actions = ["pirex.attach", "pirex.view", "pirex.detail", "pirex.command"].map((name) => ({ name, kind: "client", args: { type: "object" } }));

async function viewerProcessMatches(pid: number | undefined, info: { child?: { pid: number }; foreground?: { pid: number } }): Promise<boolean> {
  if (!pid) return false;
  const roots = new Set([info.child?.pid, info.foreground?.pid]);
  if (roots.has(pid)) return true;
  const { stdout } = await promisify(execFile)("ps", ["-ax", "-o", "pid=,ppid="], { timeout: 2500, maxBuffer: 1024 * 1024 });
  const parents = new Map(stdout.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number) as [number, number]));
  const visited = new Set<number>();
  while (pid > 1 && !visited.has(pid)) {
    visited.add(pid);
    const parent = parents.get(pid);
    if (!parent) return false;
    if (roots.has(parent)) return true;
    pid = parent;
  }
  return false;
}

interface ViewerOwnership { mobile: boolean; openRequested: boolean }
const ownershipKey = Symbol.for("@aduverger/pi-rex/viewer-ownership");
const processState = globalThis as typeof globalThis & { [ownershipKey]?: Map<string, ViewerOwnership> };

export class PiBridge {
  control?: RexControl;
  generation = randomUUID();
  revision = 0;
  private ready = false;
  private ownership: ViewerOwnership;
  private endpoint = "";
  private stopped = false;
  private reconnect?: ReturnType<typeof setTimeout>;
  private flush?: ReturnType<typeof setTimeout>;
  private opening?: Promise<void>;
  private viewerClient?: string;
  private notifying = false;
  private reads = new ViewReads();
  private commands = new ViewCommands();
  private undoUI: () => void;
  readonly conversation = new ConversationView();
  readonly dialogs: Dialogs;
  private liveMessageId = randomUUID();

  constructor(pi: ExtensionAPI, rex: RexContext, context: ExtensionContext, ownership: ViewerOwnership = { mobile: false, openRequested: false }) {
    this.ownership = ownership;
    this.pi = pi;
    this.rex = rex;
    this.context = context;
    this.dialogs = new Dialogs(() => this.changed());
    this.undoUI = this.dialogs.install(context.ui);
  }
  private pi: ExtensionAPI;
  private rex: RexContext;
  private context: ExtensionContext;

  async start() {
    try {
      this.endpoint ||= await rexEndpoint(this.rex);
      if (this.stopped) return;
      const control = new RexControl();
      this.control = control;
      control.onPerform = (request) => this.handle(request);
      control.onClose = () => {
        if (this.control !== control || this.stopped) return;
        this.control = undefined;
        this.ready = false;
        this.viewerClient = undefined;
        this.reads.clear();
        this.scheduleReconnect();
      };
      await control.connect(this.endpoint, bridgeLabel(process.pid));
      if (this.stopped) { control.close(); return; }
      await control.request("session.attach", { session_id: this.rex.session });
      await control.request("client.keymap", { actions });
      this.ready = true;
      this.context.ui.setStatus("pi-rex-viewer", undefined);
      if (this.ownership.openRequested) await this.openViewer();
    } catch (error) {
      this.control?.close();
      this.control = undefined;
      this.ready = false;
      if (!this.stopped) {
        this.context.ui.setStatus("pi-rex-viewer", `Viewer unavailable: ${error instanceof Error ? error.message : "Rex error"}`);
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect() {
    if (this.reconnect || this.stopped) return;
    this.reconnect = setTimeout(() => { this.reconnect = undefined; void this.start(); }, 2000);
    this.reconnect.unref();
  }

  ownerChanged(mobile: boolean) {
    if (mobile && !this.ownership.mobile) this.ownership.openRequested = true;
    if (!mobile) this.ownership.openRequested = false;
    this.ownership.mobile = mobile;
    if (this.ownership.openRequested && this.ready) void this.openViewer().catch((error) => this.context.ui.notify(String(error), "error"));
  }

  async openViewer() {
    if (this.opening) return this.opening;
    this.opening = this.createViewer();
    try { await this.opening; this.ownership.openRequested = false; }
    finally { this.opening = undefined; }
  }

  private async createViewer() {
    const control = this.control;
    if (!this.ready || !control?.id) throw new Error("Pi viewer is waiting for Rex; try /rex-view again shortly");
    const { blocks } = await control.request<{ blocks: { block_id: string; label: string }[] }>("session.list_blocks", { session_id: this.rex.session });
    for (const block of blocks ?? []) {
      if (block.label !== viewerLabel(process.pid)) continue;
      const processInfo = await control.request<{ child?: { pid: number }; foreground?: { pid: number } }>("com.superlogical.terminal.process", { session_id: this.rex.session, block_id: block.block_id, args: {} });
      if (processInfo.foreground || processInfo.child) return;
    }
    let node = process.execPath;
    if (!/^node(?:\.exe)?$/.test(basename(node))) {
      const { stdout } = await promisify(execFile)("node", ["-p", "process.execPath"], { timeout: 2500 });
      node = stdout.trim();
    }
    const command = [node, "--import", import.meta.resolve("jiti/register"), fileURLToPath(new URL("./viewer.ts", import.meta.url)), "--server", this.endpoint, "--session", this.rex.session, "--source-block", this.rex.block, "--source-pid", String(process.pid)];
    await control.request("session.new_window", {
      session_id: this.rex.session, window_label: "Pi conversation", focus: false,
      layout: { block: { flavor: "com.superlogical.terminal.shell", label: viewerLabel(process.pid), options: {
        shell: "none", command, cwd: this.context.cwd, exit: { on_completion: true },
      } } },
    });
    this.context.ui.setStatus("pi-rex-viewer", undefined);
  }

  changed() {
    this.revision++;
    if (!this.flush && !this.stopped) {
      this.flush = setTimeout(() => { this.flush = undefined; void this.notify(); }, 100);
      this.flush.unref();
    }
  }

  private async notify() {
    const client = this.viewerClient;
    const control = this.control;
    if (!client || !control || this.notifying) return;
    const revision = this.revision;
    this.notifying = true;
    try { await control.performClient(client, "pirex.changed", { generation: this.generation, revision }); }
    catch (error) {
      if (error instanceof RexError && error.code === "timeout") this.changed();
      else if (this.viewerClient === client) this.viewerClient = undefined;
    }
    finally {
      this.notifying = false;
      if (this.revision !== revision && this.viewerClient) this.changed();
    }
  }

  private snapshot(before?: string): ViewState {
    return { generation: this.generation, revision: this.revision, sessionId: this.context.sessionManager.getSessionId(),
      name: this.pi.getSessionName() ?? "Pi", busy: !this.context.isIdle(), ...this.conversation.project(this.context, before),
      dialogs: this.dialogs.visible, customUI: this.dialogs.custom > 0, notice: this.dialogs.notice };
  }

  private async handle(request: PerformRequest): Promise<unknown> {
    const principal = request.requester.principal;
    if (principal?.kind !== "peer" || principal.uid !== process.getuid?.()) throw new RexError("refused", "Pi viewer requires the same local OS user");
    const args = object(request.args);
    if (request.action === "pirex.attach") {
      if (args.sourceBlock !== this.rex.block || args.sourcePid !== process.pid) throw new Error("Wrong source Pi process");
      const block = string(args.viewerBlock);
      const info = await this.control!.request<{ foreground?: { pid: number }; child?: { pid: number } }>("com.superlogical.terminal.process", { session_id: this.rex.session, block_id: block, args: {} });
      if (!await viewerProcessMatches(principal.pid, info)) throw new RexError("refused", "Caller is not the viewer block's process");
      const { blocks } = await this.control!.request<{ blocks: { block_id: string; label: string }[] }>("session.list_blocks", { session_id: this.rex.session });
      if (!blocks.some((value) => value.block_id === block && value.label === viewerLabel(process.pid))) throw new RexError("refused", "Block is not this Pi's viewer");
      if (this.viewerClient !== request.requester.client_id) this.reads.clear();
      this.viewerClient = request.requester.client_id;
      this.changed();
      return { generation: this.generation, sessionId: this.context.sessionManager.getSessionId(), sourcePid: process.pid };
    }
    if (request.requester.client_id !== this.viewerClient) throw new RexError("refused", "Attach this viewer first");
    if (args.generation !== this.generation) throw new RexError("conflict", "Pi session changed; refresh before sending");
    if (request.action === "pirex.view") return this.reads.read(`${this.viewerClient}:view:${args.before ?? ""}`, args, () => this.snapshot(typeof args.before === "string" ? args.before : undefined));
    if (request.action === "pirex.detail") return this.reads.read(`${this.viewerClient}:detail:${args.toolId}`, args, () => {
      this.conversation.project(this.context);
      return this.conversation.detail(string(args.toolId));
    });
    if (request.action !== "pirex.command") throw new RexError("not_supported", "Unknown Pi action");
    return this.commands.execute(args, () => {
      if (this.stopped || args.generation !== this.generation) throw new Error("Pi session changed");
      if (args.kind === "abort") this.context.abort();
      else if (args.kind === "answer") this.dialogs.answer(string(args.dialogId), args.value, args.cancelled === true);
      else if (args.kind === "prompt") {
        const text = string(args.text);
        if (!text.trim()) throw new Error("Empty prompt");
        if (this.dialogs.visible.length || this.dialogs.custom) throw new Error("Answer the pending dialog first");
        if (!["send", "steer", "followUp"].includes(string(args.delivery))) throw new Error("Invalid prompt delivery");
        if (!this.context.isIdle() && args.delivery === "send") throw new Error("Pi is running: choose Steer or Follow-up");
        if (text.startsWith("/") && !this.pi.getCommands().some((command) => text.slice(1).split(/\s/)[0] === command.name)) {
          throw new Error("That terminal-only slash command is not supported in this viewer");
        }
        this.dialogs.notice = undefined;
        this.pi.sendUserMessage(text, { expandPromptTemplates: true,
          ...(!this.context.isIdle() ? { deliverAs: args.delivery as "steer" | "followUp" } : {}) });
      } else throw new Error("Unknown Pi command");
      this.changed();
      return { submitted: true };
    });
  }

  message(type: string, event: unknown) {
    if (type === "message_start") this.liveMessageId = randomUUID();
    if (type === "message_start" || type === "message_update") this.conversation.updateMessage(object(event).message, this.liveMessageId);
    if (type === "message_end" || type === "agent_settled") this.conversation.endMessage();
    if (type.startsWith("tool_execution_")) this.conversation.updateTool(event as Parameters<ConversationView["updateTool"]>[0]);
    this.changed();
  }

  stop() {
    this.stopped = true;
    this.ready = false;
    clearTimeout(this.reconnect);
    clearTimeout(this.flush);
    this.undoUI();
    this.control?.close();
    this.context.ui.setStatus("pi-rex-viewer", undefined);
    this.reads.clear();
  }
}

export function registerViewer(pi: ExtensionAPI, rex: RexContext): (mobile: boolean) => void {
  let bridge: PiBridge | undefined;
  const states = processState[ownershipKey] ??= new Map();
  const key = `${rex.session}:${rex.block}`;
  const ownership = states.get(key) ?? { mobile: false, openRequested: false };
  states.set(key, ownership);
  const startBridge = (_event: unknown, ctx: ExtensionContext) => {
    bridge?.stop();
    bridge = undefined;
    if (ctx.mode !== "tui") return;
    bridge = new PiBridge(pi, rex, ctx, ownership);
    void bridge.start();
  };
  pi.on("session_start", startBridge);
  pi.on("session_tree", startBridge);
  pi.on("session_shutdown", () => { bridge?.stop(); bridge = undefined; });
  const forward = (event: { type: string }) => bridge?.message(event.type, event);
  pi.on("message_start", forward);
  pi.on("message_update", forward);
  pi.on("message_end", forward);
  pi.on("agent_start", forward);
  pi.on("agent_end", forward);
  pi.on("agent_settled", forward);
  pi.on("tool_execution_start", forward);
  pi.on("tool_execution_update", forward);
  pi.on("tool_execution_end", forward);
  pi.on("session_compact", forward);
  pi.on("session_info_changed", forward);
  pi.registerCommand("rex-view", { description: "Open or reuse the conversation viewer without switching tabs", handler: async (_args, ctx) => {
    if (!bridge || ctx.mode !== "tui") { ctx.ui.notify("The viewer requires Pi TUI mode inside Rex", "error"); return; }
    try { await bridge.openViewer(); } catch (error) { ctx.ui.notify(String(error), "error"); }
  } });
  return (next) => bridge?.ownerChanged(next);
}
