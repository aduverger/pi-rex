import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBashToolDefinition, createEditToolDefinition, createReadToolDefinition,
  createWriteToolDefinition, initTheme, ToolExecutionComponent, Theme, type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Container, MouseRegion, ScrollView, Text, getCapabilities, setCapabilities, sliceByColumn, stripTerminalSequences, visibleWidth, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { compactToolRenderer } from "../src/render.ts";
import { createToolHtmlRenderer } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/tool-renderer.js";
import { renderLayoutFrame } from "../node_modules/@earendil-works/pi-tui/dist/layout.js";
import { extractSegments } from "../node_modules/@earendil-works/pi-tui/dist/utils.js";

initTheme("dark", false);
const ui = { requestRender() {} } as TUI;
const plain = (component: ToolExecutionComponent, width = 40) => component.render(width).map(stripTerminalSequences);
function content(component: ToolExecutionComponent, width = 40) {
  const lines = plain(component, width);
  const body = lines[1]?.startsWith("╭") ? lines.slice(2, -1).map((line) => line.slice(1, -2)) : lines;
  return body.filter((line) => line.trim());
}

function styledCells(line: string, width: number) {
  // Pi's ANSI tracker resolves inherited styles, independent of how resets are encoded.
  return Array.from({ length: width }, (_, column) => extractSegments(line, column, column, 1).after || " ");
}

function frameBody(component: ToolExecutionComponent, width = 40) {
  const side = styledCells(rendererTheme().fg("dim", "│"), 1)[0];
  return component.render(width).slice(2, -1).map((line) => {
    const cells = styledCells(line, width);
    assert.equal(cells[0], side);
    assert.equal(cells.at(-2), side);
    assert.equal(cells.at(-1), " ");
    return cells.slice(1, -2);
  });
}

function rendererTheme(): Theme {
  let theme: Theme | undefined;
  new ToolExecutionComponent("theme", "theme", {}, {}, {
    renderCall(_args, activeTheme) {
      theme = activeTheme;
      return new Text("", 0, 0);
    },
  }, ui, process.cwd());
  assert.ok(theme);
  return theme;
}

function tool(name: string, args: unknown, original?: ToolRenderers) {
  let mobile = true;
  let redraw = () => {};
  const renderer = compactToolRenderer(name, original, () => mobile, (context) => { redraw = context.invalidate; });
  const component = new ToolExecutionComponent(name, "call:1", args, { showImages: false }, renderer, ui, process.cwd());
  component.setArgsComplete();
  component.markExecutionStarted();
  return {
    component,
    setMobile(value: boolean) { mobile = value; redraw(); },
  };
}

function clickRow(component: ToolExecutionComponent, name: string) {
  const lines = plain(component);
  const y = lines.findIndex((line) => line.includes(name));
  assert.ok(y >= 0);
  const result = component.handleMouse({
    type: "click", button: "left", x: 2, y, screenX: 2, screenY: y,
    width: 40, height: lines.length, shift: false, alt: false, ctrl: false,
  });
  assert.equal(result?.handled, true);
}

const cases = [
  { name: "read", args: { path: "src/example.ts" }, definition: createReadToolDefinition(process.cwd()) as ToolRenderers, output: "const value = 42;" },
  { name: "write", args: { path: "src/example.ts", content: "const value = 42;\n" }, definition: createWriteToolDefinition(process.cwd()) as ToolRenderers, output: "Wrote file" },
  { name: "edit", args: { path: "src/example.ts", oldText: "41", newText: "42" }, definition: createEditToolDefinition(process.cwd()) as ToolRenderers, output: "Edited file" },
  { name: "bash", args: { command: "printf hello" }, definition: createBashToolDefinition(process.cwd()) as ToolRenderers, output: "hello" },
];

