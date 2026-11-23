# Mural Plus

This is a fork of [nikivanov/mural](https://github.com/nikivanov/mural) with firmware and web UI improvements for **v2 Mural hardware**: the FluidNC controller board, with an SD card and a small screen. It won't work on v1.1 boards (a bare ESP32 with two TMC2209 drivers). For those, use the [`v1.1-plus`](https://github.com/zeiphon/mural-plus/tree/v1.1-plus) branch.

- **[Web installer](https://zeiphon.github.io/mural-plus-installer/v2/)**: install it from Chrome or Edge on a computer, with nothing else to install.
- **[Try the web page](https://zeiphon.github.io/mural-plus-installer/v2/demo/)** in your browser first, with a simulated Mural beside it showing what it would do.
- **[Releases](https://github.com/zeiphon/mural-plus/releases)**: the `.bin` files, for esptool or updating from the browser.

## Improvements over upstream Mural

### Setup
- **Two layouts.** **Basic** walks through the setup one step at a time: hanger distance, belts, pen, drawing, then start. **Advanced** shows an overview of the steps, to do and revisit in any order. Switch between them in the settings.
- **Belts you can see.** A button for each belt, on its own side, starts and stops it, with a pulley that turns while it runs. Hold a button to retract faster, and a Stop button stops both. The belts stop by themselves if you leave the page or lock the phone. While extending to home, each belt's length is shown against its target, with the time left.
- **Pen calibration** in fine steps, with a reset. The pen-up angle can be set too (upstream fixes it at 90°).
- **Settings are kept** across restarts: the hanger distance, the pen settings and the drawing on the SD card.

### Drawing
- **The web page keeps working while drawing**, showing progress and the time left. You can turn this off in the settings.
- **Pause, resume and stop.** Pausing lifts the pen; resuming puts it back down and carries on from the same spot.
- **Adjust the pen while drawing**, for example when it starts losing contact near the edges, and change the drawing speed (capped at what the motors can do).

### Pen servo
- **Ramped moves at a speed you choose**, which don't hold everything else up while the pen moves (upstream waits for each move).
- **Soft limits**: a minimum and maximum angle that nothing can drive the servo past.
- An option to stop holding the servo while the pen is up, and a Park button.

### Updates from the browser
Once Mural Plus is installed, there's no need for a cable: download the `-update.bin` file from the [releases page](https://github.com/zeiphon/mural-plus/releases), then in Mural open the settings (the gear, top right) and choose **Install an update** under **Firmware**. Settings and the drawing are kept. If the new version doesn't start properly, Mural goes back to the old one.

### Troubleshooting
A **Diagnostics** page (linked at the bottom of the page) shows:
- the servo and pen, with test controls;
- the motors and belt position;
- each motor driver's status, such as temperature warnings, shorts and open coils;
- the reset history, with a warning about brownouts;
- storage, and a log you can read in the browser.

### Classic Mural
Upstream's own web page and setup are still there. Switch to them from the bottom of the Diagnostics page, and back with the **Switch to Mural Plus** button.

### Other
- **A safer partition table.** Upstream's puts the settings where `boot_app0.bin` is written, so a USB upload can corrupt them. It also has two app slots, for updating from the browser.
- The web server runs on core 0, apart from the motors, so the page stays responsive while Mural moves.
- Serial at 115200 baud (upstream uses 9600).
- Builds on Windows.

## Installing

Use the **[web installer](https://zeiphon.github.io/mural-plus-installer/v2/)** from Chrome or Edge on a computer. Plug the controller board in over USB and follow the steps on the page.

- Choose **Fresh install** the first time, including when coming from upstream Mural, because the partition table is different. It erases the board, including settings.
- After that, **Update** keeps your settings and calibration. Or update from the browser, as described above.

## Building from source

This fork builds with PlatformIO, like upstream. The firmware and the web UI live in separate flash partitions:

- **Upload** flashes the firmware (`src/`).
- **Upload Filesystem Image** flashes the web UI. `build.py` builds it from `ui/` (and the drawing worker in `worker/`) into `data/www`.

Keep the two in step: after pulling changes, upload both. The firmware version comes from `git describe` and is shown on the Diagnostics page.

The **Package Release** and **Build and Package** targets (PlatformIO sidebar > Project Tasks > Custom) write the release files to `dist/`, including the browser update file and the web installer.

### The web demo

The demo (`ui/demo/`) runs the real web UI against a simulated Mural written in TypeScript. From `ui/`, after building the worker (`cd ../worker && npm run build`):

- `npx vite --config demo/vite.config.ts` runs it locally;
- `npx tsc -p demo` type-checks it.

When the firmware's routes or behaviour change, update the simulated Mural to match (`ui/demo/src/device/device.ts`).

## Making a release

Push a tag of the form `v2-plus.N`, or `v2-plus.N.M` for a smaller release:

```
git tag -a v2-plus.3 -m "Mural Plus 2-plus.3"
git push origin v2-plus.3
```

The [Release workflow](.github/workflows/release.yml) builds the firmware and web UI, creates a GitHub release with the `.bin` files, and publishes the web installer and the demo to the [installer site](https://github.com/zeiphon/mural-plus-installer) as `v2/`. Publishing needs the `INSTALLER_DEPLOY_KEY` secret.

## Following upstream

This fork merges upstream regularly. [UPSTREAM.md](UPSTREAM.md) explains how, and records the upstream changes that Mural Plus still has to port.

# Upstream documentation

Please find the main documentation on https://getmural.me.

Discord: https://discord.gg/J3ZautHMTw

# Additional Information

## Positioning of the Drawing on the Wall

Here's how the image is prepared and drawn:

- The user defines the pin distance as part of the setup in the UI. For example 1 meter (or 1000mm). (This is d_pins in the image below.)
- The top margin is 25% of that distance, so the top of the image will be 250mm below the line between the two pins.
- Each side also has a 20% margin, so you'll get total of 60% of the horizontal distance, or 600mm.
- Now that we have the max width (600mm). The SVG is resized so its width is 600 and the height gets resized proportionally.
- Then a processing step is performed on the SVG to figure out what to actually draw, with each SVG unit being treated as millimeter.
- Finally it's converted into a simple format for Mural to draw, containing mostly its coordinate movement commands and pen up/down. This file is then uploaded to the microcontroller and executed line by line.

![image_positioning](/images/doc/muralbot_image_positioning.svg)

## Mural's Kinematic Model

Please find the kinematic model [here](KinematicModel.md).
