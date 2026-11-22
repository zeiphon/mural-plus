"""Builds the firmware and web UI, then packages them for a GitHub release and the web flasher.

    python scripts/package_release.py [--out dist] [--skip-build]

Writes:
    dist/site/                  the web flasher (published to GitHub Pages by CI)
        index.html
        manifest-install.json   fresh install: full image, erases the device
        manifest-update.json    USB update: everything except NVS, keeps settings
        firmware/*.bin
    dist/release/*.bin          files to attach to the GitHub release, including
                                the -update.bin file for updating from the browser
    dist/RELEASE_NOTES.md       installing and updating instructions

The update file holds the web UI image and the firmware (OTA_PLAN.md section 2):
"MURALUPD", the header length (uint32, little-endian), a JSON header with the
version and each part's offset, size and SHA-256, then the parts. It's read by
ui/src/plus/update.ts and the recovery page (src/plus/recovery_page.h).

Run it with a Python that has PlatformIO (CI), or PlatformIO's own one:
    ~/.platformio/penv/Scripts/python scripts/package_release.py
"""
import argparse
import csv
import hashlib
import importlib.util
import json
import os
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True  # keep scripts/__pycache__ out of the repo
sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_version import get_version  # noqa: E402

ENV = "esp32dev"
CHIP = "esp32"              # esptool --chip
CHIP_FAMILY = "ESP32"       # ESP Web Tools chipFamily
PRODUCT_NAME = "Mural Plus"
DEFAULT_REPO = "zeiphon/mural-plus"
UPDATE_MAGIC = b"MURALUPD"
UPDATE_FORMAT = 1
FULL_LIMIT = 0.90           # fail if the firmware or the web UI fills more of its partition than this


def product_id():
    """The firmware's MURAL_PRODUCT (src/plus/version.h). Update files carry it, and the
    browser refuses an update for a different product."""
    text = (ROOT / "src" / "plus" / "version.h").read_text(encoding="utf-8")
    m = re.search(r'#define\s+MURAL_PRODUCT\s+"([^"]+)"', text)
    if not m:
        sys.exit("src/plus/version.h has no MURAL_PRODUCT")
    return m.group(1)


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


def partitions():
    with open(ROOT / "partitions.csv", newline="") as f:
        return [[c.strip() for c in r] for r in csv.reader(f) if r and not r[0].lstrip().startswith("#")]


def parse_size(text):
    text = text.strip().upper()
    if text.endswith("K"):
        return int(text[:-1], 0) * 1024
    if text.endswith("M"):
        return int(text[:-1], 0) * 1024 * 1024
    return int(text, 0)


def fs_partition():
    """Offset and size of the filesystem (spiffs/littlefs) partition in partitions.csv."""
    for name, ptype, subtype, offset, size, *_ in partitions():
        if ptype == "data" and subtype in ("spiffs", "littlefs"):
            if not offset:
                sys.exit(f"partitions.csv: give the '{name}' partition an explicit offset")
            return int(offset, 0), parse_size(size)
    sys.exit("partitions.csv has no spiffs/littlefs partition")


def app_slot_size():
    """Size of the smallest app partition: an update can land in either slot."""
    sizes = [parse_size(size) for _, ptype, _, _, size, *_ in partitions() if ptype == "app"]
    if not sizes:
        sys.exit("partitions.csv has no app partition")
    return min(sizes)


def check_fill(what, used, total):
    print(f"{what}: {used // 1024} KB of {total // 1024} KB ({used * 100 / total:.0f}%)")
    if used > total * FULL_LIMIT:
        sys.exit(f"{what} is over {FULL_LIMIT:.0%} full. Make room, or change the flash layout (a USB install).")


def write_update_file(path, product, version, ui, firmware):
    parts = []
    offset = 0
    for name, data in (("ui", ui), ("firmware", firmware)):
        parts.append({"name": name, "offset": offset, "size": len(data),
                      "sha256": hashlib.sha256(data).hexdigest()})
        offset += len(data)
    header = json.dumps({"format": UPDATE_FORMAT, "product": product, "version": version,
                         "parts": parts}, separators=(",", ":")).encode("utf-8")
    with open(path, "wb") as f:
        f.write(UPDATE_MAGIC + struct.pack("<I", len(header)) + header + ui + firmware)


