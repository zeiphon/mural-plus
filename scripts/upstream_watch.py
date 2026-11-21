"""Lists upstream changes that plus mode may need to port.

Run after merging upstream (PlatformIO's Python works if there's no other):

    ~/.platformio/penv/Scripts/python scripts/upstream_watch.py [--since REV] [--to REV] [--diff]

--since defaults to the "Reviewed up to" commit in UPSTREAM.md, --to to upstream/main.
"""
import argparse
import os
import re
import subprocess
import sys

# Upstream files that plus mode has its own version of, or whose behaviour it
# relies on. Changes here don't reach plus mode by themselves: each one needs
# porting, or a note in UPSTREAM.md saying it isn't needed.
WATCHED = [
    # Setup flow and routes -> plus Controller
    "src/phases/",
    "src/main.cpp",
    # Drawing -> PlusRunner, PlusPen
    "src/runner.cpp",
    "src/runner.h",
    "src/tasks/pentask.cpp",
    "src/tasks/pentask.h",
    "src/pen.cpp",
    "src/pen.h",
    # Command file format, read by PlusRunner
    "worker/src/toCommands.ts",
    # UI flow and setup screens -> PlusApp
    "ui/src/App.tsx",
    "ui/src/main.tsx",
    "ui/src/components/ToolsModal.tsx",
    "ui/src/screens/SetTopDistanceScreen.tsx",
    "ui/src/screens/RetractBeltsScreen.tsx",
    "ui/src/screens/ExtendToHomeScreen.tsx",
    "ui/src/screens/PenCalibrationScreen.tsx",
    "ui/src/screens/BeginDrawingScreen.tsx",
    "ui/src/screens/DrawingBeganScreen.tsx",
    # Backend contract used by the upstream screens plus reuses
    "ui/src/api.ts",
    "ui/src/types.ts",
]

REVIEWED_RE = re.compile(r"Reviewed up to:\s*`([0-9a-f]{7,40})`")


def git(repo, *args):
    result = subprocess.run(["git", *args], cwd=repo, capture_output=True,
                            text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        sys.exit("git %s failed: %s" % (" ".join(args), result.stderr.strip()))
    return result.stdout


def reviewed_commit(repo):
    path = os.path.join(repo, "UPSTREAM.md")
    try:
        with open(path, encoding="utf-8") as f:
            match = REVIEWED_RE.search(f.read())
    except OSError:
        match = None
    if not match:
        sys.exit("Couldn't find a \"Reviewed up to: `<commit>`\" line in UPSTREAM.md; pass --since.")
    return match.group(1)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    parser = argparse.ArgumentParser(description="List upstream changes to files plus mode shadows.")
    parser.add_argument("--since", help="last reviewed upstream commit (default: from UPSTREAM.md)")
    parser.add_argument("--to", default="upstream/main", help="upstream revision to compare (default: upstream/main)")
    parser.add_argument("--diff", action="store_true", help="show the full diff of watched files")
    args = parser.parse_args()

    since = args.since or reviewed_commit(repo)
    for rev in (since, args.to):
        if subprocess.run(["git", "rev-parse", "--verify", "--quiet", rev + "^{commit}"],
                          cwd=repo, capture_output=True).returncode != 0:
            sys.exit("Unknown revision %s (try: git fetch upstream)" % rev)

    total = int(git(repo, "rev-list", "--count", "%s..%s" % (since, args.to)).strip())
    print("Upstream %s..%s: %d new commit(s)" % (since[:9], args.to, total))
    if total == 0:
        print("Nothing new upstream since the reviewed commit.")
        return

    log = git(repo, "log", "--oneline", "--no-merges", "%s..%s" % (since, args.to), "--", *WATCHED)
    if not log.strip():
        print("No changes to watched files. Update \"Reviewed up to\" in UPSTREAM.md.")
        return

    print("\nCommits touching watched files:")
    print(log.rstrip())
    print("\nWatched files changed:")
    print(git(repo, "diff", "--stat", since, args.to, "--", *WATCHED).rstrip())
    if args.diff:
        print()
        print(git(repo, "diff", since, args.to, "--", *WATCHED).rstrip())
    print("\nAdd each change to the port backlog in UPSTREAM.md (or note it isn't needed),")
    print("then update \"Reviewed up to\".")


if __name__ == "__main__":
    main()
