# Maintenance policy

## Supported versions

- Pi 1.1.x; both Pi development packages are pinned together to 1.1.0.
- Node.js 22.19.0 and 24 are checked in CI. Node declarations track the 24.x line.
- ACP SDK 0.19.1 / protocol 1. Do not treat the SDK 1.x update as a routine patch.
- Host-provided Pi packages remain wildcard peers and are not bundled, following Pi's package contract. The README's compatibility statement defines tested support.

## Dependency updates

Dependabot runs weekly for npm and GitHub Actions. Pi updates are grouped to avoid mismatched `pi-ai` / `pi-coding-agent` versions. Compatible minor/patch updates are grouped; major updates require individual review.

Before merging, require the Node 22.19.0 and 24 checks: typecheck, tests, pack dry run, an isolated packed-install smoke test, and full `npm audit --audit-level=moderate`. Audit findings describe dependency advisories, not proof that the provider exposes every affected code path. Do not use `npm audit fix --force` as a substitute for compatibility work.

TypeScript 7 is deferred: it removes `transpileModule`, `ModuleKind`, and `ScriptTarget` used by the multiprocess session-store test harness. Migrate that harness before upgrading the compiler. Node 26 declarations are intentionally excluded until that runtime is supported.

## Profiles

`PI_CODING_AGENT_DIR` selects provider configuration and saved ACP bindings. Initial configuration migration copies only permission/update settings, preserves the source, and never overwrites an existing target. Sessions are not migrated. Antigravity's own credentials and managed runtime are still shared; a Pi profile is not an Antigravity account sandbox.

## Release checklist

1. Merge changes only after both CI checks pass on the current main base.
2. Bump `package.json` and the lockfile together, update release notes, and merge the release PR.
3. Re-run checks, packed install, and full audit from a clean install. Exercise npm 12 packaging as well as the bundled npm CLI.
4. Create an annotated `v<version>` tag on that exact main commit and push it. The existing publish workflow uses npm trusted publishing/OIDC; do not introduce a long-lived npm token.
5. Verify the publish workflow, npm version, and GitHub release. Authenticated prompt/cancellation qualification is opt-in and must be explicitly requested; PR CI does not use real Google credentials.

## Branch protection follow-up

The daily signed-runtime workflow currently pushes directly to main with `GITHUB_TOKEN`. GitHub rejects the built-in GitHub Actions app as a ruleset bypass actor for this personal repository. Enforcing required PR/check rules now would break runtime updates.

Before protecting main, migrate runtime publication to a tested PR-based flow (explicitly dispatching CI because bot-token pushes do not trigger workflows), or provision a dedicated installed GitHub App with a narrowly scoped bypass. Do not silently bypass checks or disable signed runtime updates. Keep the existing disabled ruleset unchanged until this automation is ready.
