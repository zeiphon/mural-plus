"""Works out the firmware version from git, for the build (and later the release packager).

Release tags look like v2-plus.2, or v2-plus.2.1 for a minor release (smaller
changes on top of v2-plus.2). On a tagged commit the version is the tag without
the "v" ("2-plus.2.1"); later commits get git's suffix ("2-plus.2.1-3-gabc1234"),
and uncommitted changes add "-dirty". With no release tag yet it's "dev-<commit>".
Only v2-plus tags count, so upstream's tags (v1.1, ...) and the v1.1-plus fork's
tags are ignored.
"""
import subprocess

TAG_PATTERN = "v2-plus*"

# Tracked files that get rewritten by the IDE rather than edited, so changes to
# them don't make a build "dirty": the PlatformIO IDE rewrites launch.json with
# local paths.
GENERATED_FILES = [".vscode/launch.json"]


def _git(project_dir, *args):
    return subprocess.run(["git", *args], cwd=project_dir, capture_output=True,
                          text=True, check=True).stdout.strip()


def get_version(project_dir):
    try:
        out = _git(project_dir, "describe", "--tags", "--match", TAG_PATTERN, "--always")
        # Like describe --dirty: changes to tracked files only, minus generated ones.
        changes = _git(project_dir, "status", "--porcelain", "--untracked-files=no", "--", ".",
                       *[":(exclude)" + path for path in GENERATED_FILES])
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    if changes:
        out += "-dirty"
    if out.startswith("v"):
        return out[1:]
    return "dev-" + out   # no release tag reachable: just the commit hash


if __name__ == "__main__":
    import os
    print(get_version(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
