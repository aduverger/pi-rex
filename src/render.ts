import { ToolExecutionComponent, type Theme, type ToolRenderers, type ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Box, Container, getCapabilities, stripTerminalSequences, truncateToWidth, visibleWidth, type Component, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";

type RenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];

const empty: Component = { render: () => [], invalidate() {} };
type ToolResult = Parameters<NonNullable<ToolRenderers["renderResult"]>>[0];

class NativeFallback implements Component {
  private tool: ToolExecutionComponent;
  private synchronizing = false;

  constructor(name: string, original: ToolRenderers | undefined, context: RenderContext, resultOnly: boolean) {
    // Pi supplies only the missing slots; real custom renderers still receive the original context.
    let definition: ToolRenderers | undefined;
    if (original || resultOnly) {
      definition = {
        renderShell: "self",
        renderCall: original?.renderCall || resultOnly ? () => empty : undefined,
        renderResult: original?.renderResult ? () => empty : undefined,
      };
    }
    this.tool = new ToolExecutionComponent(name, context.toolCallId, context.args, {
      showImages: context.showImages,
      outputPad: context.outputPad,
    }, definition, {
      requestRender: () => {
        if (!this.synchronizing) context.invalidate();
      },
    } as TUI, context.cwd);
  }

  private synchronize(update: () => void) {
    this.synchronizing = true;
    try {
      update();
    } finally {
      this.synchronizing = false;
    }
  }

  updateCall(args: unknown, context: RenderContext) {
    this.synchronize(() => {
      this.tool.updateArgs(args);
      this.tool.setOutputPad(context.outputPad);
      this.tool.setShowImages(context.showImages);
      this.tool.setExpanded(context.expanded);
    });
  }

  updateResult(result: ToolResult, options: ToolRenderResultOptions, context: RenderContext) {
    // The outer Pi component owns inline images; keep native placeholders when images are hidden.
    const content = context.showImages && getCapabilities().images
      ? result.content.filter((block) => block.type !== "image")
      : result.content;
    this.synchronize(() => {
      this.tool.setExpanded(options.expanded);
      this.tool.updateResult({ ...result, content, isError: context.isError, durationMs: context.durationMs }, options.isPartial);
    });
  }

  render(width: number) {
    // Pi's outer tool component already supplies the leading separator.
    return this.tool.render(width).slice(1);
  }

  invalidate() {
    this.synchronize(() => this.tool.invalidate());
  }
}

function singleLine(text: string): string {
  return stripTerminalSequences(text).replace(/[\x00-\x1f\x7f-\x9f\s]+/g, " ").trim();
}

function toolAppearance(context: RenderContext) {
  if (context.isPartial) {
    return { icon: "◌", foreground: "muted", background: "toolPendingBg" } as const;
  }
  if (context.isError) {
    return { icon: "✗", foreground: "error", background: "toolErrorBg" } as const;
  }
  return { icon: "✓", foreground: "success", background: "toolSuccessBg" } as const;
}

class ToolFrame implements Component {
  private content: Component;
  private theme: Theme;
  private replacePadding: boolean;
  private onSummaryClick?: () => void;
  private cache?: { width: number; content: string[]; frame: string[] };

  constructor(content: Component, theme: Theme, replacePadding: boolean, onSummaryClick?: () => void) {
    this.content = content;
    this.theme = theme;
    this.replacePadding = replacePadding;
    this.onSummaryClick = onSummaryClick;
  }

  render(width: number): string[] {
    const frameWidth = width - 1;
    if (frameWidth <= 0) return [];
    const innerWidth = frameWidth < 5 ? frameWidth : frameWidth - 2;
    // Children can change interactively without invalidating this frame.
    const lines = this.content.render(innerWidth);
    const cached = this.cache;
    if (cached?.width === width && lines.length === cached.content.length &&
      lines.every((line, index) => line === cached.content[index])) return cached.frame;
    if (frameWidth < 5) {
      const frame = lines.map((line) => truncateToWidth(line, frameWidth, "") + "\x1b[0m ");
      this.cache = { width, content: lines, frame };
      return frame;
    }
    if (!lines.length) return [];
    const body = this.replacePadding ? lines.slice(1, -1) : lines;
    // Diagnostic: replace summary decorations with spaces without changing geometry or click targets.
    const borderlessSummary = this.onSummaryClick !== undefined;
    const side = borderlessSummary ? " " : this.theme.fg("dim", "│");
    const frame = [
      borderlessSummary ? " ".repeat(width) : this.theme.fg("dim", `╭${"─".repeat(innerWidth)}╮`) + " ",
      ...body.map((line) => {
        const fitted = truncateToWidth(line, innerWidth, "");
        // Wrapped diffs can leave inverse highlighting active at the end of a line.
        return `${side}${fitted}\x1b[0m${" ".repeat(Math.max(0, innerWidth - visibleWidth(fitted)))}${side} `;
      }),
      borderlessSummary ? " ".repeat(width) : this.theme.fg("dim", `╰${"─".repeat(innerWidth)}╯`) + " ",
    ];
    this.cache = { width, content: lines, frame };
    return frame;
  }

