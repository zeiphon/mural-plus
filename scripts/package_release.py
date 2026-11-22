"""Builds the firmware and web UI, then packages them for a GitHub release and the web flasher.

    python scripts/package_release.py [--out dist] [--skip-build]

Writes:
    dist/site/                  the web flasher (published to GitHub Pages by CI)
        index.html
        manifest-install.json   fresh install: full image, erases the device
        manifest-update.json    update: everything except NVS, keeps settings
        firmware/*.bin
    dist/release/*.bin          files to attach to the GitHub release
    dist/RELEASE_NOTES.md       flashing instructions with the right offsets

Run it with a Python that has PlatformIO (CI), or PlatformIO's own one:
    ~/.platformio/penv/Scripts/python scripts/package_release.py
"""
import argparse
import csv
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_version import get_version  # noqa: E402

ENV = "esp32dev"
CHIP = "esp32"              # esptool --chip
CHIP_FAMILY = "ESP32"       # ESP Web Tools chipFamily
PRODUCT = "mural-1-plus"
PRODUCT_NAME = "Mural 1 Plus"
DEFAULT_REPO = "zeiphon/mural-plus"
INSTALLER_URL = "https://zeiphon.github.io/mural-plus-installer/v1/"  # published by the release workflow


def platformio_home():
    return Path(os.environ.get("PLATFORMIO_CORE_DIR", Path.home() / ".platformio"))


def pio_cmd():
    exe = shutil.which("pio") or shutil.which("platformio")
    if exe:
        return [exe]
    if importlib.util.find_spec("platformio"):
        return [sys.executable, "-m", "platformio"]
    for p in (platformio_home() / "penv" / "Scripts" / "pio.exe", platformio_home() / "penv" / "bin" / "pio"):
        if p.exists():
            return [str(p)]
    sys.exit("PlatformIO not found. Install it (pip install platformio) or run this with PlatformIO's Python.")


def esptool_cmd():
    if importlib.util.find_spec("esptool"):
        return [sys.executable, "-m", "esptool"]
    # Fall back to the copy PlatformIO uses for uploads, run with PlatformIO's own Python.
    script = platformio_home() / "packages" / "tool-esptoolpy" / "esptool.py"
    for py in (platformio_home() / "penv" / "Scripts" / "python.exe", platformio_home() / "penv" / "bin" / "python"):
        if script.exists() and py.exists():
            return [str(py), str(script)]
    sys.exit("esptool not found. Install it (pip install esptool) or build once with PlatformIO.")


