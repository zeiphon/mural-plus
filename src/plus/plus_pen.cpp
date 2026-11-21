#include "plus_pen.h"
#include <Arduino.h>

namespace plus {

PlusPen::PlusPen() {
    servo = new Servo();
    // Don't attach yet: ESP32Servo sends no pulses until attached, so the servo
    // stays where it is until the first update() after the hold-off. Head for "up".
    targetAngle = clamp(settings.upAngle);
    currentAngle = targetAngle;
    position = Position::Up;
    pendingMove = true;
    busy = true;
    holdOffUntilMs = millis() + BOOT_HOLDOFF_MS;
    Serial.printf("Pen: up=%d limits=%d..%d speed=%d deg/s\n",
                  settings.upAngle, settings.minAngle, settings.maxAngle, settings.speedDegPerSec);
}

int PlusPen::clamp(int angle) {
    if (angle < settings.minAngle) return settings.minAngle;
    if (angle > settings.maxAngle) return settings.maxAngle;
    return angle;
}

void PlusPen::writeAngle(int angle) {
    if (!attached) {
        servo->attach(SERVO_PIN);
        attached = true;
    }
    servo->write(angle);
}

void PlusPen::setTarget(int angle, Position newPosition) {
    int clamped = clamp(angle);
    if (clamped != angle) {
        Serial.printf("Pen: %d deg clamped to %d (limits %d..%d)\n", angle, clamped, settings.minAngle, settings.maxAngle);
    }
    targetAngle = clamped;
    position = newPosition;
    busy = true;
    pendingMove = true;
}

void PlusPen::moveTo(int angle) {
    setTarget(angle, Position::Other);
}

void PlusPen::up() {
    setTarget(settings.upAngle, Position::Up);
}

void PlusPen::down() {
    if (!isCalibrated()) {
        Serial.println("Pen: down requested but the pen isn't calibrated, ignoring");
        return;
    }
    setTarget(settings.downAngle, Position::Down);
}

void PlusPen::setDownAngle(int angle) {
    settings.downAngle = clamp(angle);
    if (settings.downAngle >= settings.upAngle) {
        Serial.printf("Pen: warning, down angle %d isn't below the up angle %d\n", settings.downAngle, settings.upAngle);
    }
    Serial.printf("Pen: down angle set to %d deg\n", settings.downAngle);
}

void PlusPen::update() {
    unsigned long now = millis();

    if (pendingMove) {
        if (!positionKnown && now < holdOffUntilMs) {
            return; // let boot settle before the servo's first pulse
        }
        pendingMove = false;
        busy = true; // re-assert in case a web request raced with the settle step below
        if (!positionKnown) {
            // Where the horn is after boot is unknown, so the first pulse is
            // necessarily a jump. (M4: start from the last saved angle instead.)
            Serial.printf("Pen: first move after boot, going straight to %d deg\n", (int)targetAngle);
            currentAngle = targetAngle;
            writeAngle(targetAngle);
            positionKnown = true;
        }
        lastUpdateMs = now;
        settleUntilMs = 0;
        ramping = true;
    }

    if (ramping) {
        int target = targetAngle;
        double maxStep = settings.speedDegPerSec * (now - lastUpdateMs) / 1000.0;
        lastUpdateMs = now;
        double delta = target - currentAngle;
        if (fabs(delta) <= maxStep) {
            currentAngle = target;
        } else if (maxStep > 0) {
            currentAngle += delta > 0 ? maxStep : -maxStep;
        }
        writeAngle((int)round(currentAngle));
        if (currentAngle == target) {
            ramping = false;
            settleUntilMs = now + SETTLE_MS;
        }
        return;
    }

    if (busy && now >= settleUntilMs) {
        busy = false;
    }
}

}
