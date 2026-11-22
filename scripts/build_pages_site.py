"""Builds the GitHub Pages site from both installers, for the release workflow.

    python scripts/build_pages_site.py V2_SITE V1_SITE OUT

V2_SITE is this branch's dist/site (scripts/package_release.py), V1_SITE the
same from the latest v1.1-plus release. OUT gets flasher/home.html as its
index, with the v2 installer in v2/ and the v1.1 installer in v1/.
"""
import json
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def version(site):
    return json.loads((site / "manifest-install.json").read_text())["version"]


def main():
    v2_site, v1_site, out = (Path(a) for a in sys.argv[1:4])
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(v2_site, out / "v2")
    shutil.copytree(v1_site, out / "v1")
    repo = os.environ.get("GITHUB_REPOSITORY", "zeiphon/mural-plus")
    page = (ROOT / "flasher" / "home.html").read_text(encoding="utf-8")
    page = (page.replace("{{V2_VERSION}}", version(v2_site))
                .replace("{{V1_VERSION}}", version(v1_site))
                .replace("{{REPO_URL}}", f"https://github.com/{repo}"))
    (out / "index.html").write_text(page, encoding="utf-8")
    print(f"Pages site: v2 {version(v2_site)}, v1.1 {version(v1_site)}")


if __name__ == "__main__":
    main()
