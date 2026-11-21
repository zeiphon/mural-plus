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

namespace plus {

namespace {
    // Plus keeps its settings in its own namespace, so they can't clash with
    // upstream's keys in "mural".
    constexpr const char *PREFS_NAMESPACE = "muralplus";
    constexpr const char *CLASSIC_KEY = "classic";

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

    void restartNow(void *) {
        esp_restart();
    }

    // Restart shortly, so the response that triggered it can still be sent.
    void restartSoon() {
        static esp_timer_handle_t timer = nullptr;
        if (!timer) {
            esp_timer_create_args_t args = {};
            args.callback = restartNow;
            args.name = "plus_restart";
            esp_timer_create(&args, &timer);
        }
        esp_timer_start_once(timer, 500 * 1000);
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

bool begin(AsyncWebServer *server, Movement *movement, Display *display, bool hotspotMode, const String &ipAddress) {
    bool classic = loadClassicMode();
    registerModeRoutes(server, classic);
    if (classic) {
        Log.println("Classic mode (upstream phases)");
        return false;
    }

    // The log keeps what came before a crash or software restart, but not a power-on.
    int resetReason = esp_reset_reason();
    Log.begin(Persist::resetReasonName(resetReason), resetReason != ESP_RST_POWERON);
    Log.printf("Mural Plus mode, firmware %s (built %s %s)\n", MURAL_FW_VERSION, __DATE__, __TIME__);
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
    server->serveStatic("/", LittleFS, "/www/").setDefaultFile("index.html").setCacheControl("no-cache");
    server->onNotFound([](AsyncWebServerRequest *request) {
        request->send(404, "text/plain", "Not found");
    });
    server->begin();
    Log.println("Server started");

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
