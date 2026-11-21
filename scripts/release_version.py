"""Works out the firmware version from git, for the build (and later the release packager).

Release tags look like v2-plus.1. On a tagged commit the version is "2-plus.1";
later commits get git's suffix ("2-plus.1-3-gabc1234"), and uncommitted changes add
"-dirty". With no release tag yet it's "dev-<commit>". Only v2-plus tags count, so
upstream's tags (v1.1, ...) and the v1.1-plus fork's tags are ignored.
"""
import subprocess

TAG_PATTERN = "v2-plus*"


def get_version(project_dir):
    try:
        out = subprocess.run(
            ["git", "describe", "--tags", "--match", TAG_PATTERN, "--always", "--dirty"],
            cwd=project_dir, capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    if out.startswith("v"):
        return out[1:]
    return "dev-" + out   # no release tag reachable: just the commit hash


if __name__ == "__main__":
    import os
    print(get_version(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
