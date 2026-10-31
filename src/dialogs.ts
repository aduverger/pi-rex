import { randomUUID } from "node:crypto";
import { ExtensionEditorComponent, type ExtensionUIContext, type ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent";
import type { ViewDialog } from "./view-state.ts";

export class Dialogs {
  private pending = new Map<string, { dialog: ViewDialog; finish: (value: string | boolean | undefined) => void }>();
  custom = 0;
  notice?: string;
  private changed: () => void;
  private getExternalEditor: () => string | undefined;
  constructor(changed: () => void, getExternalEditor: () => string | undefined) {
    this.changed = changed;
    this.getExternalEditor = getExternalEditor;
  }
  get visible(): ViewDialog[] { return [...this.pending.values()].map((value) => value.dialog); }

  private request(dialog: Omit<ViewDialog, "id">, local: (signal: AbortSignal) => Promise<unknown>, options?: ExtensionUIDialogOptions): Promise<string | boolean | undefined> {
    const id = randomUUID();
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        options?.signal?.removeEventListener("abort", cancel);
        this.pending.delete(id);
        controller.abort();
        this.changed();
      };
      const finish = (value: string | boolean | undefined) => { if (!settled) { cleanup(); resolve(value); } };
      const cancel = () => finish(undefined);
      this.pending.set(id, { dialog: { ...dialog, id }, finish });
      options?.signal?.addEventListener("abort", cancel, { once: true });
      if (options?.signal?.aborted) { cancel(); return; }
      if (options?.timeout !== undefined) timer = setTimeout(cancel, options.timeout);
      this.changed();
      Promise.resolve().then(() => local(controller.signal)).then((value) => finish(value as string | boolean | undefined), (error) => {
        if (!settled) { cleanup(); reject(error); }
      });
    });
  }

  answer(id: string, value: unknown, cancelled: boolean) {
    const request = this.pending.get(id);
    if (!request) throw new Error("Dialog is no longer awaiting an answer");
    const dialog = request.dialog;
    if (!cancelled) {
      if (dialog.kind === "confirm" && typeof value !== "boolean") throw new Error("Confirmation requires yes or no");
      if (dialog.kind !== "confirm" && typeof value !== "string") throw new Error("Dialog requires text");
      if (dialog.kind === "select" && !dialog.options?.includes(value as string)) throw new Error("Invalid dialog choice");
    }
    request.finish(cancelled ? undefined : value as string | boolean);
  }

  install(ui: ExtensionUIContext): () => void {
    const original = { select: ui.select, confirm: ui.confirm, input: ui.input, editor: ui.editor, custom: ui.custom, notify: ui.notify };
    ui.notify = (message, type) => {
      this.notice = `${type ?? "info"}: ${message}`;
      this.changed();
      original.notify.call(ui, message, type);
    };
    ui.select = async (title, options, opts) => await this.request({ kind: "select", title, options },
      (signal) => original.select.call(ui, title, options, { ...opts, signal }), opts) as string | undefined;
    ui.confirm = async (title, message, opts) => await this.request({ kind: "confirm", title, message },
      (signal) => original.confirm.call(ui, title, message, { ...opts, signal }), opts) === true;
    ui.input = async (title, placeholder, opts) => await this.request({ kind: "input", title, message: placeholder },
      (signal) => original.input.call(ui, title, placeholder, { ...opts, signal }), opts) as string | undefined;
    ui.editor = async (title, prefill) => await this.request({ kind: "editor", title, prefill }, (signal) => original.custom.call(ui, (tui, _theme, keys, done) => {
      const finish = (value: string | undefined) => { signal.removeEventListener("abort", cancel); done(value); };
      const cancel = () => finish(undefined);
      signal.addEventListener("abort", cancel, { once: true });
      const configuredEditor = this.getExternalEditor();
      const component = new ExtensionEditorComponent(tui, keys, title, prefill, finish, cancel, undefined, configuredEditor?.trim() ? configuredEditor : undefined);
      if (signal.aborted) queueMicrotask(cancel);
      return Object.assign(component, { dispose: () => signal.removeEventListener("abort", cancel) });
    })) as string | undefined;
    ui.custom = async (factory, options) => {
      this.custom++;
      this.changed();
      try { return await original.custom.call(ui, factory, options) as never; }
      finally { this.custom--; this.changed(); }
    };
    const installed = { select: ui.select, confirm: ui.confirm, input: ui.input, editor: ui.editor, custom: ui.custom, notify: ui.notify };
    return () => {
      for (const request of [...this.pending.values()]) request.finish(undefined);
      for (const key of ["select", "confirm", "input", "editor", "custom", "notify"] as const) {
        if (ui[key] === installed[key]) Object.assign(ui, { [key]: original[key] });
      }
    };
  }
}
