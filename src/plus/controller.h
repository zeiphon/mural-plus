#ifndef PlusController_h
#define PlusController_h
#include <ESPAsyncWebServer.h>
#include "movement.h"
#include "display.h"
#include "plus_pen.h"
#include "plus_runner.h"

namespace plus {

// Phase-less replacement for upstream's PhaseManager. Setup is a set of steps
// (hanger distance, drawing, belts, pen) that can be done in any order and
// redone at any time. Each request checks the state it needs (for example
// "not while moving" or "needs the hanger distance") instead of a phase.
//
// It serves the same routes and JSON fields as upstream (see ui/src/api.ts and
// ui/src/types.ts), so the upstream screens plus reuses work unchanged, plus
// the plus routes (drawing control, return home).
//
// Requests arrive on the web server task. Anything that has to wait for the pen
// or start the runner is handed to loop() on the main task through a flag.
class Controller {
    public:
    Controller(Movement *movement, PlusPen *pen, PlusRunner *runner, Display *display, bool hotspotMode, const String &ipAddress);
    void registerRoutes(AsyncWebServer *server);
    void loop();
    bool isDrawing() { return runner->isRunning() || pendingStartSpeed > 0; }

    private:
    Movement *movement;
    PlusPen *pen;
    PlusRunner *runner;
    Display *display;
    AsyncWebServer *server = nullptr;
    bool hotspotMode;
    String ipAddress;
    bool serverStopped = false;            // stopped for a drawing (webWhileDrawing off)

    volatile int pendingStartSpeed = 0;    // > 0: loop() lifts the pen, then starts the drawing
    volatile bool goHomePending = false;   // loop() lifts the pen, then moves home
    volatile bool positionedMove = false;  // extend to home, return home, or a pen-calibration raise/lower
    volatile bool homing = false;          // extend to home in progress
    volatile bool positionKnown = false;   // homed, and the belts haven't been moved by hand since
    volatile int drawingTopDistance = -1;  // hanger distance the uploaded drawing was made for, -1 = none
    volatile bool drawingFileExists = false;
    volatile int cachedFreeKb = 0;
    char startError[96] = {0};             // why the last drawing failed to start
    bool wasDrawing = false;

    // Upload bookkeeping. The UI sends one chunk request at a time.
    int uploadErrorCode = 0;
    String uploadError;
    bool uploadIsLastChunk = false;

    const char *statusName();
    bool drawingReady();
    bool atHome();
    void showHomeScreen();
    void updateStorageInfo();
    bool rejectIfDrawing(AsyncWebServerRequest *request);
    bool rejectIfBusy(AsyncWebServerRequest *request);

    void respondWithState(AsyncWebServerRequest *request);
    void setTopDistance(AsyncWebServerRequest *request);
    void setPulleyDiameter(AsyncWebServerRequest *request);
    void command(AsyncWebServerRequest *request);
    void calibrationMove(AsyncWebServerRequest *request, bool raise);
    void extendToHome(AsyncWebServerRequest *request);
    void goHome(AsyncWebServerRequest *request);
    void setServo(AsyncWebServerRequest *request);
    void penUp(AsyncWebServerRequest *request);
    void setPenDistance(AsyncWebServerRequest *request);
    void estepsCalibration(AsyncWebServerRequest *request);
    void handleUpload(AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final);
    void uploadComplete(AsyncWebServerRequest *request);
    void downloadCommands(AsyncWebServerRequest *request);
    void run(AsyncWebServerRequest *request);
    void pauseDrawing(AsyncWebServerRequest *request);
    void resumeDrawing(AsyncWebServerRequest *request);
    void stopDrawing(AsyncWebServerRequest *request);
    void setDrawingSpeed(AsyncWebServerRequest *request);
    void adjustPen(AsyncWebServerRequest *request);
    void setPenSettings(AsyncWebServerRequest *request);
    void penDown(AsyncWebServerRequest *request);
    void setSettings(AsyncWebServerRequest *request);
};

}

#endif
