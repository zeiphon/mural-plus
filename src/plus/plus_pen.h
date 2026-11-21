#ifndef PlusPen_h
#define PlusPen_h
#include <ESP32Servo.h>
#include <atomic>

namespace plus {

constexpr int SERVO_PIN = 21; // same as upstream's Pen

// Pen/servo settings. Angles are raw servo degrees; on v2, lower = towards the
// wall. Up is 80°, lower than upstream's 90°, where the rack-and-pinion pen
// holder can bind. Ramped at 90°/s like upstream.
struct PenSettings {
    int upAngle = 80;
    int downAngle = -1;         // -1 = not calibrated
    int minAngle = 0;           // soft limits: nothing commands the servo outside these
    int maxAngle = 180;
    int speedDegPerSec = 90;
    bool releaseWhenUp = false; // stop sending pulses once the pen is up (the servo goes limp)
};

// Non-blocking, ramped servo control, ported from v1.1-plus. Call update()
// from loop(). Every move is ramped at speedDegPerSec and clamped to the soft
// limits. moveTo/up/down/adjust may be called from the web server task.
//
// A hobby servo gives no feedback: everything here is what was *commanded*,
// not where the horn physically is.
class PlusPen {
    public:
    enum class Position { Unknown, Up, Down, Other };
    enum class Which { Up, Down };

    explicit PlusPen(const PenSettings &settings);
    void update();

    void moveTo(int angle);     // ramped, clamped; the pen is then neither up nor down
    void up();
    void down();                // ignored until calibrated

    bool isMoving() { return busy; }
    bool isUp() { return position == Position::Up && !busy; }
    bool isDown() { return position == Position::Down; }  // down or on its way down
    bool isCalibrated() { return settings.downAngle >= 0; }

    // Nudges the up or down angle by `steps` degrees, at any time, including while
    // drawing. Positive = firmer for the down angle, further from the wall for the
    // up angle. If the pen is in that position it moves straight away, otherwise
    // the angle is used next time. The angles stay within the soft limits and never
    // meet. Returns the new angle (unchanged if it's at a limit; -1 for the down
    // angle when not calibrated).
    int adjust(Which which, int steps);
    int getUpAngle();           // including a not-yet-applied adjustment
    int getDownAngle();
    // The angles before the adjustments made since the last save, or -1 if none.
    int getUpBaseline() { return upBaseline; }
    int getDownBaseline() { return downBaseline; }
    // Saves adjustments made since the last save. Main loop only, never while drawing.
    void saveAdjustments();

    // Pen calibration: the angle at which the pen touches the wall. Saves.
    void setDownAngle(int angle);
    // Forgets the down angle (for when the pen has been taken out), saves, and lifts the pen.
    void clearCalibration();
    // Replaces all settings (clamped), and saves. Not while drawing.
    void applySettings(const PenSettings &newSettings);
    const PenSettings &getSettings() { return settings; }
    int getTargetAngle() { return targetAngle; }

    // Diagnostics. Not while drawing.
    void release();                     // stop the pulses (the servo goes limp); the next move re-attaches
    void startCycleTest(int cycles);    // lower and lift `cycles` times; needs a calibration
    void stopTest();
    int getCycleRemaining() { return cycleRemaining.load(); }

    // Readouts for the Diagnostics page (what was commanded, not measured)
    bool isAttached() { return attached; }
    bool isPositionKnown() { return positionKnown; }
    int getCurrentAngle() { return (int)round(currentAngle); }
    int getPulseWidthUs() { return attached ? servo->readMicroseconds() : 0; }
    const char *positionName();
    unsigned long getMoveCount() { return moveCount; }
    int getLastMoveFrom() { return lastMoveFrom; }
    int getLastMoveTo() { return lastMoveTo; }
    unsigned long getLastMoveMs() { return lastMoveMs; }

    private:
    Servo *servo;
    PenSettings settings;

    volatile int targetAngle;           // written from the web task, read in update()
    volatile bool pendingMove = false;  // a new target was requested
    volatile bool busy = false;         // move requested, ramping or settling
    volatile Position position = Position::Unknown;

    // Adjustments requested from the web task, applied in update() (-1 = none)
    std::atomic<int> requestedUp{-1};
    std::atomic<int> requestedDown{-1};
    int upBaseline = -1;
    int downBaseline = -1;

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

    // Diagnostics
    std::atomic<bool> releaseRequested{false};
    std::atomic<int> cycleRemaining{0};  // moves left in a cycle test
    bool moveInProgress = false;
    int moveFromAngle = -1;
    unsigned long moveStartMs = 0;
    volatile unsigned long moveCount = 0; // finished moves since boot
    volatile int lastMoveFrom = -1;
    volatile int lastMoveTo = -1;
    volatile unsigned long lastMoveMs = 0; // including the settle time

    int clamp(int angle);
    int towardsWall();                  // -1 if lower angles are towards the wall
    void setTarget(int angle, Position newPosition);
    void writeAngle(int angle);
    void applyRequestedAngles();
    void save();
};

}

#endif
