#include "persist.h"
#include <Arduino.h>
#include <esp_system.h>
#include "logger.h"

namespace plus {

Persist persist;

namespace {
    constexpr const char *NAMESPACE = "muralplus";
}

const char *Persist::resetReasonName(int reason) {
    switch (reason) {
        case ESP_RST_POWERON:   return "Power on";
        case ESP_RST_EXT:       return "Reset pin";
        case ESP_RST_SW:        return "Software restart";
        case ESP_RST_PANIC:     return "Crash (exception or panic)";
        case ESP_RST_INT_WDT:   return "Interrupt watchdog";
        case ESP_RST_TASK_WDT:  return "Task watchdog";
        case ESP_RST_WDT:       return "Other watchdog";
        case ESP_RST_DEEPSLEEP: return "Wake from deep sleep";
        case ESP_RST_BROWNOUT:  return "Brownout (supply voltage dropped)";
        case ESP_RST_SDIO:      return "SDIO reset";
        default:                return "Unknown";
    }
}

void Persist::begin() {
    prefs.begin(NAMESPACE, false);

    bootCount = prefs.getUInt("bootCount", 0) + 1;
    prefs.putUInt("bootCount", bootCount);
    prefs.getBytes("rstHist", resetHistory, sizeof(resetHistory));
    memmove(resetHistory + 1, resetHistory, RESET_HISTORY - 1);
    resetHistory[0] = (uint8_t)esp_reset_reason();
    prefs.putBytes("rstHist", resetHistory, sizeof(resetHistory));
    Log.printf("Boot #%u, reset reason: %s\n", (unsigned)bootCount, resetReasonName(resetHistory[0]));
    if (resetHistory[0] == ESP_RST_BROWNOUT) {
        Log.println("WARNING: the last restart was a brownout. Check the power supply and the servo's current draw.");
    }

    webWhileDrawing = prefs.getBool("webDraw", true);
    logDrawingMoves = prefs.getBool("logMoves", false);
    topDistance = prefs.getInt("topDist", -1);
    drawingTopDistance = prefs.getInt("drawTop", -1);
    drawingSize = prefs.getUInt("drawSize", 0);
}

PenSettings Persist::loadPenSettings() {
    PenSettings s;
    s.upAngle = prefs.getInt("penUp", s.upAngle);
    s.downAngle = prefs.getInt("penDown", s.downAngle);
    s.minAngle = prefs.getInt("srvMin", s.minAngle);
    s.maxAngle = prefs.getInt("srvMax", s.maxAngle);
    s.speedDegPerSec = prefs.getInt("srvSpeed", s.speedDegPerSec);
    s.releaseWhenUp = prefs.getBool("srvRelease", s.releaseWhenUp);
    return s;
}

void Persist::savePenSettings(const PenSettings &s) {
    prefs.putInt("penUp", s.upAngle);
    prefs.putInt("penDown", s.downAngle);
    prefs.putInt("srvMin", s.minAngle);
    prefs.putInt("srvMax", s.maxAngle);
    prefs.putInt("srvSpeed", s.speedDegPerSec);
    prefs.putBool("srvRelease", s.releaseWhenUp);
}

void Persist::setWebWhileDrawing(bool enabled) {
    webWhileDrawing = enabled;
    prefs.putBool("webDraw", enabled);
}

int Persist::getResetHistory(uint8_t *out, int max) {
    int n = 0;
    for (int i = 0; i < RESET_HISTORY && n < max; i++) {
        if (resetHistory[i] == ESP_RST_UNKNOWN) break; // unused slot
        out[n++] = resetHistory[i];
    }
    return n;
}

void Persist::setLogDrawingMoves(bool enabled) {
    logDrawingMoves = enabled;
    prefs.putBool("logMoves", enabled);
}

void Persist::setTopDistance(int mm) {
    if (mm == topDistance) return;
    topDistance = mm;
    prefs.putInt("topDist", mm);
}

void Persist::setDrawing(int topDistanceMm, uint32_t size) {
    drawingTopDistance = topDistanceMm;
    drawingSize = size;
    prefs.putInt("drawTop", topDistanceMm);
    prefs.putUInt("drawSize", size);
}

void Persist::clearDrawing() {
    if (drawingTopDistance < 0 && drawingSize == 0) return;
    setDrawing(-1, 0);
}

}