def run(cmd):
    print("+ " + " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=ROOT, check=True)


def fs_offset():
    """Offset of the filesystem (spiffs/littlefs) partition in partitions.csv."""
    with open(ROOT / "partitions.csv", newline="") as f:
        rows = [[c.strip() for c in r] for r in csv.reader(f) if r and not r[0].lstrip().startswith("#")]
    for name, ptype, subtype, offset, *_ in rows:
        if ptype == "data" and subtype in ("spiffs", "littlefs"):
            if not offset:
                sys.exit(f"partitions.csv: give the '{name}' partition an explicit offset")
            return int(offset, 0)
    sys.exit("partitions.csv has no spiffs/littlefs partition")


def build_metadata():
    out = ROOT / ".pio" / "build" / ENV / "release-metadata.json"
    run(pio_cmd() + ["project", "metadata", "-e", ENV, "--json-output", "--json-output-path", str(out)])
    data = json.loads(out.read_text())[ENV]
    build_dir = Path(data["prog_path"]).parent
    images = [(int(i["offset"], 16), Path(i["path"])) for i in data["extra"]["flash_images"]]
    app_offset = int(data["extra"]["application_offset"], 16)
    return build_dir, images, app_offset


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default="dist", help="output folder (default: dist)")
    ap.add_argument("--skip-build", action="store_true", help="package the existing build output")
    args = ap.parse_args()

    version = get_version(ROOT)
    repo = os.environ.get("GITHUB_REPOSITORY", DEFAULT_REPO)
    print(f"Packaging {PRODUCT} {version}")

    if not args.skip_build:
        run(pio_cmd() + ["run", "-e", ENV])
        run(pio_cmd() + ["run", "-e", ENV, "-t", "buildfs"])

    build_dir, boot_images, app_offset = build_metadata()
    firmware = build_dir / "firmware.bin"
    littlefs = build_dir / "littlefs.bin"
    fs_off = fs_offset()
    for f in [p for _, p in boot_images] + [firmware, littlefs]:
        if not f.exists():
            sys.exit(f"Missing build output: {f}")

    out = ROOT / args.out
    site = out / "site"
    fw_dir = site / "firmware"
    release = out / "release"
    if out.exists():
        shutil.rmtree(out)
    fw_dir.mkdir(parents=True)
    release.mkdir(parents=True)

    prefix = f"{PRODUCT}-{version}"
    names = {
        "full": f"{prefix}-full.bin",
        "firmware": f"{prefix}-firmware.bin",
        "littlefs": f"{prefix}-littlefs.bin",
    }

    # Merged image for a first install, flashed at 0x0. esptool pads the gaps with
    # 0xFF, so this also wipes NVS (settings and calibration).
    parts = sorted(boot_images + [(app_offset, firmware), (fs_off, littlefs)])
    merge_args = []
    for off, path in parts:
        merge_args += [hex(off), str(path)]
    run(esptool_cmd() + ["--chip", CHIP, "merge_bin", "-o", str(fw_dir / names["full"])] + merge_args)

    shutil.copyfile(firmware, fw_dir / names["firmware"])
    shutil.copyfile(littlefs, fw_dir / names["littlefs"])
    # The update manifest also rewrites the bootloader, partition table and boot_app0.
    # That keeps a device that was flashed with an older partition table in sync, and
    # means it still boots if the user ticks "erase" in the installer.
    update_parts = []
    for off, path in sorted(boot_images):
        dest = f"{prefix}-{path.stem}.bin"
        shutil.copyfile(path, fw_dir / dest)
        update_parts.append({"path": f"firmware/{dest}", "offset": off})
    update_parts += [
        {"path": f"firmware/{names['firmware']}", "offset": app_offset},
        {"path": f"firmware/{names['littlefs']}", "offset": fs_off},
    ]

    for key in ("full", "firmware", "littlefs"):
        shutil.copyfile(fw_dir / names[key], release / names[key])

    # No Improv Serial support in this firmware, so don't wait for it after flashing.
    common = {"name": PRODUCT_NAME, "version": version, "new_install_improv_wait_time": 0}
    install = dict(common, builds=[{"chipFamily": CHIP_FAMILY,
                                    "parts": [{"path": f"firmware/{names['full']}", "offset": 0}]}])
    # ESP Web Tools erases the whole chip on a new install unless this is set;
    # without Improv every install counts as new.
    update = dict(common, new_install_prompt_erase=True,
                  builds=[{"chipFamily": CHIP_FAMILY, "parts": update_parts}])
    (site / "manifest-install.json").write_text(json.dumps(install, indent=2) + "\n")
    (site / "manifest-update.json").write_text(json.dumps(update, indent=2) + "\n")

    page = (ROOT / "flasher" / "index.html").read_text(encoding="utf-8")
    page = (page.replace("{{VERSION}}", version)
                .replace("{{REPO_URL}}", f"https://github.com/{repo}")
                .replace("{{APP_OFFSET}}", hex(app_offset))
                .replace("{{FS_OFFSET}}", hex(fs_off))
                .replace("{{FULL_BIN}}", names["full"])
                .replace("{{FIRMWARE_BIN}}", names["firmware"])
                .replace("{{LITTLEFS_BIN}}", names["littlefs"]))
    (site / "index.html").write_text(page, encoding="utf-8")

    notes = f"""## Installing

The easiest way is the web installer: {INSTALLER_URL} (desktop Chrome or Edge, USB cable).

To flash with [esptool](https://docs.espressif.com/projects/esptool/) instead:

**Fresh install.** This erases settings and calibration. Use it on a new board, a board coming from upstream Mural, or if you're unsure.
```
esptool.py --chip {CHIP} write_flash 0x0 {names['full']}
```

**Update.** This keeps settings and calibration, but you'll need to choose your drawing again.
```
esptool.py --chip {CHIP} write_flash {hex(app_offset)} {names['firmware']} {hex(fs_off)} {names['littlefs']}
```
"""
    (out / "RELEASE_NOTES.md").write_text(notes, encoding="utf-8")

    print(f"\nPackaged {version} into {out}")
    for f in sorted(release.iterdir()):
        print(f"  {f.name}  ({f.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
