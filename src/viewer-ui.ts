import { getMarkdownTheme, getSelectListTheme, renderDiff } from "@earendil-works/pi-coding-agent";
import { Container, Editor, Markdown, ScrollView, SelectList, Text, VStack, getTerminalColorMode, matchesKey, rgbColor, stripTerminalSequences, styleText, truncateToWidth, visibleWidth, type Component, type TuiAltScreen, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { ViewerConnection } from "./viewer-connection.ts";
import type { ViewDetail, ViewNode, ViewState } from "./view-state.ts";

export const safeText = (text: string) => stripTerminalSequences(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
const muted = (text: string) => styleText(text, { dim: true }, getTerminalColorMode());
const bold = (text: string) => styleText(text, { bold: true }, getTerminalColorMode());
function statusIcon(status: ViewNode["status"]) {
  if (status === "error") return styleText("✗", { fg: rgbColor(220, 90, 90) }, getTerminalColorMode());
  if (status === "success") return styleText("✓", { fg: rgbColor(90, 180, 120) }, getTerminalColorMode());
  return muted(status === "running" ? "◌" : "?");
}

const DISPATCH_NOTICE = "Dispatched; acceptance unconfirmed";

interface Action { label: string; run: () => void }
interface UnconfirmedSubmission { sessionId: string; text: string; status: string }
class Actions implements Component {
  private positions: { action: Action; x: number; y: number; width: number }[] = [];
  private actions: () => Action[];
  constructor(actions: () => Action[]) { this.actions = actions; }
  render(width: number) {
    this.positions = [];
    const lines: string[] = [""];
    for (const action of this.actions()) {
      const label = truncateToWidth(`[ ${action.label} ]`, width, "");
      let y = lines.length - 1;
      if (visibleWidth(lines[y]) + visibleWidth(label) + 1 > width && lines[y]) { lines.push(""); y++; }
      const x = visibleWidth(lines[y]);
      this.positions.push({ action, x, y, width: visibleWidth(label) });
      lines[y] += `${label} `;
    }
    return lines.map((line) => truncateToWidth(line, width, ""));
  }
  handleMouse(event: TuiMouseEvent) {
    if (event.type !== "click" || event.button !== "left") return;
    const position = this.positions.find((item) => item.y === event.y && event.x >= item.x && event.x < item.x + item.width);
    if (position) { position.action.run(); return { handled: true }; }
    return undefined;
  }
  invalidate() {}
}

class Card implements Component {
  private heading: string;
  private opened: boolean;
  private body: Component;
  private toggle: () => void;
  constructor(heading: string, opened: boolean, body: Component, toggle: () => void) {
    this.heading = heading; this.opened = opened; this.body = body; this.toggle = toggle;
  }
  render(width: number) {
    const inner = Math.max(1, width - 2);
    const rows = [truncateToWidth(`${this.opened ? "⌄" : "›"} ${this.heading}`, inner, "…")];
    if (this.opened) rows.push(...this.body.render(inner));
    if (width < 6) return rows.map((row) => truncateToWidth(row, width, ""));
    const line = (text: string) => muted("│") + text + "\x1b[0m" + " ".repeat(Math.max(0, inner - visibleWidth(text))) + muted("│");
    return [muted(`╭${"─".repeat(inner)}╮`), ...rows.map((row) => line(truncateToWidth(row, inner, ""))), muted(`╰${"─".repeat(inner)}╯`)];
  }
  handleMouse(event: TuiMouseEvent) {
    const framed = event.width >= 6;
    const bodyTop = framed ? 2 : 1;
    if (event.type === "click" && event.button === "left" && (event.y < bodyTop || (framed && !this.opened && event.y === 2))) {
      this.toggle();
      return { handled: true };
    }
    if (this.opened && event.y >= bodyTop) return this.body.handleMouse?.({ ...event, x: event.x - (framed ? 1 : 0), y: event.y - bodyTop, width: Math.max(1, event.width - 2), height: event.height - bodyTop - (framed ? 1 : 0) });
    return undefined;
  }
  invalidate() { this.body.invalidate(); }
}

export function detailText(detail: ViewDetail): string {
  let output: string | undefined;
  if (typeof detail.content === "string") output = detail.content;
  else if (Array.isArray(detail.content)) {
    output = detail.content.map((item) => {
      const block = item as { type?: string; text?: string };
      return block.type === "image" ? "[Image omitted: text-only viewer]" : block.text ?? "";
    }).join("\n");
  } else output = JSON.stringify(detail.content, null, 2);
  return safeText(`${detail.unavailable ? "Pi did not save this tool's output.\n" : ""}Arguments\n${JSON.stringify(detail.args, null, 2) ?? "[unavailable]"}\n\nOutput\n${output ?? ""}`);
}

export class ViewerApp {
  readonly document = new Container();
  readonly scroll: ScrollView;
  readonly root: VStack;
  readonly editor: Editor;
  private header = new Text("Connecting to Pi…", 0, 0);
  private notice = new Text("", 0, 0);
  private noticeText = "";
  private dialog = new VStack();
  private opened = new Set<string>();
  private details = new Map<string, ViewDetail>();
  private loading = new Set<string>();
  private detailErrors = new Map<string, string>();
  private nodes: ViewNode[] = [];
  private state?: ViewState;
  private before?: string;
  private dialogId?: string;
  private sending = false;
  private alert = "";
  private drafts = new Map<string, string>();
  private unconfirmedSubmissions = new Set<UnconfirmedSubmission>();
  private showSubmissionRecovery = false;
  private tui: TuiAltScreen;
  private connection: ViewerConnection;

  constructor(tui: TuiAltScreen, connection: ViewerConnection) {
    this.tui = tui; this.connection = connection;
    this.scroll = new ScrollView(this.document, { follow: "end", primary: true, scrollbar: "always", overscroll: "contain" });
    const list = getSelectListTheme();
    this.editor = new Editor(tui, { borderColor: list.scrollInfo, selectList: list }, { paddingX: 1 });
    this.editor.onSubmit = (text) => { this.editor.setText(text); void this.send(this.state?.busy ? "steer" : "send"); };
    const controls = new Actions(() => {
      if (connection.uncertain) return [
        { label: "Retry same request", run: () => { void this.retry(); } },
        { label: "Dismiss uncertainty", run: () => { connection.dismissUncertainty(); this.status(); } },
      ];
      return [
        { label: "Send", run: () => { void this.send("send"); } },
        { label: "Steer", run: () => { void this.send("steer"); } },
        { label: "Follow-up", run: () => { void this.send("followUp"); } },
        { label: "Stop", run: () => { void this.command({ kind: "abort" }); } },
      ];
    });
    const pending = () => !!this.state?.dialogs.length;
    const composer = new VStack([
      { component: this.editor, visible: () => !pending(), shrink: 0 },
      { component: controls, visible: () => !pending() || !!connection.uncertain, shrink: 0 },
    ]);
    this.root = new VStack([
      { component: this.header, maxSize: 1, shrink: 0, visible: () => !pending() },
      { component: this.scroll, grow: 1, basis: 0, visible: () => !pending() },
      { component: this.notice, maxSize: 1, shrink: 0, visible: () => !!this.noticeText },
      { component: this.dialog, grow: 1, basis: 0, visible: () => pending() && !connection.uncertain },
      { component: composer, shrink: 0 },
    ]);
    tui.setFocus(this.editor);
    tui.addInputListener((data) => {
      if (matchesKey(data, "ctrl+o")) {
        if (this.opened.size) this.opened.clear();
        else for (const node of this.nodes) if (node.kind === "tool") { this.opened.add(node.id); this.opened.add(`group:${node.id}`); void this.loadDetail(node); }
        this.rebuild(); return { consume: true };
      }
      return undefined;
    });
    this.status();
  }

  update(state: ViewState) {
    const previous = this.state;
    if (previous?.sessionId !== state.sessionId) {
      if (previous) this.drafts.set(previous.sessionId, this.editor.getExpandedText());
      this.editor.setText(this.drafts.get(state.sessionId) ?? "");
      this.opened.clear();
      this.showSubmissionRecovery = false;
      this.scroll.scrollToEnd();
      this.tui.resetTextSelection();
    }
    if (previous?.generation !== state.generation) {
      this.nodes = []; this.details.clear(); this.detailErrors.clear();
      this.before = state.before;
    }
    const incoming = new Set(state.nodes.map((node) => node.id));
    const first = this.nodes.findIndex((node) => incoming.has(node.id));
    this.nodes = [...(first >= 0 ? this.nodes.slice(0, first) : []), ...state.nodes];
    this.state = state;
    this.rebuild();
    for (const node of this.nodes) if (node.kind === "tool" && this.opened.has(node.id)) void this.loadDetail(node);
    this.updateDialog();
    this.status();
  }

  status() {
    this.editor.disableSubmit = !this.state || !this.connection.connected || this.sending || !!this.connection.uncertain || !!this.state?.dialogs.length || !!this.state?.customUI;
    const activity = this.state?.busy ? "working" : "idle";
    this.header.setText(bold(safeText(this.state?.name ?? "Pi conversation")) + muted(` · ${activity}`));
    const unavailable = !this.connection.connected ? this.connection.status : "";
    const unsupported = this.state?.customUI ? "Unsupported custom extension screen is active" : "";
    const uncertain = this.connection.uncertain ? "Command delivery uncertain. Check the conversation; retry uses the same command ID." : "";
    this.noticeText = safeText([unavailable, unsupported, uncertain, this.state?.notice, this.alert].filter(Boolean).join(" · "));
    this.notice.setText(this.noticeText);
    this.tui.requestRender();
  }

  private rebuild() {
    this.document.clear();
    if (this.before) this.document.addChild(new Actions(() => [{ label: "Load earlier", run: () => { void this.loadEarlier(); } }]));
    for (let index = 0; index < this.nodes.length;) {
      const node = this.nodes[index];
      if (node.kind === "text") {
        const box = new Container();
        let heading = node.role ?? "Info";
        if (node.thinking) heading = "Reasoning";
        else if (node.role === "user") heading = "You";
        else if (node.role === "assistant") heading = "Pi";
        box.addChild(new Text(muted(heading), 0, 0));
        box.addChild(new Markdown(safeText(node.text ?? ""), 0, 0, getMarkdownTheme()));
        box.addChild(new Text(" ", 0, 0));
        this.document.addChild(box);
        index++; continue;
      }
      let end = index;
      while (end < this.nodes.length && this.nodes[end].kind === "tool") end++;
      const run = this.nodes.slice(index, end);
      const ids = new Set(run.map((tool) => tool.id));
      const roots = run.filter((tool) => !tool.parentId || !ids.has(tool.parentId));
      const body = new Container();
      for (const tool of roots) body.addChild(this.toolCard(tool, run));
      if (roots.length > 5) {
        const key = `group:${roots[0].id}`;
        const failed = run.filter((tool) => tool.status === "error").length;
        const running = run.some((tool) => tool.status === "running");
        this.document.addChild(new Card(`${run.length} tool calls · ${running ? "running" : "completed"}${failed ? ` · ${failed} failed` : ""}`,
          this.opened.has(key), body, () => { this.toggle(key); }));
      } else this.document.addChild(body);
      index = end;
    }
    if (this.unconfirmedSubmissions.size) {
      const recovery = new Container();
      recovery.addChild(new Text("These may already have executed. Inserting text only edits the draft; it does not resend.", 1, 0));
      for (const submission of this.unconfirmedSubmissions) {
        const conversation = submission.sessionId === this.state?.sessionId ? "" : "Previous conversation · ";
        recovery.addChild(new Text(safeText(`${conversation}${submission.status}\n\n${submission.text}`), 1, 0));
        recovery.addChild(new Actions(() => [
          { label: "Insert into draft", run: () => {
            const draft = this.editor.getExpandedText();
            this.editor.setText(draft ? `${draft}\n${submission.text}` : submission.text);
            this.showSubmissionRecovery = false;
            this.tui.setFocus(this.editor);
            this.rebuild();
          } },
          { label: "Dismiss", run: () => { this.unconfirmedSubmissions.delete(submission); this.rebuild(); } },
        ]));
      }
      this.document.addChild(new Actions(() => [{ label: `Submission recovery (${this.unconfirmedSubmissions.size})`, run: () => {
        this.showSubmissionRecovery = !this.showSubmissionRecovery;
        this.rebuild();
      } }]));
      if (this.showSubmissionRecovery) this.document.addChild(recovery);
    }
    this.tui.requestRender();
  }

  private toggle(id: string) {
    if (this.opened.has(id)) this.opened.delete(id); else this.opened.add(id);
    const node = this.nodes.find((node) => node.id === id);
    if (node && this.opened.has(id)) void this.loadDetail(node);
    this.rebuild();
  }

  private toolCard(node: ViewNode, run: ViewNode[]): Component {
    const body = new Container();
    for (const child of run.filter((child) => child.parentId === node.id && child.id !== node.id)) body.addChild(this.toolCard(child, run.filter((tool) => tool.id !== node.id)));
    const detail = this.details.get(node.id);
    const error = this.detailErrors.get(node.id);
    let bodyText = "Loading tool details…";
    if (error) bodyText = safeText(error);
    else if (detail) bodyText = detailText(detail);
    body.addChild(new Text(bodyText, 1, 0));
    const metadata = detail?.details as { diff?: unknown } | undefined;
    if (node.name === "edit" && typeof metadata?.diff === "string") body.addChild(new Text(renderDiff(safeText(metadata.diff)), 1, 0));
    return new Card(`${statusIcon(node.status)} ${bold(safeText(node.name ?? "tool"))} ${safeText(node.label ?? "").replace(/\s+/g, " ")}`,
      this.opened.has(node.id), body, () => this.toggle(node.id));
  }

  private async loadDetail(node: ViewNode) {
    if (!this.connection.connected || this.loading.has(node.id)) return;
    this.loading.add(node.id);
    const generation = this.state?.generation;
    try {
      const detail = await this.connection.detail(node.id);
      if (generation === this.state?.generation) { this.details.set(node.id, detail); this.detailErrors.delete(node.id); }
    } catch (error) { if (generation === this.state?.generation) this.detailErrors.set(node.id, String(error)); }
    finally { this.loading.delete(node.id); this.rebuild(); }
  }

  private async loadEarlier() {
    if (!this.before) return;
    const generation = this.state?.generation;
    try {
      const state = await this.connection.older(this.before);
      if (generation !== this.state?.generation) return;
      const existing = new Set(this.nodes.map((node) => node.id));
      this.nodes = [...state.nodes.filter((node) => !existing.has(node.id)), ...this.nodes];
      this.before = state.before;
      this.rebuild();
    } catch (error) { this.alert = String(error); this.status(); }
  }

  private updateDialog() {
    const dialog = this.state?.dialogs.at(-1);
    if (dialog?.id === this.dialogId) return;
    this.dialogId = dialog?.id;
    this.dialog.clear();
    if (!dialog) { this.tui.setFocus(this.editor); return; }
    const question = new ScrollView(new Text(safeText(`${dialog.title}\n${dialog.message ?? ""}`), 0, 0), { primary: true, scrollbar: "always", overscroll: "contain" });
    this.dialog.addChild(question, { grow: 1, basis: 0, minSize: 1 });
    const actions: Action[] = [];
    const answer = (value: unknown, cancelled = false) => { void this.command({ kind: "answer", dialogId: dialog.id, value, cancelled }); };
    if (dialog.kind === "select" || dialog.kind === "confirm") {
      const options = dialog.kind === "confirm" ? ["Yes", "No"] : dialog.options ?? [];
      const list = new SelectList(options.map((label, index) => ({ value: String(index), label: safeText(label) })), 6, getSelectListTheme());
      list.onSelect = (item) => answer(dialog.kind === "confirm" ? item.value === "0" : options[Number(item.value)]);
      list.onCancel = () => answer(undefined, true);
      this.dialog.addChild(list, { minSize: Math.max(1, Math.min(6, options.length)) });
      this.tui.setFocus(list);
    } else {
      const list = getSelectListTheme();
      const field = new Editor(this.tui, { borderColor: list.scrollInfo, selectList: list });
      field.setText(dialog.prefill ?? "");
      field.onSubmit = (text) => { field.setText(text); answer(text); };
      this.dialog.addChild(field, { shrink: 0 });
      actions.push({ label: "Submit answer", run: () => answer(field.getExpandedText()) });
      this.tui.setFocus(field);
    }
    actions.push({ label: "Cancel dialog", run: () => answer(undefined, true) }, { label: "Stop", run: () => { void this.command({ kind: "abort" }); } });
    this.dialog.addChild(new Actions(() => actions), { shrink: 0 });
  }

  private async command(action: Record<string, unknown>) {
    this.alert = "";
    try { await this.connection.command(action); }
    catch (error) { this.alert = String(error); }
    this.status();
  }
  private async send(delivery: "send" | "steer" | "followUp") {
    const text = this.editor.getExpandedText();
    if (this.editor.disableSubmit || !text.trim()) return;
    const sessionId = this.state!.sessionId;
    const submission = { sessionId, text, status: "Dispatch in progress" };
    this.unconfirmedSubmissions.add(submission);
    this.showSubmissionRecovery = false;
    this.sending = true; this.alert = ""; this.rebuild(); this.status();
    try {
      await this.connection.command({ kind: "prompt", text, delivery });
      submission.status = DISPATCH_NOTICE;
      this.alert = DISPATCH_NOTICE;
      this.editor.addToHistory(text);
      if (this.state?.sessionId === sessionId) {
        if (this.editor.getExpandedText() === text) this.editor.setText("");
      } else if (this.drafts.get(sessionId) === text) this.drafts.delete(sessionId);
    } catch (error) { submission.status = `Outcome unconfirmed: ${String(error)}`; this.alert = String(error); }
    finally { this.sending = false; this.rebuild(); this.status(); }
  }
  private async retry() {
    const request = this.connection.uncertain;
    try {
      await this.connection.retry();
      if (request?.kind === "prompt" && request.generation === this.state?.generation && this.editor.getExpandedText() === request.text) this.editor.setText("");
      this.alert = request?.kind === "prompt" ? DISPATCH_NOTICE : "";
    } catch (error) { this.alert = String(error); }
    this.status();
  }
}
