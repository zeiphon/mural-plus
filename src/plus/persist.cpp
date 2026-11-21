#include "persist.h"
#include <Arduino.h>

namespace plus {

Persist persist;

namespace {
    constexpr const char *NAMESPACE = "muralplus";
}

void Persist::begin() {
    prefs.begin(NAMESPACE, false);
    webWhileDrawing = prefs.getBool("webDraw", true);
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
