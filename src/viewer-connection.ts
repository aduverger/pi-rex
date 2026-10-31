import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { bridgeLabel } from "./view-state.ts";
import { object, RexControl, string } from "./control.ts";
import { parseView, readView, type ReadPage, type ViewDetail, type ViewState } from "./view-state.ts";

export interface ViewerSource { endpoint: string; session: string; block: string; pid: number; viewerBlock: string }
export class ViewerConnection {
  state?: ViewState;
  connected = false;
  status = "Connecting to Pi…";
  uncertain?: Record<string, unknown>;
  private control?: RexControl;
  private sourceClient = "";
  private generation = "";
  private stopped = false;
  private dirty = false;
  private refreshing = false;
  private onState: (state: ViewState) => void;
  private onStatus: () => void;
  private source: ViewerSource;

  constructor(source: ViewerSource, onState: (state: ViewState) => void, onStatus: () => void) {
    this.source = source;
    this.onState = onState;
    this.onStatus = onStatus;
  }

  async run() {
    while (!this.stopped) {
      try {
        if (!this.control) {
          const control = new RexControl();
          this.control = control;
          control.onClose = () => { if (this.control === control) { this.control = undefined; this.offline(); } };
          control.onPerform = (request) => {
            if (request.action !== "pirex.changed" || request.requester.client_id !== this.sourceClient) throw new Error("Unknown viewer callback");
            this.dirty = true;
            queueMicrotask(() => { void this.refresh(); });
            return { received: true };
          };
          control.events.add((event) => {
            if (event.type !== "session_event") return;
            const inner = object(object(event.payload).event);
            if (inner.type === "client_disconnected" && object(inner.payload).client_id === this.sourceClient) this.offline();
          });
          await control.connect(this.source.endpoint, `pi-rex-view:${process.pid}`);
          await control.request("session.attach", { session_id: this.source.session });
          await control.request("client.keymap", { actions: [{ name: "pirex.changed", kind: "client", args: { type: "object" } }] });
        }
        if (!this.connected) await this.attach();
      } catch (error) {
        if (this.control && !this.control.id) { this.control.close(); this.control = undefined; }
        this.offline(error instanceof Error ? error.message : "Pi unavailable");
      }
      await delay(1000);
    }
  }

  private async attach() {
    const control = this.control!;
    const response = await control.request<{ clients: { client_id: string; info?: { label?: string }; principal?: { pid?: number; uid?: number }; connection_state?: string }[] }>("client.list", { session_id: this.source.session });
    const client = response.clients.find((client) => client.info?.label === bridgeLabel(this.source.pid) && client.connection_state !== "lost" &&
      client.principal?.pid === this.source.pid && client.principal.uid === process.getuid?.());
    if (!client) throw new Error("Waiting for Pi's bridge (it may be reloading)…");
    this.sourceClient = client.client_id;
    const attachment = await control.performClient<{ generation: string }>(client.client_id, "pirex.attach", {
      sourceBlock: this.source.block, sourcePid: this.source.pid, viewerBlock: this.source.viewerBlock,
    });
    if (this.stopped) return;
    this.generation = string(attachment.generation);
    this.connected = true;
    this.status = "Connected";
    this.dirty = true;
    await this.refresh();
    this.onStatus();
  }

  private offline(message = "Pi bridge disconnected; waiting to reconnect…") {
    this.connected = false;
    this.status = message;
    this.onStatus();
  }

  private async read<T>(action: string, args: Record<string, unknown>): Promise<T> {
    if (!this.connected || !this.control) throw new Error("Pi is disconnected");
    const control = this.control;
    const client = this.sourceClient;
    return readView<T>((page) => control.performClient<ReadPage>(client, action, page), { ...args, generation: this.generation });
  }

  private async refresh() {
    if (this.refreshing || !this.connected || this.stopped) return;
    this.refreshing = true;
    try {
      while (this.dirty && this.connected && !this.stopped) {
        this.dirty = false;
        const state = parseView(await this.read("pirex.view", {}));
        if (state.generation !== this.generation) throw new Error("Pi session changed");
        this.state = state;
        this.onState(state);
      }
    } catch (error) { this.offline(error instanceof Error ? error.message : "Could not read Pi view"); }
    finally { this.refreshing = false; }
  }

  async older(before: string) { return parseView(await this.read("pirex.view", { before })); }
  async detail(toolId: string) { return this.read<ViewDetail>("pirex.detail", { toolId }); }

  async command(action: Record<string, unknown>) {
    if (this.uncertain) throw new Error("Resolve the previous uncertain command first");
    const args = { ...action, id: randomUUID(), generation: this.generation };
    return this.submit(args);
  }
  private async submit(args: Record<string, unknown>) {
    if (!this.connected || !this.control) throw new Error("Pi is disconnected; draft retained");
    try {
      const result = await this.control.performClient(this.sourceClient, "pirex.command", args);
      this.uncertain = undefined;
      return result;
    } catch (error) {
      if (!(error instanceof Error) || /timed out|disconnected|uncertain/i.test(error.message)) {
        this.uncertain = args;
        this.onStatus();
      }
      throw error;
    } finally {
      this.dirty = true;
      void this.refresh();
    }
  }
  async retry() {
    if (!this.uncertain) return;
    if (this.uncertain.generation !== this.generation) throw new Error("Pi reloaded: check the conversation, then dismiss uncertainty; this command cannot safely be replayed");
    return this.submit(this.uncertain);
  }
  dismissUncertainty() { this.uncertain = undefined; this.onStatus(); }
  stop() { this.stopped = true; this.connected = false; this.control?.close(); this.control = undefined; }
}
