# Tracking upstream

This fork follows upstream Mural ([nikivanov/mural](https://github.com/nikivanov/mural), git remote `upstream`) and merges it regularly. Plus mode has its own versions of some upstream code; see "Shared vs parallel code" in `V2_PORT_PLAN.md`. Upstream changes to those files aren't ported at merge time. They're recorded here and ported when convenient. Until then, classic mode (upstream's own code) still has them.

## Last reviewed upstream commit

<!-- scripts/upstream_watch.py reads the commit on the next line -->
Reviewed up to: `1eceffa1f14c30d761a06b45510a966253782e82` (2026-11-21, "Add Discord link to README")

## After merging upstream

1. On `v2-plus`: `git fetch upstream`, then `git merge upstream/main`.
2. Run `~/.platformio/penv/Scripts/python scripts/upstream_watch.py`. It lists the commits and files that changed in watched files since the reviewed commit. Add `--diff` to see the changes themselves.
3. For each change, add a row to the port backlog below, or note that plus doesn't need it.
4. Update "Reviewed up to" to the upstream commit you merged.
5. Build, and smoke-test classic mode (boot, set distance, upload a drawing).

The watched files are listed in `scripts/upstream_watch.py`. They are upstream files that plus mode has its own version of (setup phases and routes, runner, pen, UI flow and setup screens), plus files whose behaviour plus relies on: the command-file format in `worker/src/toCommands.ts`, and the backend contract in `ui/src/api.ts` and `ui/src/types.ts`. Changes to shared code that plus uses directly show up as build errors instead.

## Port backlog

| Upstream commit | Files | What changed | Plus status |
|---|---|---|---|
| — | — | Nothing yet | — |

## Fixes offered upstream

Each fix is its own branch from `upstream/main` and is merged (not cherry-picked) into `v2-plus`, so we carry it whether or not upstream takes it. If upstream merges a modified version, take theirs when the next merge conflicts.

| Branch | Change | Status |
|---|---|---|
| `fix/windows-build` | `build.py` works on Windows (cmd.exe has no `rm`/`cp`) | PR submitted 2026-11-21. Merged into `v2-plus` |
| `fix/serial-115200` | Serial and monitor at 115200 baud | Ready, not submitted. Merged into `v2-plus` |
| `fix/partition-table` | NVS no longer overlaps `boot_app0.bin` at 0xe000 | Ready, not submitted. Merged into `v2-plus`. Raise with the maintainer first: boards lose saved settings once |
| `fix/manual-belt-speed` | `Movement::leftStepper`/`rightStepper` take an optional speed (default unchanged); plus uses it for hold-to-boost retraction | Ready, not submitted. Merged into `v2-plus` |
| — | Stop tracking `ui/tsconfig.tsbuildinfo` (rewritten by every UI build) | Idea only |
| — | `Runner` drops the last character of the `d` header, so a whole-number distance (`d12345`) reads ten times too small and progress reaches 100% early | Idea only (fixed in plus) |
| — | Tools modal: label Park Servo "(0°)" and say where 0° is | Idea only. Edited directly in `v2-plus` (`ToolsModal.tsx`), so expect a small merge conflict if upstream changes that button |
