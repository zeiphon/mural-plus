#!/usr/bin/env bash
# Publishes a web installer to the installer site repo, replacing only its own
# folder, so each release line (v1/, v2/) can publish without touching the other.
#
#   scripts/publish_installer.sh SITE_DIR FOLDER [INDEX_HTML]
#
# SITE_DIR is package_release.py's dist/site. INDEX_HTML, if given, becomes the
# site's front page. Needs INSTALLER_REPO (owner/name) and INSTALLER_DEPLOY_KEY
# (a private SSH key whose deploy key has write access to that repo).
#
# The repo holds a single commit, replaced on every publish, so old firmware
# files don't pile up in its history (each release page keeps its own copies).
# If two publishes race, the lease makes the later push fail, and it retries
# from the new contents.
set -euo pipefail

site_dir=$(realpath "$1")
folder=$2
index=${3:+$(realpath "$3")}
: "${INSTALLER_REPO:?Set INSTALLER_REPO}"
: "${INSTALLER_DEPLOY_KEY:?Add the INSTALLER_DEPLOY_KEY secret to this repo}"

version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$site_dir/manifest-install.json" | head -1)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
printf '%s\n' "$INSTALLER_DEPLOY_KEY" > "$work/key"
chmod 600 "$work/key"
export GIT_SSH_COMMAND="ssh -i $work/key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

for attempt in 1 2 3 4 5; do
    repo="$work/repo$attempt"
    git clone --quiet --depth 1 "git@github.com:${INSTALLER_REPO}.git" "$repo" 2>/dev/null
    old=$(git -C "$repo" rev-parse -q --verify HEAD || true) # empty for a new repo
    rm -rf "${repo:?}/$folder"
    cp -R "$site_dir" "$repo/$folder"
    if [ -n "$index" ]; then
        cp "$index" "$repo/index.html"
    fi
    touch "$repo/.nojekyll" # serve the files as they are
    git -C "$repo" checkout --quiet --orphan publish
    git -C "$repo" add -A
    git -C "$repo" -c user.name="github-actions[bot]" \
        -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
        commit --quiet -m "Publish $folder $version"
    if git -C "$repo" push --quiet --force-with-lease="main:$old" origin publish:main; then
        echo "Published $folder $version to $INSTALLER_REPO"
        exit 0
    fi
    echo "Another release published at the same time, trying again"
    sleep $((attempt * 5))
done
echo "Couldn't publish $folder"
exit 1
