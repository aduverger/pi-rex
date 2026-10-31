# P0: a separate Rex conversation viewer for Pi

## Agreed intent

Keep the existing Pi TUI running in its original Rex block. Add a second terminal block, in a separate tab, presenting the same conversation as a Bergère-style TUI. Pi remains the sole owner of agent execution and session files.

- Create or reuse the viewer when an iOS app owns the original Pi block. Do not switch focus, rearrange the desktop, or hide either tab in P0.
- Follow the original Pi process across conversation switches, forks, resume, and reload. Reject commands for a previous attachment/conversation.
- Close the viewer when its Pi process exits. Closing the viewer must not stop Pi or immediately recreate the tab. A later desktop-to-iOS handoff or an explicit command may reopen it.
- Exchange structured state and commands through Rex client actions, not terminal scraping, simulated typing, another socket server, or a web gateway.
- Independent composers: no draft, cursor, or keystroke synchronization.
- Support messages, steering, follow-ups, stop, extension commands such as `/ship`, and standard confirm/select/input/editor dialogs from the viewer. Either surface may answer a standard dialog; only the first valid answer wins.
- Show Markdown, code, reasoning in its original position, and individually expandable tool cards. Fold runs of more than five consecutive tools into expandable groups. Preserve nested-call identities supplied by Pi; do not infer missing calls.
- Text-first: show image placeholders, not inline Kitty graphics. Model/thinking controls and arbitrary custom extension TUI screens are out of P0. Do not silently send unsupported terminal-only commands to the model.
- Keep the existing compact renderer and desktop behavior intact. Do not change Rex keyboard settings; the user already selected manual keyboard opening.

## Existing paths and ownership

- `src/index.ts`, `src/rex.ts`, and `src/render.ts` currently own compact rendering and iOS-owner detection. Retain that path and use its ownership transitions to trigger the viewer.
- Bergère's `src/extension` and `src/shared` demonstrate same-process event projection, commands, and first-answer-wins dialogs. Reuse the concepts without its Herdr discovery, web frontend, gateway, persistence, or deployment machinery.
- Pi public extension events provide messages, tool lifecycle, session changes, and standard UI APIs. Saved active-branch entries supply history; partial content is a disposable projection.
- Rex `client.keymap` advertises actions, `client.perform` routes requests, and `client.reply` answers them on the same persistent connection. The server authenticates the connection; labels are discovery metadata, never proof of authority.

## Implementation sequence

### 1. Validate the integration seams

- Read the installed Pi interfaces/examples and the running Rex server's control protocol.
- Add a small typed Rex control client using a mature WebSocket library. Discover the existing local endpoint without autostarting or reconfiguring Rex; negotiate a supported protocol revision and obey message limits.
- Prove request/reply, client-action registration, and callbacks against an isolated Rex server. Keep live user sessions and settings unchanged.
- Verify that standard Pi UI wrappers can coordinate answers and cancellation on the installed version. Do not mutate private Pi TUI components.

### 2. Bridge one existing Pi process

- Maintain one Rex connection for the bridge, advertise bounded state/history/detail and command actions, and bind them to this process, Rex block, and current Pi conversation generation.
- Project the active branch plus live message/tool events. Keep source information, sanitize text only at rendering, and bound transport pages by bytes rather than assuming the whole transcript fits one Rex response.
- Coalesce state invalidations; never issue an action per token or hold a Rex request while waiting for another client to call back.
- Give commands IDs and reject stale generations. Retain outcomes for the live attachment so an uncertain response cannot duplicate a prompt; do not automatically replay an uncertain send after a reload.
- Bridge standard dialogs with explicit IDs, first-answer-wins completion, cancellation, timeouts, and cleanup. Keep unsupported custom UI explicit rather than presenting it as a working mobile control.

### 3. Manage the viewer tab

- Create a shell-flavor terminal that runs the packaged Node viewer directly, not another Pi. Use the existing Node engine requirement and pass explicit source process/block identity.
- Create without focus, and reuse only a viewer associated with the same source process. Register `/rex-view` for explicit opening/reopening.
- Retain/reacquire the viewer across `/reload`; distinguish transient bridge loss from actual process death. The viewer must never execute a stale command while disconnected.
- Do not spawn or restart Pi. Closing the viewer affects only that view.

### 4. Build the text TUI

