#include "diagnostics.h"
#include <LittleFS.h>
#include <WiFi.h>
#include <stdexcept>
#include "ArduinoJson.h"
#include "logger.h"
#include "persist.h"

namespace plus {

Diagnostics::Diagnostics(Movement *movement, PlusPen *pen, PlusRunner *runner, Controller *controller, bool hotspotMode) {
    this->movement = movement;
    this->pen = pen;
    this->runner = runner;
    this->controller = controller;
    this->hotspotMode = hotspotMode;
}

void Diagnostics::registerRoutes(AsyncWebServer *server) {
    server->on("/diagnostics", HTTP_GET, [this](AsyncWebServerRequest *r) { handleDiagnostics(r); });
    server->on("/log", HTTP_GET, [](AsyncWebServerRequest *r) { r->send(200, "text/plain", Log.dump()); });
    server->on("/servo", HTTP_POST, [this](AsyncWebServerRequest *r) { handleServo(r); });
}

void Diagnostics::handleDiagnostics(AsyncWebServerRequest *request) {
    AsyncResponseStream *response = request->beginResponseStream("application/json");
    DynamicJsonBuffer jsonBuffer;
    JsonObject &root = jsonBuffer.createObject();

    JsonObject &system = root.createNestedObject("system");
    system["firmware"] = MURAL_FW_VERSION;
    system["built"] = __DATE__ " " __TIME__;
    system["uptimeMs"] = millis();
    system["bootCount"] = persist.getBootCount();
    uint8_t history[8];
    int n = persist.getResetHistory(history, 8);
    JsonArray &resets = system.createNestedArray("resetHistory");
    for (int i = 0; i < n; i++) {
        JsonObject &reset = resets.createNestedObject();
        reset["reason"] = Persist::resetReasonName(history[i]);
        reset["brownout"] = history[i] == ESP_RST_BROWNOUT;
    }
    system["freeHeap"] = ESP.getFreeHeap();
    system["minFreeHeap"] = ESP.getMinFreeHeap();
    system["maxAllocHeap"] = ESP.getMaxAllocHeap();
    system["cpuMHz"] = ESP.getCpuFreqMHz();
    system["hotspot"] = hotspotMode;
    system["ip"] = hotspotMode ? WiFi.softAPIP().toString() : WiFi.localIP().toString();
    if (!hotspotMode) {
        system["wifiRssi"] = WiFi.RSSI();
    }
    system["status"] = controller->statusName();
    system["drawing"] = controller->isDrawing();
    system["progress"] = runner->getProgress();
    system["logDrawingMoves"] = persist.getLogDrawingMoves();

    const PenSettings &ps = pen->getSettings();
    JsonObject &servo = root.createNestedObject("servo");
    servo["pin"] = SERVO_PIN;
    servo["attached"] = pen->isAttached();
    servo["positionKnown"] = pen->isPositionKnown();
    servo["position"] = pen->positionName();
    servo["commandedAngle"] = pen->getCurrentAngle();
    servo["targetAngle"] = pen->getTargetAngle();
    servo["pulseUs"] = pen->getPulseWidthUs();
    servo["moving"] = pen->isMoving();
    servo["moveCount"] = pen->getMoveCount();
    servo["lastMoveFrom"] = pen->getLastMoveFrom();
    servo["lastMoveTo"] = pen->getLastMoveTo();
    servo["lastMoveMs"] = pen->getLastMoveMs();
    servo["cycleRemaining"] = pen->getCycleRemaining();
    servo["upAngle"] = pen->getUpAngle();
    servo["downAngle"] = pen->getDownAngle();
    servo["minAngle"] = ps.minAngle;
    servo["maxAngle"] = ps.maxAngle;
    servo["speedDegPerSec"] = ps.speedDegPerSec;
    servo["releaseWhenUp"] = ps.releaseWhenUp;

    JsonObject &motors = root.createNestedObject("motors");
    motors["moving"] = movement->isMoving();
    motors["topDistance"] = movement->getTopDistance();
    motors["pulleyDiameter"] = movement->getPulleyDiameter();
    motors["positionKnown"] = (bool)controller->positionKnown;
    motors["homing"] = (bool)controller->homing;
    if (controller->positionKnown) {
        try {
            Movement::Point here = movement->getCoordinates();
            motors["x"] = here.x;
            motors["y"] = here.y;
        } catch (const std::exception &) {
        }
    }
    // What a manual move (Belts screen or Tools) is doing: -1 retracting, 1 extending, 0 stopped
    motors["leftManual"] = controller->leftBelt.dir;
    motors["rightManual"] = controller->rightBelt.dir;
    motors["boosting"] = controller->leftBelt.boosted || controller->rightBelt.boosted;

    JsonObject &storage = root.createNestedObject("storage");
    storage["uiTotalBytes"] = LittleFS.totalBytes();
    storage["uiUsedBytes"] = LittleFS.usedBytes();
    storage["sdTotalBytes"] = (double)controller->sdTotalBytes; // can be over 4 GB
    storage["sdUsedBytes"] = (double)controller->sdUsedBytes;
    storage["drawingExists"] = (bool)controller->drawingFileExists;
    storage["drawingBytes"] = controller->drawingFileSize;
    storage["drawingTopDistance"] = (int)controller->drawingTopDistance;
    storage["drawingReady"] = controller->drawingReady();

    root.printTo(*response);
    request->send(response);
}

void Diagnostics::handleServo(AsyncWebServerRequest *request) {
    if (controller->rejectIfDrawing(request)) return;
    String action = request->arg("action");
    bool hasValue = request->hasArg("value");
    int value = request->arg("value").toInt();
    if (action == "up") {
        pen->stopTest();
        pen->up();
    } else if (action == "down") {
        if (!pen->isCalibrated()) {
            request->send(400, "text/plain", "Calibrate the pen first");
            return;
        }
        pen->stopTest();
        pen->down();
    } else if (action == "angle") {
        if (!hasValue) {
            request->send(400, "text/plain", "Missing value");
            return;
        }
        pen->stopTest();
        pen->moveTo(value); // clamped to the soft limits
    } else if (action == "nudge") {
        pen->stopTest();
        pen->moveTo(pen->getTargetAngle() + value);
    } else if (action == "release") {
        pen->release();
    } else if (action == "cycle") {
        if (!pen->isCalibrated()) {
            request->send(400, "text/plain", "Calibrate the pen first");
            return;
        }
        pen->startCycleTest(constrain(hasValue ? value : 5, 1, 100));
    } else if (action == "stop") {
        pen->stopTest();
    } else {
        request->send(400, "text/plain", "action must be up, down, angle, nudge, release, cycle or stop");
        return;
    }
    Log.printf("Diagnostics: servo %s%s%s\n", action.c_str(), hasValue ? " " : "", hasValue ? String(value).c_str() : "");
    request->send(200, "text/plain", "OK");
}

}
