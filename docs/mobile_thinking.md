# Mobile thinking defaults

The ownership policy is deliberately small:

- On iOS ownership, if thinking is visible, send Ctrl+T. Remember desktop restoration only after the collapse is confirmed.
- On desktop ownership, restore thinking only if pi-rex previously collapsed it. If the user already expanded it, just clear the restoration flag.

Pi keeps its native **Thinking...** label, expansion controls, model thinking level and saved messages. Existing tool rendering and authenticated ownership detection are unchanged. No Pi patches, new settings or dependencies are required.

## Guarded key delivery

One helper handles the mechanics: targeting the current Rex session/block, stock-editor focus and raw-input readiness, shortcut conflicts, duplicate input, bounded confirmation and cancellation. Ownership updates are serialized; a pending update waits for editor focus instead of sending into a dialog or external editor. Failed or unconfirmed delivery warns and is not retried blindly. Normal manual expansion is not continuously overridden.

The zero-row widget exists only because Pi exposes TUI focus through component factories, not directly through the extension context. It adds no visible rows or controls. Custom editors and remapped/conflicting Ctrl+T bindings are not automated.

## Teardown and limits

Shutdown, reload and session replacement only stop automation. There is no reload restoration, lifecycle state machine, ownership revision tracking or persisted restoration metadata. Desktop restoration is the only restoration policy.

Pi's existing visibility preference is global and persisted. Exiting or reloading while mobile can therefore leave thinking hidden; use Ctrl+T manually to restore it. A key already accepted by Rex cannot be recalled if another program takes input after dispatch. Project-level overrides and other input listeners can prevent confirmation.

## Decisions — least confident first

1. Keep one pending ownership update and one running promise so delayed delivery and returning focus do not require epochs or a general controller. The unasked choice was how to serialize the two policy branches: finish the current guarded send, then reconcile the latest ownership state.
2. Keep the input guards and native confirmation separate from the policy. An undefined helper result means input was safely consumed after focus changed and can wait for the editor; false means no confirmed change. The unasked choice was how to expose safe deferral without a lifecycle/state machine.
3. Keep one generic confirmation warning instead of failure-phase metadata. The unasked choice was diagnostic detail: retain a visible warning and no blind retries, without separately classifying CLI failure versus missing visibility confirmation.

## Validation boundary

Tests use real Pi TUI/editor/message components with an in-memory settings manager and a local Rex CLI/socket fixture. They protect native output and saved messages, existing desktop preferences, regular/fullscreen mode, wrong-focus and paused-input guards, delayed/manual input races, delivery failure/recovery, shortcut conflicts and teardown without restoration keys.

All 48 tests, strict types and package verification pass on Node 22/24; actual Pi 1.5 types/tests and forced-color checks also pass. Packaging retains the exact six-file artifact.

Actual Rex iOS routing/ownership effects, real foreground-program transitions, Linux and SDKs beyond the exercised Pi 1.4/1.5 remain unverified. No live input, automatic reload or npm release is part of this change.