- Use Pi's public TUI primitives for fullscreen layout, scrolling, mouse input, Markdown, editor, and selection dialogs.
- Render a current state snapshot and subsequent changes. Preserve scrolling/folding/drafts locally while refreshing state; session changes must not submit an old draft into another conversation.
- Keep a multiline composer and visible send/steer/follow-up/stop controls usable without a hardware keyboard. Standard pending dialogs take precedence over normal submission.
- Tool cards reveal arguments and results on demand, with explicit unavailable-output notices where historical nested results were not saved. Group consecutive tools using the existing Bergère threshold, without grouping across prose/reasoning.
- Do not implement another native mobile app, image-rendered chat canvas, generic remote-TUI engine, or durable harness integration.

### 5. Validate and document

- Preserve existing renderer/owner tests. Add real protocol-boundary tests for routing, reconnect, stale generations, bounded history/detail payloads, uncertain sends, dialog races/timeouts, and lifecycle.
- Exercise actual Pi extension loading and real TUI rendering with deterministic fixtures; use an isolated Rex server for actual routing and tab lifecycle. No production model credentials are required for fixtures.
- Verify the principal flow: iOS ownership -> one unfocused viewer -> current/live conversation -> submit -> standard dialog answer -> reload -> same viewer -> Pi exit -> viewer closes.
- Verify failure paths: viewer close leaves Pi alive, lost bridge disables commands and recovers, old-session commands fail, and lost send acknowledgement does not duplicate submission.
- Run `make check`, `npm run pack:check`, and `git diff --check`. Update package artifact verification for the viewer entry point and runtime files.
- Document usage, exact supported interactions, dependency/version requirements, and checks still requiring Rex iOS device verification.

## Implementation boundaries

- `src/control.ts`: existing Unix-socket Rex protocol, revision negotiation, bounded requests, caller principals, routed actions, and replies.
- `src/conversation.ts`, `src/view-state.ts`: disposable branch/live projection, chunked reads, and command outcomes. Hidden custom state entries are not conversation messages. Image bytes are not forwarded as transcript/tool content.
- `src/dialogs.ts`: standard dialogs and notifications, cancellation, first-answer-wins completion, unsupported custom-screen detection, and restoration.
- `src/bridge.ts`: Pi-owned execution, session generations, authenticated viewer attachment, unfocused tab creation, and ownership/lifecycle coordination.
- `src/viewer-connection.ts`: discovery, attachment, snapshot reads, disconnect recovery, and explicit handling of uncertain commands.
- `src/viewer.ts`, `src/viewer-ui.ts`: standalone text TUI, independent composer/drafts, native scrolling/selection, cards/groups, and mobile controls.
- `src/index.ts`, `src/rex.ts`: existing renderer integration. Verified ownership observations drive tab creation separately from rendering's safe fallback on query failure. `src/render.ts` is unchanged.

## Validation status

Implemented on branch `viewer`, from `148918e` (0.1.1). Local runtime: Node 24.15.0, Pi 1.4.0, Rex `0.0.1793420730-g6d0d9a`; Rex advertises revision 9 and successfully negotiates revision 7.

Passed:

- `PI_TRUE_COLOR=0 make check`: strict TypeScript, **44 tests**, exact package artifact verification.
- `PI_TRUE_COLOR=0 npm run pack:check`: prepack gates and the 14-file source artifact. The integration fixture explicitly disables inherited npm dry-run mode for its own temporary archive, avoiding a missing-archive failure when run from prepack.
- `FORCE_COLOR=3 PI_TRUE_COLOR=1 node --test test/render.test.ts test/viewer-ui.test.ts`: **26 tests**.
- `npm audit --omit=dev`: zero reported vulnerabilities in the declared production dependency tree. The existing Pi 1.4.0 host/dev dependency-chain advisories remain; this is not an audit of an independently installed Pi host.
- `git diff --check`.

The real integration test installs the packed artifact under a temporary `node_modules`, starts a real Pi TUI in an isolated Rex server, and uses a deterministic local provider instead of model credentials. It verifies:

