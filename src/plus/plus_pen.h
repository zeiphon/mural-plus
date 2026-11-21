#ifndef PlusPen_h
#define PlusPen_h
#include <ESP32Servo.h>

namespace plus {

constexpr int SERVO_PIN = 21; // same as upstream's Pen

// Pen/servo settings. Angles are raw servo degrees; lower = towards the wall.
// The defaults reproduce upstream: up at 90°, ramped at 90°/s.
struct PenSettings {
    int upAngle = 90;
    int downAngle = -1;         // -1 = not calibrated
    int minAngle = 0;           // soft limits: nothing commands the servo outside these
    int maxAngle = 180;
    int speedDegPerSec = 90;
};

// Non-blocking, ramped servo control, ported from v1.1-plus. Call update()
// from loop(). Every move is ramped at speedDegPerSec and clamped to the soft
// limits. moveTo/up/down may be called from the web server task.
//
// A hobby servo gives no feedback: everything here is what was *commanded*,
// not where the horn physically is.
class PlusPen {
    public:
    enum class Position { Unknown, Up, Down, Other };

    PlusPen();
    void update();

    void moveTo(int angle);     // ramped, clamped; the pen is then neither up nor down
    void up();
    void down();                // ignored until calibrated

    bool isMoving() { return busy; }
    bool isUp() { return position == Position::Up && !busy; }
    bool isDown() { return position == Position::Down; }  // down or on its way down
    bool isCalibrated() { return settings.downAngle >= 0; }

    // Pen calibration: the angle at which the pen touches the wall.
    void setDownAngle(int angle);
    const PenSettings &getSettings() { return settings; }
    int getTargetAngle() { return targetAngle; }

    private:
    Servo *servo;
    PenSettings settings;

    volatile int targetAngle;           // written from the web task, read in update()
    volatile bool pendingMove = false;  // a new target was requested
    volatile bool busy = false;         // move requested, ramping or settling
    volatile Position position = Position::Unknown;

    double currentAngle;                // last commanded angle (ramped)
    bool positionKnown = false;         // false until the first pulse after boot
    bool attached = false;
    bool ramping = false;
    unsigned long lastUpdateMs = 0;
    unsigned long settleUntilMs = 0;

    // Wait a moment after boot so the first pulse doesn't coincide with WiFi
    // start-up and the stepper drivers energising.
    static const unsigned long BOOT_HOLDOFF_MS = 2000;
    static const unsigned long SETTLE_MS = 200;  // same as upstream's settle delay
    unsigned long holdOffUntilMs = 0;

    int clamp(int angle);
    void setTarget(int angle, Position newPosition);
    void writeAngle(int angle);
};

}

#endif
