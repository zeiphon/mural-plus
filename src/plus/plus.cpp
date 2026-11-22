#include "plus.h"
#include "logger.h"
#include <LittleFS.h>
#include <Preferences.h>
#include <esp_timer.h>
#include <esp_system.h>
#include "plus_pen.h"
#include "plus_runner.h"
#include "controller.h"
#include "persist.h"
#include "diagnostics.h"
#include "movement_access.h"
#include "ota.h"
#include "restart.h"

// main.cpp's "use without WiFi" flag. It's cleared at boot, so a restart goes
// back to the WiFi flow unless it's set again with main.cpp's magic value.
extern uint32_t hotspotBootFlag;

namespace plus {

namespace {
    // Plus keeps its settings in its own namespace, so they can't clash with
    // upstream's keys in "mural".
    constexpr const char *PREFS_NAMESPACE = "muralplus";
    constexpr const char *CLASSIC_KEY = "classic";
    constexpr uint32_t HOTSPOT_BOOT_MAGIC = 0x4D555241; // same as main.cpp

    bool plusActive = false;
    Movement *gMovement = nullptr;
    PlusPen *gPen = nullptr;
    PlusRunner *gRunner = nullptr;
    Controller *gController = nullptr;
    Diagnostics *gDiagnostics = nullptr;

    bool loadClassicMode() {
        Preferences prefs;
        prefs.begin(PREFS_NAMESPACE, false);
        bool classic = prefs.getBool(CLASSIC_KEY, false); // plus is the default
        prefs.end();
        return classic;
    }

    void saveClassicMode(bool classic) {
        Preferences prefs;
        prefs.begin(PREFS_NAMESPACE, false);
        prefs.putBool(CLASSIC_KEY, classic);
        prefs.end();
    }

    bool gHotspotMode = false;

    void restartNow(void *) {
        esp_restart();
    }

    // GET  /plus/mode  -> {"mode":"plus"|"classic"}
    // POST /plus/mode  mode=plus|classic, then restarts
    // Registered in both modes, so the UI can tell which one is running and switch.
    void registerModeRoutes(AsyncWebServer *server, bool classic) {
        server->on("/plus/mode", HTTP_GET, [classic](AsyncWebServerRequest *request) {
            request->send(200, "application/json", classic ? "{\"mode\":\"classic\"}" : "{\"mode\":\"plus\"}");
        });
        server->on("/plus/mode", HTTP_POST, [](AsyncWebServerRequest *request) {
            String mode = request->arg("mode");
            if (mode != "plus" && mode != "classic") {
                request->send(400, "text/plain", "mode must be plus or classic");
                return;
            }
            if (gController && gController->isDrawing()) {
                request->send(409, "text/plain", "Not available while drawing");
                return;
            }
            if (plusActive && mode == "classic") {
                // Classic mode can replace the drawing on the SD card without plus knowing.
                persist.clearDrawing();
            }
            saveClassicMode(mode == "classic");
            Log.printf("Switching to %s mode, restarting\n", mode.c_str());
            request->send(200, "text/plain", "Restarting");
            restartSoon();
        });
    }
}

void keepHotspotAcrossRestart() {
    if (gHotspotMode) {
        hotspotBootFlag = HOTSPOT_BOOT_MAGIC; // come back on the hotspot, not the WiFi flow
    }
}

void restartSoon() {
    keepHotspotAcrossRestart();
    static esp_timer_handle_t timer = nullptr;
    if (!timer) {
        esp_timer_create_args_t args = {};
        args.callback = restartNow;
        args.name = "plus_restart";
        esp_timer_create(&args, &timer);
    }
    esp_timer_start_once(timer, 500 * 1000);
}

bool begin(AsyncWebServer *server, Movement *movement, Display *display, bool hotspotMode, const String &ipAddress) {
    gHotspotMode = hotspotMode;

    // The log keeps what came before a crash or software restart, but not a power-on.
    int resetReason = esp_reset_reason();
    Log.begin(Persist::resetReasonName(resetReason), resetReason != ESP_RST_POWERON);
    Log.printf("Firmware %s (built %s %s)\n", MURAL_FW_VERSION, __DATE__, __TIME__);

    // Finishes or rolls back a firmware update before anything uses the web UI files.
    ota.beginBoot();

    bool classic = loadClassicMode();
    registerModeRoutes(server, classic);
    if (classic) {
        Log.println("Classic mode (upstream phases)");
        // Before upstream's routes, so the recovery page comes ahead of upstream's static files.
        ota.registerRoutes(server, [movement]() -> const char * {
            return movement->isMoving() ? "Mural is moving, try again when it has stopped" : nullptr;
        });
        ota.confirm(); // upstream's setup can't fail from here, so a new firmware is good
        return false;
    }

    Log.println("Mural Plus mode");
    gMovement = movement;
    persist.begin();
    MovementAccess::clearDriverFlags(movement); // so the Diagnostics page shows driver restarts since boot
    gPen = new PlusPen(persist.loadPenSettings());
    gRunner = new PlusRunner(movement, gPen, display);
    gController = new Controller(movement, gPen, gRunner, display, hotspotMode, ipAddress);
    gDiagnostics = new Diagnostics(movement, gPen, gRunner, gController, hotspotMode);

    // API routes first, so polling /getState doesn't make the static handler
    // look for a file on every request.
    gController->registerRoutes(server);
    gDiagnostics->registerRoutes(server);
    ota.registerRoutes(server, []() -> const char * {
        if (gController->isDrawing()) return "Not available while drawing";
        if (strcmp(gController->statusName(), "idle") != 0) return "Mural is moving, try again when it has stopped";
        return nullptr;
    });
    server->serveStatic("/", LittleFS, "/www/").setDefaultFile("index.html").setCacheControl("no-cache");
    server->onNotFound([](AsyncWebServerRequest *request) {
        request->send(404, "text/plain", "Not found");
    });
    server->begin();
    Log.println("Server started");
    ota.confirm(); // a new firmware got as far as serving the web UI

    if (hotspotMode) {
        display->showHotspotReady(ipAddress);
    } else {
        display->showConnected(ipAddress);
    }
    plusActive = true;
    return true;
}

bool active() {
    return plusActive;
}

void loop() {
    gMovement->runSteppers();
    gPen->update();
    gRunner->run();
    gController->loop();
}

}