- Desktop startup and merely attaching an iOS-identified control client create no tab; actual ownership creates one without changing the active window.
- An unrelated local process cannot claim the viewer's block attachment.
- Viewer submission/streaming, steer, follow-up, stop, explicit `/model` rejection, extension notifications, and all four standard dialog types. Answering on the original surface also dismisses the mobile dialog.
- More-than-five grouping; the native-TUI tests additionally exercise actual mouse press/release routing, nested card expansion, retained folds/scroll position, and narrow widths. A 40×10 keyboard-sized viewport retains the full multiline editor answer and touch controls; long approval details remain scrollable rather than being silently clipped. Uncertainty controls remain reachable during a pending dialog.
- Reload reconnects the same tab; fork/resume/new-session transitions follow the same Pi process. Drafts are retained separately and restored on resume, without automatic submission or late-acknowledgement loss.
- Closing the viewer leaves Pi alive and does not respawn it, including across reload. A later ownership handoff or `/rex-view` reopens it. Pi exit closes it.

Additional tests cover Unicode/control text across transport pages, concurrent detail reads, nested identities and unavailable historical output, dialog validation/races/timeouts/shutdown, and disconnected submissions. A routed-action fixture injects a timeout **after** command execution: background recovery does not replay it, explicit retry is deduplicated, and a new generation refuses replay. Counterfactual removal of command deduplication makes that test fail with two deliveries instead of one. Temporary mutations were restored. Removing extra press interception still passed the native-TUI tests, so the implementation retains Pi's native selection/click synthesis rather than intercepting presses unnecessarily.

### Still unverified / upstream boundaries

- Real Rex iOS touch selection, keyboard-driven resize, long-conversation performance, and visual polish require device validation. An iOS-labelled test control client is not the native app.
- Node 22, a Bun-hosted Pi binary, and Linux were not exercised locally. Tests explicitly skip real Rex integration when its CLI is absent; CI alone does not imply device/server validation.
- Pi's public extension `sendUserMessage()` acknowledges dispatch, not eventual acceptance/execution. The viewer mirrors conversation errors and standard `ctx.ui.notify()` notifications; Pi-internal errors that exist only in its private TUI are not intercepted. Startup interactions before this extension is active are also outside its bridge.
- Built-in model/thinking controls, arbitrary custom TUI screens, and inline images remain excluded as agreed. Native custom tool renderers are not imported into the viewer; it exposes arguments/results and native edit diff formatting instead.
- Original-tab spacing and HTML-export limitations are unchanged; see `docs/compact_tools.md`. The wrapped-highlight fix still needs live iOS confirmation separately.

## Decision ledger

Choices where the product decisions did not prescribe a mechanism, least-confident first:

