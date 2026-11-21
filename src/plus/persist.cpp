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

}
