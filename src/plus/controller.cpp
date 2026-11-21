#include "controller.h"
#include <SD.h>
#include <stdexcept>
#include "ArduinoJson.h"

namespace plus {

namespace {
    constexpr const char *COMMANDS_PATH = "/commands";
    constexpr double PEN_CAL_STEP_MM = 100.0;  // same as upstream's pen calibration
    constexpr double HOME_TOLERANCE_MM = 0.5;
    constexpr int DEFAULT_SPEED = 650;
    constexpr int MIN_SPEED = 300;
    constexpr int MAX_SPEED = 3000;
}

Controller::Controller(Movement *movement, PlusPen *pen, PlusRunner *runner, Display *display, bool hotspotMode, const String &ipAddress) {
    this->movement = movement;
    this->pen = pen;
    this->runner = runner;
    this->display = display;
    this->hotspotMode = hotspotMode;
    this->ipAddress = ipAddress;
    updateStorageInfo();
}

void Controller::registerRoutes(AsyncWebServer *server) {
    // Upstream's routes (ui/src/api.ts)
    server->on("/getState", HTTP_GET, [this](AsyncWebServerRequest *r) { respondWithState(r); });
    server->on("/setTopDistance", HTTP_POST, [this](AsyncWebServerRequest *r) { setTopDistance(r); });
    server->on("/setPulleyDiameter", HTTP_POST, [this](AsyncWebServerRequest *r) { setPulleyDiameter(r); });
    server->on("/command", HTTP_POST, [this](AsyncWebServerRequest *r) { command(r); });
    server->on("/extendToHome", HTTP_POST, [this](AsyncWebServerRequest *r) { extendToHome(r); });
    server->on("/setServo", HTTP_POST, [this](AsyncWebServerRequest *r) { setServo(r); });
    server->on("/setPenDistance", HTTP_POST, [this](AsyncWebServerRequest *r) { setPenDistance(r); });
    server->on("/estepsCalibration", HTTP_POST, [this](AsyncWebServerRequest *r) { estepsCalibration(r); });
    server->on("/run", HTTP_POST, [this](AsyncWebServerRequest *r) { run(r); });
    server->on("/downloadCommands", HTTP_GET, [this](AsyncWebServerRequest *r) { downloadCommands(r); });
    server->on("/uploadCommands", HTTP_POST,
        [this](AsyncWebServerRequest *r) { uploadComplete(r); },
        [this](AsyncWebServerRequest *r, String filename, size_t index, uint8_t *data, size_t len, bool final) {
            handleUpload(r, filename, index, data, len, final);
        });

    // Plus routes (ui/src/plus/api.ts)
    server->on("/goHome", HTTP_POST, [this](AsyncWebServerRequest *r) { goHome(r); });
    server->on("/penUp", HTTP_POST, [this](AsyncWebServerRequest *r) { penUp(r); });
    server->on("/pauseDrawing", HTTP_POST, [this](AsyncWebServerRequest *r) { pauseDrawing(r); });
    server->on("/resumeDrawing", HTTP_POST, [this](AsyncWebServerRequest *r) { resumeDrawing(r); });
    server->on("/stopDrawing", HTTP_POST, [this](AsyncWebServerRequest *r) { stopDrawing(r); });
}

void Controller::loop() {
    if (positionedMove && !movement->isMoving()) {
        positionedMove = false;
        if (homing) {
            homing = false;
            positionKnown = true;
            Serial.println("At home position, belt position known");
        }
    }

    // Moves that need the pen up first. The pen is ramped, so wait for it.
    if (pendingStartSpeed > 0 || goHomePending) {
        if (!pen->isUp()) {
            if (!pen->isMoving()) {
                pen->up();
            }
            return;
        }
        if (goHomePending) {
            goHomePending = false;
            try {
                Movement::Point home = movement->getHomeCoordinates();
                movement->beginLinearTravel(home.x, home.y, moveSpeedSteps);
                positionedMove = true;
                Serial.println("Returning home");
            } catch (const std::exception &e) {
                positionKnown = false; // beginLinearTravel sets the coordinates before validating them
                Serial.printf("Return home failed: %s\n", e.what());
            }
        }
        int speed = pendingStartSpeed;
        if (speed > 0) {
            try {
                runner->start(speed);
                Serial.printf("Drawing started at speed %d\n", speed);
            } catch (const std::exception &e) {
                snprintf(startError, sizeof(startError), "%s", e.what());
                Serial.printf("Failed to start drawing: %s\n", e.what());
            }
            pendingStartSpeed = 0;
        }
    }

    bool drawing = runner->isRunning();
    if (wasDrawing && !drawing) {
        if (runner->getLastOutcome() == PlusRunner::Outcome::Failed) {
            // The kinematics rejected a move, so the coordinates may not match the belts.
            positionKnown = false;
        }
        showHomeScreen();
    }
    wasDrawing = drawing;
}

const char *Controller::statusName() {
    if (runner->isRunning()) return runner->stateName();
    if (pendingStartSpeed > 0) return "starting";
    if (homing) return "homing";
    if (goHomePending || positionedMove || movement->isMoving()) return "moving";
    return "idle";
}

// A drawing is usable if it was uploaded this session for the current hanger
// distance (drawings are scaled to the drawable width, which depends on it).
// Until plus saves its settings (M4), a drawing left on the SD card from before
// a restart has to be uploaded again.
bool Controller::drawingReady() {
    return drawingFileExists && drawingTopDistance > 0 && drawingTopDistance == movement->getTopDistance();
}

bool Controller::atHome() {
    if (!positionKnown || movement->isMoving()) {
        return false;
    }
    try {
        Movement::Point here = movement->getCoordinates();
        Movement::Point home = movement->getHomeCoordinates();
        return Movement::distanceBetweenPoints(here, home) < HOME_TOLERANCE_MM;
    } catch (const std::exception &) {
        return false;
    }
}

void Controller::showHomeScreen() {
    if (hotspotMode) {
        display->showHotspotReady(ipAddress);
    } else {
        display->showConnected(ipAddress);
    }
}

// Same as upstream's PhaseManager::updateFreeKb: the space an upload can use,
// counting the current drawing, which an upload replaces.
void Controller::updateStorageInfo() {
    size_t free = SD.totalBytes() - SD.usedBytes();
    drawingFileExists = SD.exists(COMMANDS_PATH);
    if (drawingFileExists) {
        File f = SD.open(COMMANDS_PATH);
        if (f) {
            free += f.size();
            f.close();
        }
    }
    cachedFreeKb = (int)(free / 1024);
}

bool Controller::rejectIfDrawing(AsyncWebServerRequest *request) {
    if (isDrawing()) {
        request->send(409, "text/plain", "Not available while drawing");
        return true;
    }
    return false;
}

bool Controller::rejectIfBusy(AsyncWebServerRequest *request) {
    if (rejectIfDrawing(request)) return true;
    if (goHomePending || positionedMove || movement->isMoving()) {
        request->send(409, "text/plain", "Mural is moving, try again when it has stopped");
        return true;
    }
    return false;
}

void Controller::respondWithState(AsyncWebServerRequest *request) {
    int topDistance = movement->getTopDistance();
    bool distanceSet = topDistance > 0;
    Movement::Point home = movement->getHomeCoordinates();
    bool positionReady = positionKnown;
    bool penReady = pen->isCalibrated();
    bool drawingOk = drawingReady();
    bool drawing = isDrawing();

    AsyncResponseStream *response = request->beginResponseStream("application/json");
    DynamicJsonBuffer jsonBuffer;
    JsonObject &root = jsonBuffer.createObject();

    // Upstream's BackendState fields, read by the reused upstream screens.
    root["phase"] = "SvgSelect"; // nominal: plus has no phases
    root["moving"] = movement->isMoving();
    root["startedHoming"] = movement->hasStartedHoming();
    root["topDistance"] = topDistance;
    root["pulleyDiameter"] = movement->getPulleyDiameter();
    root["safeWidth"] = distanceSet ? movement->getWidth() : -1;
    root["safeXFraction"] = safeXFraction;
    root["safeYFraction"] = safeYFraction;
    root["homeX"] = home.x;
    root["homeY"] = home.y;
    root["freeKb"] = (int)cachedFreeKb;

    // Plus fields (ui/src/plus/types.ts)
    root["mode"] = "plus";
    root["status"] = statusName();
    root["drawingActive"] = drawing;

    JsonObject &run = root.createNestedObject("drawing");
    run["state"] = pendingStartSpeed > 0 ? "starting" : runner->stateName();
    run["progress"] = runner->getProgress();
    run["distanceDone"] = runner->getDistanceSoFar();
    run["totalDistance"] = runner->getTotalDistance();
    run["elapsedMs"] = runner->getElapsedMs();
    run["lastOutcome"] = runner->lastOutcomeName();
    run["error"] = runner->getLastError();          // why the last drawing failed
    run["startError"] = (const char *)startError;   // why the last start failed

    JsonObject &position = root.createNestedObject("position");
    position["known"] = positionReady;
    position["homing"] = (bool)homing;
    position["atHome"] = atHome();

    const PenSettings &ps = pen->getSettings();
    JsonObject &penJson = root.createNestedObject("pen");
    penJson["calibrated"] = penReady;
    penJson["down"] = ps.downAngle;
    penJson["up"] = ps.upAngle;
    penJson["isDown"] = pen->isDown();
    penJson["moving"] = pen->isMoving();

    JsonObject &file = root.createNestedObject("drawingFile");
    file["exists"] = (bool)drawingFileExists;
    file["topDistance"] = (int)drawingTopDistance;
    file["compatible"] = drawingOk;

    JsonObject &ready = root.createNestedObject("ready");
    ready["distance"] = distanceSet;
    ready["position"] = positionReady;
    ready["pen"] = penReady;
    ready["drawing"] = drawingOk;
    ready["all"] = distanceSet && positionReady && penReady && drawingOk;

    root.printTo(*response);
    request->send(response);
}

void Controller::setTopDistance(AsyncWebServerRequest *request) {
    if (rejectIfBusy(request)) return;
    int distance = request->arg("distance").toInt();
    if (distance <= 0) {
        request->send(400, "text/plain", "Distance must be a positive number of millimeters");
        return;
    }
    if (distance != movement->getTopDistance() && positionKnown) {
        // x/y are relative to the hangers, so with a different distance the
        // coordinates no longer describe where the bot really is.
        positionKnown = false;
        Serial.println("Hanger distance changed, belt position no longer known");
    }
    movement->setTopDistance(distance);
    respondWithState(request);
}

void Controller::setPulleyDiameter(AsyncWebServerRequest *request) {
    if (rejectIfBusy(request)) return;
    double diameter = request->arg("diameter").toDouble();
    if (diameter <= 0) {
        request->send(400, "text/plain", "Diameter must be a positive number of millimeters");
        return;
    }
    if (diameter != movement->getPulleyDiameter() && positionKnown) {
        // Step counts now map to different belt lengths.
        positionKnown = false;
        Serial.println("Pulley diameter changed, belt position no longer known");
    }
    movement->setPulleyDiameter(diameter);
    request->send(200, "text/plain", "OK");
}

void Controller::command(AsyncWebServerRequest *request) {
    if (rejectIfDrawing(request)) return;
    String command = request->arg("command");

    if (command == "raise" || command == "lower") {
        calibrationMove(request, command == "raise");
        return;
    }

    // Manual belt moves. Stops are rejected during a positioned move too: the
    // Tools modal sends them whenever it closes, and stopping one motor mid-move
    // would leave the position wrong.
    if (goHomePending || positionedMove) {
        request->send(409, "text/plain", "Wait for the current move to finish");
        return;
    }
    if (command == "l-ret" || command == "l-ext" || command == "r-ret" || command == "r-ext") {
        if (positionKnown) {
            positionKnown = false;
            Serial.println("Belts moved by hand, belt position no longer known");
        }
    }
    if (command == "l-ret") {
        movement->leftStepper(-1);
    } else if (command == "l-ext") {
        movement->leftStepper(1);
    } else if (command == "l-0") {
        movement->leftStepper(0);
    } else if (command == "r-ret") {
        movement->rightStepper(-1);
    } else if (command == "r-ext") {
        movement->rightStepper(1);
    } else if (command == "r-0") {
        movement->rightStepper(0);
    } else {
        request->send(400, "text/plain", "Unsupported command");
        return;
    }
    request->send(200, "text/plain", "OK");
}

// Moves the bot up or down by PEN_CAL_STEP_MM during pen calibration, like
// upstream. Responds with the move time in seconds ("0" if it can't move now).
void Controller::calibrationMove(AsyncWebServerRequest *request, bool raise) {
    if (goHomePending || positionedMove || movement->isMoving()) {
        request->send(200, "text/plain", "0");
        return;
    }
    if (!positionKnown) {
        request->send(409, "text/plain", "Belt position unknown, extend the belts to home first");
        return;
    }
    try {
        Movement::Point current = movement->getCoordinates();
        double newY = current.y + (raise ? -PEN_CAL_STEP_MM : PEN_CAL_STEP_MM);
        if (newY < 0) {
            request->send(200, "text/plain", "0");
            return;
        }
        Serial.printf("Pen calibration move to %.1f, %.1f\n", current.x, newY);
        float moveTime = movement->beginLinearTravel(current.x, newY, printSpeedSteps);
        positionedMove = true;
        display->showCalibration(current.x, newY);
        request->send(200, "text/plain", String(int(ceil(moveTime)) + 1));
    } catch (const std::exception &e) {
        positionKnown = false; // beginLinearTravel sets the coordinates before validating them
        Serial.printf("Pen calibration move failed: %s\n", e.what());
        request->send(500, "text/plain", String("Move failed: ") + e.what());
    }
}

void Controller::extendToHome(AsyncWebServerRequest *request) {
    if (rejectIfBusy(request)) return;
    if (movement->getTopDistance() <= 0) {
        request->send(400, "text/plain", "Set the hanger distance first");
        return;
    }
    try {
        int seconds = movement->extendToHome() + 1; // extra second for good measure
        positionKnown = false;
        homing = true;
        positionedMove = true;
        Serial.println("Extending to home");
        request->send(200, "text/plain", String(seconds));
    } catch (const std::exception &e) {
        Serial.printf("Extend to home failed: %s\n", e.what());
        request->send(500, "text/plain", String("Extend to home failed: ") + e.what());
    }
}

// Moves back to the home position with the pen up (on the main loop).
void Controller::goHome(AsyncWebServerRequest *request) {
    if (rejectIfBusy(request)) return;
    if (!positionKnown) {
        request->send(400, "text/plain", "Belt position unknown, extend the belts to home instead");
        return;
    }
    goHomePending = true;
    respondWithState(request);
}

void Controller::setServo(AsyncWebServerRequest *request) {
    if (rejectIfDrawing(request)) return;
    if (!request->hasArg("angle")) {
        request->send(400, "text/plain", "Missing angle");
        return;
    }
    pen->moveTo(request->arg("angle").toInt()); // ramped and clamped
    request->send(200, "text/plain", "OK");
}

void Controller::penUp(AsyncWebServerRequest *request) {
    if (rejectIfDrawing(request)) return;
    pen->up();
    request->send(200, "text/plain", "OK");
}

// Saves the pen-down angle and lifts the pen.
void Controller::setPenDistance(AsyncWebServerRequest *request) {
    if (rejectIfDrawing(request)) return;
    if (!request->hasArg("angle")) {
        request->send(400, "text/plain", "Missing angle");
        return;
    }
    pen->setDownAngle(request->arg("angle").toInt());
    pen->up();
    respondWithState(request);
}

void Controller::estepsCalibration(AsyncWebServerRequest *request) {
    if (rejectIfBusy(request)) return;
    int distanceMm = request->arg("distance").toInt();
    if (distanceMm <= 0) {
        request->send(400, "text/plain", "Distance must be a positive number of millimeters");
        return;
    }
    if (positionKnown) {
        positionKnown = false;
        Serial.println("E-steps calibration move, belt position no longer known");
    }
    Serial.printf("Extending %d mm\n", distanceMm);
    movement->extendBelts(distanceMm);
    request->send(200, "text/plain", "OK");
}

// Port of upstream's SvgSelectPhase::handleUpload. The drawing arrives in chunks,
// one request each, identified by their byte offset so a retry can overwrite.
void Controller::handleUpload(AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final) {
    if (!index) {
        uploadErrorCode = 0;
        uploadError = "";
        if (isDrawing()) {
            uploadErrorCode = 409;
            uploadError = "Not available while drawing";
            return;
        }
        if (movement->getTopDistance() <= 0) {
            uploadErrorCode = 400;
            uploadError = "Set the hanger distance first";
            return;
        }

        size_t offset = request->hasParam("offset")
            ? strtoul(request->getParam("offset")->value().c_str(), nullptr, 10)
            : 0;
        uploadIsLastChunk = request->hasParam("final") && request->getParam("final")->value() == "true";

        if (offset == 0) {
            // The old drawing is about to be overwritten, so stop offering it.
            drawingFileExists = false;
            drawingTopDistance = -1;
            if (SD.exists(COMMANDS_PATH)) {
                SD.remove(COMMANDS_PATH);
            }

            size_t totalBytes = request->hasParam("totalBytes")
                ? strtoul(request->getParam("totalBytes")->value().c_str(), nullptr, 10)
                : request->contentLength();
            size_t freeBytes = SD.totalBytes() - SD.usedBytes();
            Serial.printf("Upload size: %u bytes, %u bytes free\n", (unsigned)totalBytes, (unsigned)freeBytes);
            if (freeBytes < totalBytes) {
                uploadErrorCode = 400;
                uploadError = "Not enough space for upload";
                return;
            }
            request->_tempFile = SD.open(COMMANDS_PATH, "w");
            Serial.println("Upload started");
        } else {
            request->_tempFile = SD.open(COMMANDS_PATH, "r+");
            if (!request->_tempFile || !request->_tempFile.seek(offset)) {
                uploadErrorCode = 409;
                uploadError = "Upload out of order, restart upload";
                return;
            }
        }
        if (!request->_tempFile) {
            uploadErrorCode = 500;
            uploadError = "Couldn't open the drawing file on the SD card";
            return;
        }
    }

    if (len && request->_tempFile) {
        request->_tempFile.write(data, len);
    }

    if (final && request->_tempFile) {
        request->_tempFile.close();
        if (uploadIsLastChunk && uploadErrorCode == 0) {
            drawingTopDistance = movement->getTopDistance();
            updateStorageInfo();
            Serial.println("Upload finished");
        }
    }
}

void Controller::uploadComplete(AsyncWebServerRequest *request) {
    if (uploadErrorCode != 0) {
        Serial.printf("Upload failed: %s\n", uploadError.c_str());
        request->send(uploadErrorCode, "text/plain", uploadError);
        return;
    }
    respondWithState(request);
}

void Controller::downloadCommands(AsyncWebServerRequest *request) {
    if (rejectIfDrawing(request)) return; // the runner is reading the SD card
    if (!SD.exists(COMMANDS_PATH)) {
        request->send(404, "text/plain", "No drawing uploaded");
        return;
    }
    request->send(SD, COMMANDS_PATH, "text/plain");
}

// Checks everything up front, then leaves the start to loop(), which lifts the
// pen first. The web server stays up while drawing (upstream stops it here).
void Controller::run(AsyncWebServerRequest *request) {
    if (rejectIfBusy(request)) return;
    if (!positionKnown) {
        request->send(400, "text/plain", "Belt position unknown, extend the belts to home first");
        return;
    }
    if (!pen->isCalibrated()) {
        request->send(400, "text/plain", "Calibrate the pen first");
        return;
    }
    if (!drawingReady()) {
        request->send(400, "text/plain", "Choose a drawing for this hanger distance first");
        return;
    }
    int speed = request->hasArg("speed") ? request->arg("speed").toInt() : DEFAULT_SPEED;
    startError[0] = '\0';
    pendingStartSpeed = constrain(speed, MIN_SPEED, MAX_SPEED);
    respondWithState(request);
}

void Controller::pauseDrawing(AsyncWebServerRequest *request) {
    if (!runner->isRunning()) {
        request->send(400, "text/plain", "Not drawing");
        return;
    }
    Serial.println("Pause requested");
    runner->requestPause();
    respondWithState(request);
}

void Controller::resumeDrawing(AsyncWebServerRequest *request) {
    if (!runner->isRunning()) {
        request->send(400, "text/plain", "Not drawing");
        return;
    }
    Serial.println("Resume requested");
    runner->requestResume();
    respondWithState(request);
}

void Controller::stopDrawing(AsyncWebServerRequest *request) {
    if (!runner->isRunning()) {
        request->send(400, "text/plain", "Not drawing");
        return;
    }
    Serial.println("Stop requested");
    runner->requestStop();
    respondWithState(request);
}

}