1. **Dispatch acknowledgement:** use Pi's public, void-returning send API and acknowledge its invocation, not eventual execution. This avoids private runtime access and long-lived action requests. If asking were free, I would confirm the desired UX for Pi-internal errors unavailable through public events; the limitation is explicit above.
2. **Tool grouping:** count consecutive root calls for the greater-than-five threshold, keep children inside their parent, and count all included calls in the group heading. Prose/reasoning breaks a run. If asking were free, I would confirm whether nested calls should instead count toward the threshold.
3. **Composer defaults:** Enter sends while idle and steers while busy; Shift+Enter inserts a newline. Separate touch buttons expose send/steer/follow-up/stop. If asking were free, I would confirm steering versus follow-up as the busy Enter default. Ctrl+O toggles tools/groups; Ctrl+Q or empty Ctrl+D closes only the viewer.
4. **Viewer presentation:** use Pi's system theme, public Markdown/editor/select primitives, raw text arguments/results, and its public edit-diff formatter. There is no theme synchronization or execution of custom renderers in the viewer. Native selection/click synthesis is retained; only small wrapping action rows and neutral cards are new UI components.
5. **Independent drafts:** retain them only in the viewer's memory, keyed by Pi session ID. A new conversation starts blank; returning restores its own draft. Reload preserves same-session folds/drafts. Acknowledgements clear only the matching original draft, not subsequent edits or an equal draft in another conversation. Closing the viewer discards these local drafts.
6. **Standard UI:** wrap the shared public UI methods and restore them on shutdown. For the standard editor only, instantiate Pi's public `ExtensionEditorComponent` through its custom-UI API so an answer on the viewer can cancel the original editor; `ui.editor()` itself has no abort option. Other custom screens are merely flagged unsupported. Show the newest pending dialog first and give it the viewer's main area; the ordinary composer stays local but hidden. Keep its controls fixed and the full question/approval text scrollable, including with the keyboard open. Uncertainty actions take precedence even during a dialog. Mirror the latest standard notification in a bounded banner until another notification or a valid new prompt replaces it.
7. **Reload/intentional close:** retain the last verified ownership and pending opening intent in process-local state keyed by the original Rex session/block. No JSONL metadata or disk state is added. Shutdown and failed queries do not fabricate desktop handoffs; reconnect/reload alone never authorizes recreating a manually closed tab.
8. **Process identity and exit:** bind discovery to Rex's same-UID/PID principals and to the source block/process. On macOS Rex reports a `login` wrapper as the terminal process, so viewer attachment accepts its verified OS descendants as well. Probe the source PID once per second for exit; temporary control disconnects and `/reload` keep the viewer alive. No supervisor or second Pi runtime is introduced.
9. **Transport scope:** support the existing local Unix endpoint and negotiate revision 7; reject unsupported endpoints visibly rather than invent TCP authentication. Labels help discovery/reuse but are not authentication. Bridge reconnect waits two seconds; viewer attachment recovery waits one second. Command retries are always explicit and preserve the original command ID/generation.
10. **State transport:** coalesce invalidations for 100 ms, pull snapshots rather than emit per-token actions, page history in 50-entry windows, and fetch tool details on demand. Split JSON into 8,000-code-unit chunks: even worst-case wire escaping stays below Rex's 64 KiB minimum limit. Completed reads are released; replacing an attachment clears unfinished reads. No second transcript store is created.
11. **Packaging:** retain the source-based package. Use `ws` for the mature transport and `jiti/register` for the viewer because Node cannot natively strip TypeScript inside `node_modules`. A Node-hosted Pi reuses its executable; other hosts resolve Node from PATH. Pin the test provider's Pi AI SDK to the same 1.4.0 development runtime. No build pipeline, gateway, settings changes, or publication is added.
12. **Testing:** use temporary real Rex servers and the actual packed Pi extension/viewer, with a deterministic local provider. This avoids live configuration changes and model credentials. Skip only these integration tests if Rex is absent; native TUI/projection/protocol tests still run. Real device validation is not inferred from these fixtures.

## Ship simplification review

The agreed intent is the user requirement; the decision ledger records agent-selected mechanisms, not additional approved product requirements. Preserve both for independent review and the PR description.

### Disposition points, behavior preserved

- Dispatch-only acknowledgement and missing Pi-private-TUI error visibility may fall short of the requested self-contained mobile workflow. This is a disclosed implementation boundary, not an explicitly accepted product exclusion like custom screens or model/thinking controls.
- The greater-than-five threshold currently counts root calls, whereas the user specified consecutive tool calls without defining nested-call counting. Preserve the implementation pending review disposition.
- Prompt-template/skill dispatch, notification mirroring, per-conversation in-memory draft restoration, system-theme selection, busy Enter steering, and the extra keyboard shortcuts are agent-introduced behavior/UX choices. They remain intact rather than being removed as unrequested features.

### Simplification decisions, least-confident first

1. Keep the current projected tool records and derive requested details directly from them instead of eagerly copying every tool into a second derived detail map. Detail values, image placeholders, branch visibility, and on-demand transport remain unchanged; no object-identity contract is introduced.
2. Use bridge presence as the session activation state, share the session-start/tree restart path, and forward Pi's own event type instead of capturing a duplicate type string for each listener. Ownership intent, caller verification, generation checks, cancellation, and explicit command deduplication remain separate required protections.
3. Expand nested status/content/role conditionals into direct branches, and name chunk-read keys by their actual view/detail scope. No new abstractions, public API changes, or test curation are needed.

Compared with the existing renderer, Pi's public TUI primitives, and Bergère's dialog bridge, the remaining transport, paging, uncertainty ledger, process-local reload state, and dialog cancellation each address an agreed behavior or an exercised failure. Wrapping action rows and cards cover layout the shared primitives do not directly supply; no gateway, generic provider layer, supervisor, or second transcript store is added.

Revalidation: `PI_TRUE_COLOR=0 make check` passed (strict TypeScript, all 44 tests including isolated real Pi/Rex lifecycle and uncertain-command recovery, and package verification); `git diff --check` passed. Test files were left unchanged for the Test phase. No commits or out-of-scope edits were made. Live iOS, Node 22, Bun-hosted Pi, and Linux validation remain outstanding as recorded above.