for (const { name, args, definition, output } of cases) {
  for (const isError of [false, true]) {
    test(`${name} ${isError ? "error" : "success"}: folded content is neutral, expanded and desktop views match native Pi`, () => {
      const { component, setMobile } = tool(name, args, definition);
      const result = { content: [{ type: "text", text: isError ? "Tool failed" : output }], details: undefined, isError, durationMs: 42 };
      component.updateResult(result);
      const saved = structuredClone(result);
      assert.equal(content(component).length, 1);
      assert.match(content(component)[0], isError ? /✗/ : /✓/);
      assert.doesNotMatch(component.render(40).join("\n"), /\x1b\[(?:4[0-7]|10[0-7]|48[;:])[^m]*m/);
      clickRow(component, name);
      const baseline = new ToolExecutionComponent(name, "call:1", args, { showImages: false }, definition, ui, process.cwd());
      baseline.setArgsComplete();
      baseline.markExecutionStarted();
      baseline.updateResult(result);
      baseline.setExpanded(true);
      const native = baseline.render(37);
      const body = definition.renderShell === "self" ? native.slice(1) : native.slice(2, -1);
      assert.deepEqual(frameBody(component), body.map((line) => styledCells(line, 37)));
      clickRow(component, name === "bash" ? "$" : name);
      assert.equal(content(component).length, 1);
      setMobile(false);
      baseline.setExpanded(false);
      assert.deepEqual(component.render(40), baseline.render(40));
      setMobile(true);
      assert.equal(content(component).length, 1);
      assert.deepEqual(result, saved);
    });
  }
}

test("folded tools share neutral frames without extra padding rows", () => {
  const theme = rendererTheme();
  for (const { name, args, definition } of cases) {
    const { component, setMobile } = tool(name, args, definition);
    component.updateResult({ content: [{ type: "text", text: "done" }], isError: false });
    const lines = component.render(40);
    assert.equal(lines.length, 4);
    assert.equal(lines[1], theme.fg("dim", `╭${"─".repeat(37)}╮`) + " ");
    assert.equal(lines.at(-1), theme.fg("dim", `╰${"─".repeat(37)}╯`) + " ");
    assert.ok(lines.slice(1).every((line) => visibleWidth(line) === 40 && line.endsWith(" ")));
    setMobile(false);
    assert.ok(!plain(component).some((line) => line.startsWith("╭")));
    setMobile(true);
    assert.equal(component.render(40)[1], lines[1]);
  }
});

test("wrapped edit highlighting stays inside the frame, including after resizing and desktop handoff", (t) => {
  // Emit inverse ANSI even without a TTY, as Pi does in Rex.
  t.mock.method(Theme.prototype, "inverse", (text: string) => `\x1b[7m${text}\x1b[27m`);
  const definition = createEditToolDefinition(process.cwd()) as ToolRenderers;
  const args = { path: "src/render.ts" };
  const result = {
    content: [{ type: "text", text: "Edited file" }],
    details: { diff: '-34 ] ;\n+34 ] as const satisfies Readonly<CreateApiKey["scopes"]>;', firstChangedLine: 34 },
    isError: false,
  };
  const { component, setMobile } = tool("edit", args, definition);
  component.updateResult(result);
  component.setExpanded(true);
  const native = new ToolExecutionComponent("edit", "native", args, { showImages: false }, definition, ui, process.cwd());
  native.updateResult(result);
  native.setExpanded(true);
  for (const width of [40, 24, 60, 40]) {
    const lines = component.render(width);
    const wrapped = lines.find((line) => line.includes("\x1b[7m") && !line.includes("\x1b[27m"));
    assert.ok(wrapped, "fixture must wrap before the inverse highlight closes");
    assert.deepEqual(frameBody(component, width), native.render(width - 3).slice(1).map((line) => styledCells(line, width - 3)));
    assert.ok(lines.every((line) => visibleWidth(line) <= width));
  }
  assert.ok(component.render(5).slice(1).every((line) => styledCells(line, 5).at(-1) === " "));
  component.setExpanded(false);
  assert.doesNotMatch(component.render(40).join("\n"), /\x1b\[7m/);
  component.setExpanded(true);
  setMobile(false);
  assert.deepEqual(component.render(40), native.render(40));
});

test("short custom tool highlights do not color frame padding or the narrow gutter", () => {
  const { component } = tool("custom_tool", {}, {
    renderShell: "self",
    renderCall: () => ({ render: () => ["\x1b[7mhi"], invalidate() {} }),
  });
  component.setExpanded(true);
  const [body] = frameBody(component, 20);
  assert.deepEqual(body.slice(0, 2), styledCells("\x1b[7mhi", 2));
  assert.ok(body.slice(2).every((cell) => cell === " "));
  const narrow = styledCells(component.render(5)[1], 5);
  assert.deepEqual(narrow.slice(0, 2), styledCells("\x1b[7mhi", 2));
  assert.ok(narrow.slice(2).every((cell) => cell === " "));
});

test("Pi's auto scrollbar only covers the gutter, leaving frame corners and contents intact", () => {
  const { component } = tool("read", { path: "src/中文.ts" });
  component.updateResult({ content: [{ type: "text", text: "file contents" }], isError: false });
  const document = new Container();
  document.addChild(component);
  document.addChild(new Text("tail\n".repeat(12), 0, 0));
  const scrollView = new ScrollView(document, { scrollbar: "auto" });
  const render = () => renderLayoutFrame(scrollView, 40, 8, () => {}).lines.map((line) => {
    const text = stripTerminalSequences(line);
    return text + " ".repeat(Math.max(0, 40 - visibleWidth(text)));
  });
  try {
    const hidden = render();
    scrollView.setScrollbarActive(true);
    const visible = render();
    assert.equal(scrollView.isScrollbarVisible, true);
    assert.ok(visible.some((line) => /[│┃█]/.test(sliceByColumn(line, 39, 1))));
    assert.deepEqual(visible.map((line) => sliceByColumn(line, 0, 39)), hidden.map((line) => sliceByColumn(line, 0, 39)));
    const top = visible.findIndex((line) => line.startsWith("╭"));
    const bottom = visible.findIndex((line) => line.startsWith("╰"));
    assert.ok(top >= 0 && bottom > top);
    assert.equal(sliceByColumn(visible[top], 38, 1), "╮");
    assert.equal(sliceByColumn(visible[bottom], 38, 1), "╯");
    scrollView.setScrollbarActive(false);
    scrollView.setScrollbar("hidden");
    assert.deepEqual(render(), hidden);
  } finally {
    scrollView.setScrollbar("hidden");
  }
});

test("frame colors follow Pi theme changes", () => {
  const capabilities = getCapabilities();
  try {
    // Both palettes' dim colors quantize to the same ANSI index in 256-color mode.
    setCapabilities({ ...capabilities, trueColor: true });
    initTheme("dark", false);
    const { component } = tool("read", { path: "src/example.ts" });
    component.updateResult({ content: [{ type: "text", text: "output" }], isError: false });
    const darkBorder = component.render(40)[1];
    initTheme("light", false);
    component.invalidate();
    assert.equal(component.render(40)[1], rendererTheme().fg("dim", `╭${"─".repeat(37)}╮`) + " ");
    assert.notEqual(component.render(40)[1], darkBorder);
  } finally {
    setCapabilities(capabilities);
    initTheme("dark", false);
  }
});

test("frames forward custom child mouse coordinates and focus unchanged", () => {
  const seen: TuiMouseEvent[] = [];
  const original: ToolRenderers = {
    renderShell: "self",
    renderCall: () => new MouseRegion(new Text("custom control", 0, 0), (event) => {
      seen.push(event);
      return { handled: true, focus: true };
    }),
  };
  const { component, setMobile } = tool("custom_tool", {}, original);
  component.updateResult({ content: [], isError: false });
  component.setExpanded(true);
  function tapControl() {
    const lines = plain(component);
    const y = lines.findIndex((line) => line.includes("custom control"));
    assert.ok(y >= 0);
    const result = component.handleMouse({
      type: "click", button: "left", x: 2, y, screenX: 2, screenY: y,
      width: 40, height: lines.length, shift: false, alt: false, ctrl: false,
    });
    assert.equal(result?.handled, true);
    assert.equal(result?.focus, true);
  }
  tapControl();
  assert.equal(seen[0].x, 1);
  assert.equal(seen[0].y, 0);
  assert.equal(seen[0].width, 37);
  assert.equal(seen[0].height, 1);
  setMobile(false);
  tapControl();
  assert.equal(seen[1].x, 2);
  assert.equal(seen[1].y, 0);
  assert.equal(seen[1].width, 40);
});

test("streaming arguments and results stay folded; errors show on the same row", () => {
  const { component } = tool("bash", { command: "npm test\nwith more arguments" }, createBashToolDefinition(process.cwd()) as ToolRenderers);
  component.updateResult({ content: [{ type: "text", text: "partial output\nsecond line" }], isError: false }, true);
  assert.equal(content(component).length, 1);
  assert.match(content(component)[0], /◌/);
  assert.doesNotMatch(content(component)[0], /partial output/);
  component.updateResult({ content: [{ type: "text", text: "Test failed\nstack trace" }], isError: true });
  assert.equal(content(component, 100).length, 1);
  assert.match(content(component, 100)[0], /✗.*Test failed/);
  assert.doesNotMatch(content(component, 100)[0], /stack trace/);
});

test("pending tools regain native backgrounds when expanded; completed status colors stay on the icon", () => {
  const theme = rendererTheme();
  const definition = createBashToolDefinition(process.cwd()) as ToolRenderers;
  const { component } = tool("bash", { command: "npm test" }, definition);
  const background = /\x1b\[(?:4[0-7]|10[0-7]|48[;:])[^m]*m/;
  assert.doesNotMatch(component.render(100).join("\n"), background);
  component.setExpanded(true);
  assert.ok(component.render(100).join("\n").includes(theme.getBgAnsi("toolPendingBg")));
  component.setExpanded(false);
  for (const isError of [false, true]) {
    const result = { content: [{ type: "text", text: isError ? "Test failed" : "Tests passed" }], isError };
    component.updateResult(result);
    const collapsed = component.render(100).join("\n");
    assert.doesNotMatch(collapsed, background);
    assert.ok(collapsed.includes(theme.fg(isError ? "error" : "success", isError ? "✗" : "✓")));
    if (isError) assert.ok(!collapsed.includes(theme.fg("error", " — Test failed")));
  }
});

test("Unicode summaries survive resizing to tiny widths and disarm control sequences", () => {
  const { component } = tool("read", { path: "中文/👩‍💻/\x1b[31mlong\nfile.ts\x1b[0m" });
  component.updateResult({ content: [{ type: "text", text: "secret output" }], isError: false });
  for (const width of [40, 12, 6, 5, 1, 2, 3, 4, 20, 40]) {
    assert.ok(component.render(width).every((line) => visibleWidth(line) <= width));
    if (width >= 12) {
      assert.equal(content(component, width).length, 1);
      assert.ok(plain(component, width).some((line) => line.startsWith("╭")));
    }
  }
  assert.doesNotMatch(content(component, 100)[0], /\x1b|\n|secret output/);
});

test("custom tool details and interactive state survive folding and owner handoffs", () => {
  class DetailControl extends MouseRegion {
    private clicks = 0;
    constructor(label: string) {
      const text = new Text(`${label}: 0`, 0, 0);
      super(text, () => {
        text.setText(`${label}: ${++this.clicks}`);
        return { handled: true };
      });
    }
  }
  const details = { nestedCalls: [{ name: "read", status: "success" }] };
  const original: ToolRenderers = {
    renderShell: "self",
    renderCall: (_args, _theme, context) => context.lastComponent ?? new DetailControl("script control"),
    renderResult(result, _options, _theme, context) {
      const nested = result.details.nestedCalls[0];
      return context.lastComponent ?? new DetailControl(`${nested.name} ${nested.status}`);
    },
  };
  const { component, setMobile } = tool("codemode", { code: "tools.read(...)" }, original);
  component.updateResult({ content: [{ type: "text", text: "result" }], details, isError: false });
  assert.equal(content(component).length, 1);
  clickRow(component, "codemode");
  clickRow(component, "script control");
  clickRow(component, "read success");
  clickRow(component, "read success");
  const assertDetails = () => {
    assert.match(content(component).join("\n"), /script control: 1/);
    assert.match(content(component).join("\n"), /read success: 2/);
  };
  assertDetails();
  component.setExpanded(false);
  assert.equal(content(component).length, 1);
  component.setExpanded(true);
  assertDetails();
  setMobile(false);
  assertDetails();
  setMobile(true);
  assertDetails();
});

test("HTML exports retain results when call and result renderers are resolved independently", () => {
  const original: ToolRenderers = {
    renderCall: () => new Text("custom call", 0, 0),
    renderResult: (result) => new Text(result.content.map((block) => block.type === "text" ? block.text : "").join("\n"), 0, 0),
  };
  for (const mobile of [false, true]) {
    const html = createToolHtmlRenderer({
      theme: rendererTheme(),
      cwd: process.cwd(),
      getToolRenderers: (name) => compactToolRenderer(name, original, () => mobile, () => {}),
    });
    assert.ok(html.renderCall("call:export", "custom_tool", {}));
    const result = html.renderResult("call:export", "custom_tool", [{ type: "text", text: "preserved result" }], undefined, false);
    assert.match(result?.expanded ?? "", /preserved result/);
  }
});

test("generic fallbacks match native formatting, sanitization, previews, and image placeholders", () => {
  const args = { query: "example", options: { limit: 20 } };
  const result = {
    content: [
      { type: "text", text: "remote\x1b[2J\x1b]52;c;ZXhhbXBsZQ==\x07text\n" + Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n") },
      { type: "image", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=", mimeType: "image/png" },
    ],
    isError: false,
  };
  const definitions: (ToolRenderers | undefined)[] = [
    undefined,
    {},
    { renderCall: () => new Text("custom call", 0, 0) },
    { renderResult: () => new Text("custom result", 0, 0) },
  ];
  for (const definition of definitions) {
    const { component, setMobile } = tool("external_tool", args, definition);
    component.updateResult(result);
    const baseline = new ToolExecutionComponent("external_tool", "native", args, { showImages: false }, definition, ui, process.cwd());
    baseline.updateResult(result);
    for (const expanded of [false, true]) {
      setMobile(false);
      component.setExpanded(expanded);
      baseline.setExpanded(expanded);
      assert.deepEqual(component.render(60), baseline.render(60));
      assert.doesNotMatch(component.render(60).join("\n"), /\x1b\[2J|\x1b\]52;/);
      setMobile(true);
      if (expanded) {
        const nativeBody = baseline.render(37).slice(2, -1);
        assert.deepEqual(frameBody(component), nativeBody.map((line) => styledCells(line, 37)));
        if (!definition?.renderResult) assert.match(content(component).join("\n"), /image\/png/);
      } else {
        assert.equal(content(component).length, 1);
        assert.doesNotMatch(content(component).join("\n"), /remote|line 0/);
      }
    }
  }
});

test("native streaming timers stop when the tool completes after an iOS handoff", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let redraws = 0;
  let mobile = false;
  const renderer = compactToolRenderer("bash", createBashToolDefinition(process.cwd()) as ToolRenderers, () => mobile, () => {});
  const component = new ToolExecutionComponent("bash", "streaming", { command: "long task" }, { showImages: false }, renderer, {
    requestRender() { redraws++; },
  } as TUI, process.cwd());
  component.setArgsComplete();
  component.markExecutionStarted();
  component.updateResult({ content: [{ type: "text", text: "progress" }], isError: false }, true);
  const beforeTick = redraws;
  t.mock.timers.tick(1000);
  assert.ok(redraws > beforeTick, "native streaming timer should request redraws");
  mobile = true;
  component.invalidate();
  component.updateResult({ content: [{ type: "text", text: "finished output" }], isError: false, durationMs: 1000 });
  assert.equal(content(component).length, 1);
  assert.match(content(component)[0], /✓/);
  const afterCompletion = redraws;
  t.mock.timers.tick(3000);
  assert.equal(redraws, afterCompletion, "completed hidden tools must stop periodic redraws");
  component.setExpanded(true);
  assert.match(content(component).join("\n"), /finished output/);
});

test("unknown tools have an expandable raw argument/result fallback", () => {
  const { component } = tool("external_tool", { query: "example" });
  component.updateResult({ content: [{ type: "text", text: "external result" }], isError: false });
  assert.equal(content(component).length, 1);
  clickRow(component, "external_tool");
  assert.ok(component.render(40).join("\n").includes(rendererTheme().getBgAnsi("toolSuccessBg")));
  assert.match(content(component).join("\n"), /example/);
  assert.match(content(component).join("\n"), /external result/);
});
