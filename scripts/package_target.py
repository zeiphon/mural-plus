import json
import os
import subprocess
from SCons.Script import COMMAND_LINE_TARGETS, AlwaysBuild
Import("env")

# Adds two PlatformIO targets for the release files, including the update file
# for updating from the browser (scripts/package_release.py writes them to dist/):
#   package       "Package Release": packages the last firmware and filesystem build
#   buildpackage  "Build and Package": builds both, then packages
# In VS Code: PlatformIO sidebar > Project Tasks > esp32dev > Custom.
# From the command line: pio run -t buildpackage

project_dir = env.subst("$PROJECT_DIR")


def package(source, target, env):
    # The build details package_release.py would otherwise get by running
    # `pio project metadata`, in the same format.
    metadata = {
        env.subst("$PIOENV"): {
            "prog_path": env.subst("$BUILD_DIR/${PROGNAME}.elf"),
            "extra": {
                "flash_images": [{"offset": offset, "path": env.subst(path)}
                                 for offset, path in env.get("FLASH_EXTRA_IMAGES", [])],
                "application_offset": env.subst("$ESP32_APP_OFFSET"),
            },
        }
    }
    metadata_path = env.subst("$BUILD_DIR/release-metadata.json")
    with open(metadata_path, "w") as f:
        json.dump(metadata, f)
    child_env = dict(os.environ, PYTHONIOENCODING="utf-8")
    result = subprocess.run(
        [env.subst("$PYTHONEXE"), os.path.join(project_dir, "scripts", "package_release.py"),
         "--skip-build", "--metadata", metadata_path],
        cwd=project_dir, env=child_env)
    if result.returncode != 0:
        env.Exit(result.returncode)


env.AddCustomTarget(
    name="package",
    dependencies=None,
    actions=package,
    title="Package Release",
    description="Package the last firmware and filesystem build into dist/, including the update file",
)

build_dependencies = ["$BUILD_DIR/${PROGNAME}.bin"]
if "buildpackage" in COMMAND_LINE_TARGETS:
    # As in merge_bin.py: the filesystem image is only a target for buildfs and
    # uploadfs, so build it here.
    fs_image = env.DataToBin("$BUILD_DIR/${ESP32_FS_IMAGE_NAME}", "$PROJECT_DATA_DIR")
    env.NoCache(fs_image)
    AlwaysBuild(fs_image)
    build_dependencies.append(fs_image)

env.AddCustomTarget(
    name="buildpackage",
    dependencies=build_dependencies,
    actions=package,
    title="Build and Package",
    description="Build the firmware and filesystem, then package them into dist/",
)
