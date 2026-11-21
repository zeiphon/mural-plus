#include "plus_pen.h"
#include <Arduino.h>
#include "persist.h"

namespace plus {

PlusPen::PlusPen(const PenSettings &initial) {
    servo = new Servo();
    settings = initial;
    // Don't attach yet: ESP32Servo sends no pulses until attached, so the servo
    // stays where it is until the first update() after the hold-off. Head for "up".
    targetAngle = clamp(settings.upAngle);
    currentAngle = targetAngle;
    position = Position::Up;
    pendingMove = true;
    busy = true;
    holdOffUntilMs = millis() + BOOT_HOLDOFF_MS;
    Serial.printf("Pen: up=%d down=%d limits=%d..%d speed=%d deg/s releaseWhenUp=%d\n",
                  settings.upAngle, settings.downAngle, settings.minAngle, settings.maxAngle,
                  settings.speedDegPerSec, settings.releaseWhenUp);
}

int PlusPen::clamp(int angle) {
    if (angle < settings.minAngle) return settings.minAngle;
    if (angle > settings.maxAngle) return settings.maxAngle;
    return angle;
}

int PlusPen::towardsWall() {
    // Worked out from the calibration where possible; on v2 it's lower angles.
    if (isCalibrated() && settings.downAngle > settings.upAngle) {
        return 1;
    }
    return -1;
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

int PlusPen::getUpAngle() {
    int requested = requestedUp.load();
    return requested >= 0 ? requested : settings.upAngle;
}

int PlusPen::getDownAngle() {
    int requested = requestedDown.load();
    return requested >= 0 ? requested : settings.downAngle;
}

int PlusPen::adjust(Which which, int steps) {
    int wall = towardsWall();
    if (which == Which::Down) {
        if (!isCalibrated()) {
            return -1;
        }
        int base = getDownAngle();
        int up = getUpAngle();
        int next = clamp(base + wall * steps); // positive = firmer = towards the wall
        // Stay on the wall side of the up angle.
        if (wall < 0 && next >= up) next = base < up - 1 ? up - 1 : base;
        if (wall > 0 && next <= up) next = base > up + 1 ? up + 1 : base;
        if (next != base) requestedDown.store(next);
        return next;
    }

    int base = getUpAngle();
    int next = clamp(base - wall * steps); // positive = further from the wall
    if (isCalibrated()) {
        int down = getDownAngle();
        // Stay on the far side of the down angle.
        if (wall < 0 && next <= down) next = base > down + 1 ? down + 1 : base;
        if (wall > 0 && next >= down) next = base < down - 1 ? down - 1 : base;
    }
    if (next != base) requestedUp.store(next);
    return next;
}

// Main loop only.
void PlusPen::applyRequestedAngles() {
    int up = requestedUp.exchange(-1);
    if (up >= 0 && up != settings.upAngle) {
        if (upBaseline < 0) upBaseline = settings.upAngle;
        Serial.printf("Pen: up angle %d -> %d deg\n", settings.upAngle, up);
        settings.upAngle = up;
        if (position == Position::Up) {
            setTarget(up, Position::Up);
        }
    }
    int down = requestedDown.exchange(-1);
    if (down >= 0 && down != settings.downAngle) {
        if (downBaseline < 0) downBaseline = settings.downAngle;
        Serial.printf("Pen: down angle %d -> %d deg\n", settings.downAngle, down);
        settings.downAngle = down;
        if (position == Position::Down) {
            setTarget(down, Position::Down);
        }
    }
}

void PlusPen::save() {
    persist.savePenSettings(settings);
    upBaseline = -1;
    downBaseline = -1;
}

void PlusPen::saveAdjustments() {
    applyRequestedAngles();
    if (upBaseline >= 0 || downBaseline >= 0) {
        save();
        Serial.printf("Pen: adjusted angles saved (up %d, down %d deg)\n", settings.upAngle, settings.downAngle);
    }
}

void PlusPen::setDownAngle(int angle) {
    requestedDown.store(-1); // a calibration replaces any adjustment
    settings.downAngle = clamp(angle);
    if (settings.downAngle == settings.upAngle) {
        Serial.printf("Pen: warning, down angle %d is the same as the up angle\n", settings.downAngle);
    }
    save();
    Serial.printf("Pen: down angle calibrated to %d deg\n", settings.downAngle);
}

void PlusPen::clearCalibration() {
    requestedDown.store(-1);
    settings.downAngle = -1;
    save();
    up();
    Serial.println("Pen: calibration reset");
}

void PlusPen::applySettings(const PenSettings &newSettings) {
    PenSettings s = newSettings;
    s.minAngle = constrain(s.minAngle, 0, 180);
    s.maxAngle = constrain(s.maxAngle, s.minAngle, 180);
    s.speedDegPerSec = constrain(s.speedDegPerSec, 5, 600);
    requestedUp.store(-1);
    requestedDown.store(-1);
    settings = s;
    settings.upAngle = clamp(settings.upAngle);
    if (settings.downAngle >= 0) {
        settings.downAngle = clamp(settings.downAngle);
    }
    save();
    Serial.printf("Pen settings saved: up=%d down=%d limits=%d..%d speed=%d releaseWhenUp=%d\n",
                  settings.upAngle, settings.downAngle, settings.minAngle, settings.maxAngle,
                  settings.speedDegPerSec, settings.releaseWhenUp);
    // Follow the new angles, and keep the servo inside the (possibly narrower) limits.
    if (position == Position::Up) {
        up();
    } else if (position == Position::Down && isCalibrated()) {
        down();
    } else if (targetAngle != clamp(targetAngle)) {
        moveTo(targetAngle);
    }
}

void PlusPen::update() {
    unsigned long now = millis();

    applyRequestedAngles();

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
        writeAngle((int)round(currentAngle)); // re-attaches if the servo was released
        if (currentAngle == target) {
            ramping = false;
            settleUntilMs = now + SETTLE_MS;
        }
        return;
    }

    if (busy && now >= settleUntilMs) {
        busy = false;
        if (settings.releaseWhenUp && position == Position::Up && attached) {
            servo->detach();
            attached = false;
        }
    }
}

}
