#ifndef PlusMovementAccess_h
#define PlusMovementAccess_h
#include "movement.h"

namespace plus {

// One TMC2209's registers, each read once over UART (decoded by the UI).
struct DriverStatus {
    bool responding = false; // answered with the TMC2209 version and a good CRC
    uint8_t version = 0;     // 0x21 for a TMC2209
    bool crcError = false;   // a later read failed
    uint32_t ioin = 0;       // IOIN: pin states (bit 0 ENN: 1 = disabled)
    uint32_t drvStatus = 0;  // DRV_STATUS: temperature, shorts, open load, current scale, standstill
    uint8_t gstat = 0;       // GSTAT: bit 0 reset, 1 driver error, 2 charge pump undervoltage
    uint32_t chopconf = 0;   // CHOPCONF: microstep resolution (MRES, bits 24-27)
    uint16_t rmsCurrentMa = 0; // configured run current
    uint8_t irun = 0;        // configured current scale, to turn DRV_STATUS's CS_ACTUAL into mA
};

struct StepperStatus {
    long position = 0;      // steps
    long distanceToGo = 0;  // steps
    float speed = 0;        // steps/s
};

// Reads Movement's private drivers and steppers (friend in movement.h, a
// fork-only edit). Reading over UART takes a few ms per register; nothing else
// uses the UART after boot, and the step pins aren't touched, so it's safe
// while drawing.
class MovementAccess {
    public:
    static DriverStatus readDriver(Movement *movement, bool left);
    static StepperStatus readStepper(Movement *movement, bool left);
    // Clears the drivers' latched GSTAT flags at boot, so "reset" afterwards
    // means the driver restarted while running (and lost its settings), for
    // example when the motor supply dipped.
    static void clearDriverFlags(Movement *movement);
};

}

#endif
