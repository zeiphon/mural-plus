#ifndef PlusController_h
#define PlusController_h
#include <ESPAsyncWebServer.h>
#include "movement.h"
#include "pen.h"
#include "runner.h"
#include "display.h"

namespace plus {

// Phase-less replacement for upstream's PhaseManager. Setup is a set of steps
// (hanger distance, drawing, belts, pen) that can be done in any order and
// redone at any time. Each request checks the state it needs (for example
// "not while moving" or "needs the hanger distance") instead of a phase.
//
// It serves the same routes and JSON fields as upstream (see ui/src/api.ts and
// ui/src/types.ts), so the upstream screens plus reuses work unchanged.
//
// Requests arrive on the web server task. Anything that blocks or touches the
// pen or runner is handed to loop() on the main task through a flag.
class Controller {
    public:
    Controller(Movement *movement, Pen *pen, Runner *runner, Display *display);
    void registerRoutes(AsyncWebServer *server);
    void loop();
    bool isDrawing() { return drawing; }

    private:
    Movement *movement;
    Pen *pen;
    Runner *runner;
    Display *display;

    // Set when a drawing starts. Upstream's Runner (used until M2) restarts the
    // board when the drawing ends, so this never goes back to false.
    volatile bool drawing = false;
    volatile int pendingStartSpeed = 0;  // > 0: loop() starts the drawing
    volatile bool penUpPending = false;  // loop() lifts the pen after calibration
    volatile bool positionedMove = false;  // extend to home or a pen-calibration raise/lower
    volatile bool homing = false;          // extend to home in progress
    volatile bool positionKnown = false;   // homed, and the belts haven't been moved by hand since
    volatile int penDownAngle = -1;        // calibrated pen-down angle, -1 = not calibrated
    volatile int drawingTopDistance = -1;  // hanger distance the uploaded drawing was made for, -1 = none
    volatile bool drawingFileExists = false;
    volatile int cachedFreeKb = 0;
    char lastError[96] = {0};              // why the last drawing failed to start

    // Upload bookkeeping. The UI sends one chunk request at a time.
    int uploadErrorCode = 0;
    String uploadError;
    bool uploadIsLastChunk = false;

    const char *statusName();
    bool drawingReady();
    void updateStorageInfo();
    bool rejectIfDrawing(AsyncWebServerRequest *request);
    bool rejectIfBusy(AsyncWebServerRequest *request);

    void respondWithState(AsyncWebServerRequest *request);
    void setTopDistance(AsyncWebServerRequest *request);
    void setPulleyDiameter(AsyncWebServerRequest *request);
    void command(AsyncWebServerRequest *request);
    void calibrationMove(AsyncWebServerRequest *request, bool raise);
    void extendToHome(AsyncWebServerRequest *request);
    void setServo(AsyncWebServerRequest *request);
    void setPenDistance(AsyncWebServerRequest *request);
    void estepsCalibration(AsyncWebServerRequest *request);
    void handleUpload(AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final);
    void uploadComplete(AsyncWebServerRequest *request);
    void downloadCommands(AsyncWebServerRequest *request);
    void run(AsyncWebServerRequest *request);
};

}

#endif