  handleMouse(event: TuiMouseEvent) {
    const frameWidth = event.width - 1;
    if (frameWidth <= 0 || event.x >= frameWidth) return undefined;
    if (this.onSummaryClick && event.type === "click" && event.button === "left") {
      this.onSummaryClick();
      return { handled: true };
    }
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
    this.cache = undefined;
    this.content.invalidate();
  }
}

export function compactToolRenderer(
  name: string,
  original: ToolRenderers | undefined,
  isMobile: () => boolean,
  track: (context: RenderContext) => void,
  getToolsExpanded: () => boolean,
): ToolRenderers {
  const states = new WeakMap<object, {
    call?: Component;
    result?: Component;
    error?: string;
    frame?: Box | Container;
    fallback?: NativeFallback;
    preview?: boolean;
    globalExpanded?: boolean;
  }>();
  function state(context: RenderContext) {
    let value = states.get(context.state);
    if (!value) {
      value = {};
      states.set(context.state, value);
    }
    return value;
  }

  function isSummary(context: RenderContext) {
    const cached = state(context);
    const globalExpanded = getToolsExpanded();
    if (cached.globalExpanded !== globalExpanded || context.expanded) cached.preview = false;
    cached.globalExpanded = globalExpanded;
    return isMobile() && !context.expanded && !cached.preview;
  }

  function summary(args: unknown, theme: Theme, context: RenderContext) {
    const params = args && typeof args === "object" ? args as Record<string, unknown> : {};
    const appearance = toolAppearance(context);
    const label = [params.path, params.file_path, params.command].find((value) => typeof value === "string");
    const error = context.isError ? state(context).error : undefined;
    return `${theme.fg("dim", "›")} ${theme.fg(appearance.foreground, appearance.icon)} ${theme.bold(singleLine(name))}` +
      (typeof label === "string" ? ` ${singleLine(label)}` : "") +
      (error ? ` — ${singleLine(error)}` : "");
  }

  return {
    renderShell: "self",
    renderCall(args, theme, context) {
      track(context);
      const cached = state(context);
      const summaryOnly = isSummary(context);
      if (!original?.renderCall || !original.renderResult) {
        cached.fallback ??= new NativeFallback(name, original, context, false);
        cached.fallback.updateCall(args, context);
      }
      cached.call = original?.renderCall
        ? original.renderCall(args, theme, { ...context, lastComponent: cached.call })
        : cached.fallback;
      const background = toolAppearance(context).background;
      const backgroundStyle = summaryOnly ? undefined : (text: string) => theme.bg(background, text);
      const selfRendered = original?.renderShell === "self" && !summaryOnly;
      cached.frame = selfRendered || (!original && !summaryOnly)
        ? new Container()
        : new Box(context.outputPad, 1, backgroundStyle);
      if (summaryOnly) {
        // Pi supplies the result after renderCall; build the summary after its error is available.
        let text: string | undefined;
        let cachedWidth: number | undefined;
        let lines: string[] = [];
        cached.frame.addChild({
          render(width) {
            if (cachedWidth !== width) {
              text ??= summary(args, theme, context);
              lines = [truncateToWidth(text, width)];
              cachedWidth = width;
            }
            return lines;
          },
          invalidate() { text = undefined; cachedWidth = undefined; },
        });
      } else if (cached.call) {
        cached.frame.addChild(cached.call);
      }
      if (!isMobile()) return cached.frame;
      return new ToolFrame(cached.frame, theme, !selfRendered, summaryOnly ? () => {
        cached.preview = true;
        context.invalidate();
      } : undefined);
    },
    renderResult(result, options, theme, context) {
      track(context);
      const cached = state(context);
      const errorBlock = context.isError
        ? result.content.find((block) => block.type === "text" && block.text.trim())
        : undefined;
      cached.error = errorBlock?.type === "text"
        ? errorBlock.text.split(/\r?\n/).find((line) => line.trim())
        : undefined;
      if (cached.fallback || !original?.renderResult) {
        cached.fallback ??= new NativeFallback(name, original, context, true);
        cached.fallback.updateResult(result, options, context);
      }
      if (original?.renderResult) {
        cached.result = original.renderResult(result, options, theme, { ...context, lastComponent: cached.result });
      } else {
        cached.result = original?.renderCall || !cached.frame ? cached.fallback : empty;
      }
      if (isSummary(context)) return empty;
      if (!cached.result) return empty;
      if (cached.frame) {
        cached.frame.addChild(cached.result);
        return empty;
      }
      return cached.result;
    },
  };
}
