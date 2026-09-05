# pi-antigravity-acp-provider

A first-class [Pi](https://github.com/earendil-works/pi) provider for **Google Antigravity** through its official ACP server.

> **Important:** this package no longer uses `@google/gemini-cli`. The Gemini CLI individual Code Assist login path was retired and is not a supported authentication route. Antigravity/`agy` is the target runtime.

## Features

- Registers `antigravity-acp/*` models backed by Google Antigravity.
- Uses ACP protocol v1 and the official TypeScript SDK.
- Collapses Antigravity's effort-qualified IDs into one entry per model; Pi's Shift+Tab reasoning control selects low/medium/high dynamically.
- Supports Pi streaming, cancellation, usage/quota metadata, lifecycle cleanup, and persisted ACP session restoration across Pi restarts.
- Routes compatible Pi tools through an authenticated loopback MCP bridge.
- Supports persisted `default`, `auto-edit`, and `yolo` Antigravity permission modes. The requested default is `yolo`; switching to a prompting mode retains the single-use, fail-closed Pi permission broker.
- Advertises no ACP filesystem or terminal client capabilities.
- Provides setup, auth-health, logout/account-switching, qualification, quota, and runtime-update commands.
- Uses a self-service ACP registry installer with exact Google artifact URLs, pinned archive SHA-256 hashes for every supported platform, Linux x64 binary verification, musl rejection, macOS quarantine cleanup, and Windows process-tree handling.

## New-user setup

Install from the official Pi package gallery/npm:

```bash
pi install npm:pi-antigravity-acp-provider
pi
```

To run from source instead:

```bash
git clone https://github.com/zacbemis/pi-antigravity-acp-provider.git
cd pi-antigravity-acp-provider
npm install
pi --no-extensions -e ./extensions/index.ts
```

In Pi:

1. Optionally run `/antigravity-acp setup` for a runtime/auth preflight.
2. Run `/login`.
3. Choose **Sign in with an account**.
4. Choose **Google Antigravity (ACP)**.
5. If needed, wait for the official ACP server download and extraction. Progress is shown; the Linux build observed during development expands to about 1.8 GB.
6. Complete the Google login in the browser.
7. Run `/antigravity-acp setup` again to perform a network auth probe and model discovery.
8. Run `/model` and select one of the `antigravity-acp` models.
9. Press **Shift+Tab** to choose the reasoning effort. Flash models expose low, medium, and high; Pro exposes only the tiers advertised by Antigravity.
10. Send a prompt. The default permission mode is `yolo`, so Antigravity-native commands and edits can run without confirmation.

The provider first looks at `AGY_ACP_BIN`, `~/.local/bin/agy_acp_server.par`, the managed `~/.local/opt/agy-acp/current/` location, and `PATH`. If absent, it installs the platform build published in the ACP registry. A global `agy` or `gemini` command is not required.

### SSH and headless Google login

When Pi is running over SSH, or on Linux without `DISPLAY`/`WAYLAND_DISPLAY`, `/login` automatically uses a manual browser relay:

1. Pi prints the Google authorization URL instead of trying to launch a browser on the server.
2. Open that URL in a browser on your local machine and finish Google sign-in.
3. Google redirects to an Antigravity loopback URL. The page may show a connection error because `127.0.0.1` refers to your local machine; copy the **complete final URL** from the browser address bar.
4. Paste that URL into Pi. The provider validates its host, port, path, and OAuth state, then relays it to Antigravity's loopback listener on the server. An SSH port-forward is not required.

Set `PI_ANTIGRAVITY_ACP_OAUTH_MODE=manual` to force this flow, or `PI_ANTIGRAVITY_ACP_OAUTH_MODE=browser` to force normal browser launch. OAuth URLs and callback codes are kept in a private temporary directory only for the duration of login and are never logged or persisted by this package.

For API-key authentication, choose **Enter an API key** and then **Antigravity Gemini API key** in `/login`, or set `GEMINI_API_KEY` before starting Pi.

Antigravity owns OAuth tokens under `~/.gemini/antigravity-acp/`; Pi stores only a non-secret configured marker. Existing `agy` CLI credentials and Gemini CLI credentials should not be assumed to authenticate this separate ACP server.

## Commands

```text
/antigravity-acp setup
/antigravity-acp doctor
/antigravity-acp doctor --verbose
/antigravity-acp status
/antigravity-acp quota
/antigravity-acp update
/antigravity-acp qualify
/antigravity-acp logout
/antigravity-acp account
/antigravity-acp permissions
/antigravity-acp permissions default
/antigravity-acp permissions auto-edit
/antigravity-acp permissions yolo
```

Permission mode is saved in `~/.pi/agent/antigravity-acp-provider/config.json` and applied immediately to active compatible sessions as well as future sessions. ACP session bindings are saved beside it in `sessions.json`.

`logout`/`account` clears local Antigravity credentials and saved ACP sessions. Run Pi's `/logout` afterward to remove the Pi credential marker, then `/login` for the new account. `update` only installs the runtime version pinned by this package; install a newer provider release to trust a newer upstream runtime.

## Development

```bash
npm run check
npm run test:real-acp  # initializes the installed Antigravity ACP server
npm run test:live      # sends a real authenticated prompt
npm run test:qualify   # live cancel, restore, MCP, model, and permission qualification
npm run test:packed
npm audit --audit-level=high
```

## Security boundary

This launches a full coding agent with the user's OS privileges. **The default `yolo` mode permits Antigravity-native commands and edits without confirmation.** Use `/antigravity-acp permissions default` for confirmation prompts. Disabling ACP filesystem/terminal **client callbacks is not a sandbox** for Antigravity-native tools. Pi hooks govern tools routed through the `pi_` MCP namespace; Antigravity-native tools remain governed by Antigravity policy and ACP permission requests.

## Compatibility

The implementation is pinned to Pi 0.85.0, ACP SDK 0.16.1, Antigravity ACP 1.1.1, and ACP protocol 1. The official registry currently provides Linux x64/ARM64, Windows x64/ARM64, and macOS ARM64 artifacts. Intel macOS has no pinned artifact, and Alpine/musl is rejected because Google's Linux build targets glibc.

During browser authentication, Chromium may write `Opening in existing browser session.` to the ACP process's inherited stdout. The transport ignores only that exact known compatibility line and reports its count in `doctor`; all other non-JSON stdout remains a fatal protocol error.

Managed installations also repair executable permissions for both the ACP server and its `localharness_external` helper. This repairs installations created by 0.1.3 and earlier, where OAuth could succeed but session creation failed with an opaque ACP `Internal error` because the extracted helper was not executable.

Earlier repository documents analyzing `@google/gemini-cli@0.58.0` describe the superseded implementation and are retained only as historical research. See [`docs/ANTIGRAVITY-MIGRATION.md`](docs/ANTIGRAVITY-MIGRATION.md).

## License

MIT
