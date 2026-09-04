# pi-gemini-acp-provider

A first-class [Pi](https://github.com/earendil-works/pi) provider for **Google Antigravity** through its official ACP server.

> **Important:** this package no longer uses `@google/gemini-cli`. The Gemini CLI individual Code Assist login path was retired and is not a supported authentication route. Antigravity/`agy` is the target runtime.

## Features

- Registers `gemini-acp/*` models backed by Google Antigravity.
- Uses ACP protocol v1 and the official TypeScript SDK.
- Collapses Antigravity's effort-qualified IDs into one entry per model; Pi's Shift+Tab reasoning control selects low/medium/high dynamically.
- Supports Pi streaming, warm sessions, cancellation, usage metadata, and lifecycle cleanup.
- Routes compatible Pi tools through an authenticated loopback MCP bridge.
- Supports persisted `default`, `auto-edit`, and `yolo` Antigravity permission modes. The requested default is `yolo`; switching to a prompting mode retains the single-use, fail-closed Pi permission broker.
- Advertises no ACP filesystem or terminal client capabilities.
- Uses a self-service ACP registry installer based on the reviewed `@estebanforge/pi-antigravity-bridge` setup when the official server is absent.

## New-user setup

The npm name is not published yet. From a checkout:

```bash
cd pi-gemini-acp-provider
npm install
pi install .
pi
```

For a temporary test without changing Pi's installed-package settings:

```bash
pi --no-extensions -e ./extensions/index.ts
```

Once the package is published, installation will be:

```bash
pi install npm:pi-gemini-acp-provider
```

In Pi:

1. Run `/login`.
2. Choose **Sign in with an account**.
3. Choose **Google Antigravity (ACP)**.
4. If needed, wait for the official ACP server download and extraction. Progress is shown; the Linux build observed during development expands to about 1.8 GB.
5. Complete the Google login in the browser.
6. Run `/model` and select one of the `gemini-acp` models.
7. Press **Shift+Tab** to choose the reasoning effort. Flash models expose low, medium, and high; Pro exposes only the tiers advertised by Antigravity.
8. Send a prompt. The default permission mode is `yolo`, so Antigravity-native commands and edits can run without confirmation.

The provider first looks at `AGY_ACP_BIN`, `~/.local/bin/agy_acp_server.par`, the managed `~/.local/opt/agy-acp/current/` location, and `PATH`. If absent, it installs the platform build published in the ACP registry. A global `agy` or `gemini` command is not required.

For API-key authentication, choose **Enter an API key** and then **Antigravity Gemini API key** in `/login`, or set `GEMINI_API_KEY` before starting Pi.

Antigravity owns OAuth tokens under `~/.gemini/antigravity-acp/`; Pi stores only a non-secret configured marker. Existing `agy` CLI credentials and Gemini CLI credentials should not be assumed to authenticate this separate ACP server.

## Commands

```text
/gemini-acp doctor
/gemini-acp doctor --verbose
/gemini-acp permissions
/gemini-acp permissions default
/gemini-acp permissions auto-edit
/gemini-acp permissions yolo
```

Permission mode is saved in `~/.pi/agent/gemini-acp-provider/config.json` and applied immediately to active compatible sessions as well as future sessions.

## Development

```bash
npm run check
npm run test:real-acp  # initializes the installed Antigravity ACP server
npm run test:live      # sends a real authenticated prompt
npm run test:packed
npm audit --audit-level=high
```

## Security boundary

This launches a full coding agent with the user's OS privileges. **The default `yolo` mode permits Antigravity-native commands and edits without confirmation.** Use `/gemini-acp permissions default` for confirmation prompts. Disabling ACP filesystem/terminal **client callbacks is not a sandbox** for Antigravity-native tools. Pi hooks govern tools routed through the `pi_` MCP namespace; Antigravity-native tools remain governed by Antigravity policy and ACP permission requests.

## Compatibility

The implementation is pinned to Pi 0.85.0, ACP SDK 0.16.1, the reviewed `@estebanforge/pi-antigravity-bridge` 1.4.1 setup behavior, and ACP protocol 1. The live development environment reported `antigravity-acp` build `agy_acp_server_1.1.1`.

Earlier repository documents analyzing `@google/gemini-cli@0.58.0` describe the superseded implementation and are retained only as historical research. See [`docs/ANTIGRAVITY-MIGRATION.md`](docs/ANTIGRAVITY-MIGRATION.md).

## License

MIT
