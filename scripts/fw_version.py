import json
import os
import sys
Import("env", "projenv")

# Bakes the git version into the firmware as MURAL_FW_VERSION (for the boot log
# and the Diagnostics page). Applied to the project sources only, so a new commit
# doesn't force the libraries to rebuild.
#
# Also writes data/www/version.json, so the web UI image carries the same
# version. A firmware update checks it after installing the UI (src/plus/ota.cpp).
# This script runs after build.py, so the file isn't gzipped.

project_dir = env.subst("$PROJECT_DIR")
sys.dont_write_bytecode = True  # keep scripts/__pycache__ out of the repo
sys.path.insert(0, os.path.join(project_dir, "scripts"))
from release_version import get_version

version = get_version(project_dir)
print("Firmware version: " + version)
projenv.Append(CPPDEFINES=[("MURAL_FW_VERSION", env.StringifyMacro(version))])

www_dir = os.path.join(project_dir, "data", "www")
if os.path.isdir(www_dir):
    with open(os.path.join(www_dir, "version.json"), "w", encoding="utf-8") as f:
        json.dump({"version": version}, f)
