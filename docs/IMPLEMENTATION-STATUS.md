# Implementation status

Status as of 2026-09-04 for package version 0.1.0.

The bundled Gemini CLI implementation was superseded after its individual Code Assist authentication path was retired. See [ANTIGRAVITY-MIGRATION.md](ANTIGRAVITY-MIGRATION.md).

## Implemented

- Pi provider registration and marketplace package metadata.
- Google Antigravity ACP server resolution plus self-service installation based on `@estebanforge/pi-antigravity-bridge` 1.4.1.
- Official ACP SDK 0.16.1 transport using stable protocol v1.
- Strict bounded NDJSON framing, operation deadlines, cancellation, redacted errors, and bounded stderr.
- Packaged parent-death supervisor with TERM/KILL escalation and POSIX process-group cleanup.
- Antigravity Google/API-key `/login` integration and conservative auth-presence checks.
- Antigravity fallback models, authenticated ACP model discovery, catalog refresh, and `session/set_model` switching.
- Pi-to-ACP text/image/context conversion with bounded fresh-session reconstruction.
- ACP text, thought, plan, and native-tool activity mapping to balanced Pi events.
- ACP usage metadata mapping to Pi usage.
- Persistent ACP bindings keyed by Pi session ID, serialized turns, rewind detection, and cleanup.
- Default-deny, single-use ACP permission continuation through a real Pi tool round trip.
- Authenticated loopback MCP exposure of active Pi tools with `pi_` namespacing, schema sanitization, original-schema revalidation, bounded catalogs/bodies, and genuine Pi tool-result continuation.
- Unit, fake-subprocess, cancellation, supervisor, packed-install, real-server initialize, and live authenticated prompt tests.

## Live validation

On Linux with authenticated `agy_acp_server_1.1.1`, ACP protocol 1 initialization, authenticated model discovery, session creation, model control, streaming, and an exact-response prompt completed successfully.

## Remaining before stable 1.0

- Run and record fresh Antigravity OAuth and API-key login tests on clean accounts.
- Validate cancellation, permissions, and Pi MCP tools against the live Antigravity service.
- Run packed installation matrices on Debian/glibc, Alpine/musl, macOS, and Windows, including the large ACP binary download.
- Add Windows process-tree-specific lifecycle tests and hardening.
- Expand chaos tests for parallel MCP calls, network disconnects, permission timeout races, and malformed ACP streams.
- Confirm transcript prefix fingerprints and unseen external-delta replay against real Pi branch/fork/compaction behavior.
- Complete public beta publishing and Pi marketplace installation verification.

Version 0.1.0 remains a beta implementation.
