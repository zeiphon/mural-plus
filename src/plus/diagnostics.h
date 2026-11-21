#ifndef PlusDiagnostics_h
#define PlusDiagnostics_h
#include <ESPAsyncWebServer.h>
#include "ArduinoJson.h"
#include "movement.h"
#include "plus_pen.h"
#include "plus_runner.h"
#include "controller.h"

// Set at build time from git by scripts/fw_version.py.
#ifndef MURAL_FW_VERSION
#define MURAL_FW_VERSION "unknown"
#endif

namespace plus {

// Troubleshooting routes for the Diagnostics page (ui/src/plus/screens/DiagnosticsScreen.tsx):
//   GET  /diagnostics  JSON snapshot: system, servo, motors, motor drivers, storage
//   GET  /log          recent plus log lines, oldest first (text)
//   POST /servo        action=up|down|angle|nudge|release|cycle|stop [value=], not while drawing
// The "log drawing moves" setting goes through the controller's /settings.
class Diagnostics {
    public:
    Diagnostics(Movement *movement, PlusPen *pen, PlusRunner *runner, Controller *controller, bool hotspotMode);
    void registerRoutes(AsyncWebServer *server);

    private:
    Movement *movement;
    PlusPen *pen;
    PlusRunner *runner;
    Controller *controller;
    bool hotspotMode;

    void handleDiagnostics(AsyncWebServerRequest *request);
    void addDriver(JsonArray &drivers, const char *name, bool left);
    void handleServo(AsyncWebServerRequest *request);
};

}

#endif
