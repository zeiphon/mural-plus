#ifndef Plus_h
#define Plus_h
#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include "movement.h"
#include "display.h"

// Mural Plus: a phase-less implementation that runs instead of upstream's phase
// flow ("classic mode"). Only one mode runs per boot. The choice is stored in
// NVS, and switching restarts the board. See V2_PORT_PLAN.md.
namespace plus {
    // Called from setup() once WiFi (or the hotspot) and mDNS are up. Registers
    // the mode routes in both modes. In classic mode it then returns false and
    // upstream's setup carries on. In plus mode it sets everything up, starts
    // the server and returns true, and setup() returns.
    bool begin(AsyncWebServer *server, Movement *movement, Display *display, bool hotspotMode, const String &ipAddress);

    // True once begin() has started plus mode.
    bool active();

    // Runs instead of upstream's loop() body in plus mode.
    void loop();
}

#endif