def build_metadata(metadata_path=None):
    """Build folder, boot images and app offset, from `pio project metadata`, or from a
    file in the same format (scripts/package_target.py writes one from inside PlatformIO)."""
    out = Path(metadata_path) if metadata_path else ROOT / ".pio" / "build" / ENV / "release-metadata.json"
    if not metadata_path:
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
    ap.add_argument("--metadata", help=argparse.SUPPRESS)  # used by scripts/package_target.py
    args = ap.parse_args()

    version = get_version(ROOT)
    product = product_id()
    repo = os.environ.get("GITHUB_REPOSITORY", DEFAULT_REPO)
    print(f"Packaging {product} {version}")

    if not args.skip_build:
        run(pio_cmd() + ["run", "-e", ENV])
        run(pio_cmd() + ["run", "-e", ENV, "-t", "buildfs"])

    build_dir, boot_images, app_offset = build_metadata(args.metadata)
    firmware = build_dir / "firmware.bin"
    littlefs = build_dir / "littlefs.bin"
    fs_off, fs_size = fs_partition()
    for f in [p for _, p in boot_images] + [firmware, littlefs]:
        if not f.exists():
            sys.exit(f"Missing build output: {f}")

    # The firmware and the web UI must come from the same build: an update checks
    # the UI's version.json against the firmware after installing it.
    firmware_bytes = firmware.read_bytes()
    littlefs_bytes = littlefs.read_bytes()
    www = ROOT / "data" / "www"
    ui_version_file = www / "version.json"
    ui_version = json.loads(ui_version_file.read_text())["version"] if ui_version_file.exists() else None
    if ui_version != version:
        sys.exit(f"The web UI was built as {ui_version}, not {version}. Rebuild without --skip-build.")
    if version.encode() not in firmware_bytes:
        sys.exit(f"firmware.bin wasn't built as {version}. Rebuild without --skip-build.")
    if len(littlefs_bytes) != fs_size:
        sys.exit(f"littlefs.bin is {len(littlefs_bytes)} bytes, but the partition is {fs_size}")
    check_fill("Firmware", len(firmware_bytes), app_slot_size())
    check_fill("Web UI files", sum(f.stat().st_size for f in www.rglob("*") if f.is_file()), fs_size)

    out = ROOT / args.out
    site = out / "site"
    fw_dir = site / "firmware"
    release = out / "release"
    if out.exists():
        shutil.rmtree(out)
    fw_dir.mkdir(parents=True)
    release.mkdir(parents=True)
    (out / ".gitignore").write_text("*\n") # build output, without touching upstream's .gitignore

    prefix = f"{product}-{version}"
    names = {
        "full": f"{prefix}-full.bin",
        "firmware": f"{prefix}-firmware.bin",
        "littlefs": f"{prefix}-littlefs.bin",
        "update": f"{prefix}-update.bin",
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

    # Everything the web installer flashes, so it can be done with esptool too.
    for dest in [names["full"]] + [Path(p["path"]).name for p in update_parts]:
        shutil.copyfile(fw_dir / dest, release / dest)
    write_update_file(release / names["update"], product, version, littlefs_bytes, firmware_bytes)

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

    usb_update_args = " ".join(f"{hex(p['offset'])} {Path(p['path']).name}" for p in update_parts)
    owner, _, name = repo.partition("/")
    page = (ROOT / "flasher" / "index.html").read_text(encoding="utf-8")
    page = (page.replace("{{VERSION}}", version)
                .replace("{{REPO_URL}}", f"https://github.com/{repo}")
                .replace("{{FULL_BIN}}", names["full"])
                .replace("{{UPDATE_BIN}}", names["update"])
                .replace("{{USB_UPDATE_ARGS}}", usb_update_args))
    (site / "index.html").write_text(page, encoding="utf-8")

    notes = f"""## Updating from the browser

If Mural already runs a version of {PRODUCT_NAME} that can update itself, download `{names['update']}`. In Mural, open the settings (the gear, top right), then under **Firmware** choose **Install an update**. Settings and the drawing are kept. If the new version doesn't start properly, Mural goes back to the old one.

## Installing over USB

The easiest way is the web installer: https://{owner.lower()}.github.io/{name}/ (desktop Chrome or Edge, USB cable).

To flash with [esptool](https://docs.espressif.com/projects/esptool/) instead:

**Fresh install.** This erases settings and calibration. Use it on a new board, a board coming from upstream Mural, or if you're unsure.
```
esptool.py --chip {CHIP} write_flash 0x0 {names['full']}
```

**Update.** This keeps settings and calibration. It also rewrites the bootloader, partition table and `boot_app0.bin`, so the board starts this firmware even if a browser update had switched it to the other firmware slot. The web installer's Update does the same.
```
esptool.py --chip {CHIP} write_flash {usb_update_args}
```
"""
    (out / "RELEASE_NOTES.md").write_text(notes, encoding="utf-8")

    print(f"\nPackaged {version} into {out}")
    for f in sorted(release.iterdir()):
        print(f"  {f.name}  ({f.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
