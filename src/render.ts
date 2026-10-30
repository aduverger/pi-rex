import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Box, Container, Text, stripTerminalSequences, truncateToWidth, visibleWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";

type RenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
type Result = Parameters<NonNullable<ToolRenderers["renderResult"]>>[0];

const empty: Component = { render: () => [], invalidate() {} };

function singleLine(text: string): string {
  return stripTerminalSequences(text).replace(/[\x00-\x1f\x7f-\x9f\s]+/g, " ").trim();
}

class Summary implements Component {
  constructor(text: () => string) {
    this.text = text;
  }
  private text: () => string;
  render(width: number): string[] {
    return [truncateToWidth(this.text(), width)];
  }
  invalidate() {}
}

class ToolFrame implements Component {
  private content: Component;
  private theme: Theme;
  private replacePadding: boolean;

  constructor(content: Component, theme: Theme, replacePadding: boolean) {
    this.content = content;
    this.theme = theme;
    this.replacePadding = replacePadding;
  }

  render(width: number): string[] {
    const frameWidth = width - 1;
    if (frameWidth <= 0) return [];
    if (frameWidth < 5) return this.content.render(frameWidth).map((line) => truncateToWidth(line, frameWidth, "") + " ");
    const innerWidth = frameWidth - 2;
    const lines = this.content.render(innerWidth);
    if (!lines.length) return [];
    const body = this.replacePadding ? lines.slice(1, -1) : lines;
    const side = this.theme.fg("dim", "│");
    return [
      this.theme.fg("dim", `╭${"─".repeat(innerWidth)}╮`) + " ",
      ...body.map((line) => {
        const fitted = truncateToWidth(line, innerWidth, "");
        return `${side}${fitted}${" ".repeat(Math.max(0, innerWidth - visibleWidth(fitted)))}${side} `;
      }),
      this.theme.fg("dim", `╰${"─".repeat(innerWidth)}╯`) + " ",
    ];
  }

  handleMouse(event: TuiMouseEvent) {
    const frameWidth = event.width - 1;
    if (frameWidth <= 0 || event.x >= frameWidth) return undefined;
    if (frameWidth < 5) return this.content.handleMouse?.({ ...event, width: frameWidth });
    if (event.x <= 0 || event.x >= frameWidth - 1 || event.y <= 0 || event.y >= event.height - 1) return undefined;
    return this.content.handleMouse?.({
      ...event,
      x: event.x - 1,
      y: event.y - (this.replacePadding ? 0 : 1),
      width: frameWidth - 2,
      height: event.height - (this.replacePadding ? 0 : 2),
    });
  }

  invalidate() {
    this.content.invalidate();
  }
}

export function compactToolRenderer(
  name: string,
  original: ToolRenderers | undefined,
  isMobile: () => boolean,
  track: (context: RenderContext) => void,
): ToolRenderers {
  const states = new WeakMap<object, {
    call?: Component;
    result?: Component;
    error?: string;
    frame?: Box | Container;
  }>();
  function state(context: RenderContext) {
    let value = states.get(context.state);
    if (!value) {
      value = {};
      states.set(context.state, value);
    }
    return value;
  }

  function summary(args: unknown, theme: Theme, context: RenderContext) {
    const params = args && typeof args === "object" ? args as Record<string, unknown> : {};
    const status = context.isPartial ? "◌" : context.isError ? "✗" : "✓";
    const color = context.isPartial ? "muted" : context.isError ? "error" : "success";
    const label = [params.path, params.file_path, params.command].find((value) => typeof value === "string");
    const error = context.isError ? state(context).error : undefined;
    return `${theme.fg("dim", "›")} ${theme.fg(color, status)} ${theme.bold(singleLine(name))}` +
      (typeof label === "string" ? ` ${singleLine(label)}` : "") +
      (error ? ` — ${singleLine(error)}` : "");
  }

  return {
    renderShell: "self",
    renderCall(args, theme, context) {
      track(context);
      const cached = state(context);
      const folded = isMobile() && !context.expanded;
      const background = context.isPartial ? "toolPendingBg" : context.isError ? "toolErrorBg" : "toolSuccessBg";
      const selfRendered = original?.renderShell === "self" && !folded;
      cached.frame = selfRendered
        ? new Container()
        : new Box(context.outputPad, 1, folded ? undefined : (text) => theme.bg(background, text));
      if (folded) {
        cached.frame.addChild(new Summary(() => summary(args, theme, context)));
      } else {
        cached.call = original?.renderCall
          ? original.renderCall(args, theme, { ...context, lastComponent: cached.call })
          : new Text(`${name}\n${JSON.stringify(args, null, 2) ?? ""}`, 0, 0);
        cached.frame.addChild(cached.call);
      }
      return isMobile() ? new ToolFrame(cached.frame, theme, !selfRendered) : cached.frame;
    },
    renderResult(result: Result, options, theme, context) {
      track(context);
      const cached = state(context);
      const errorBlock = context.isError
        ? result.content.find((block) => block.type === "text" && block.text.trim())
        : undefined;
      cached.error = errorBlock?.type === "text"
        ? errorBlock.text.split(/\r?\n/).find((line) => line.trim())
        : undefined;
      if (isMobile() && !options.expanded) return empty;
      cached.result = original?.renderResult
        ? original.renderResult(result, options, theme, { ...context, lastComponent: cached.result })
        : new Text(result.content.map((block) => block.type === "text" ? block.text : "").join("\n"), 0, 0);
      if (cached.frame) {
        cached.frame.addChild(cached.result);
        return empty;
      }
      return cached.result;
    },
  };
}
