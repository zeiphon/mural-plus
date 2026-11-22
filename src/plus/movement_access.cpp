#include "movement_access.h"

namespace plus {

// Movement keeps its drivers and steppers private, and upstream has no reason
// to expose them. Rather than carry an edit to movement.h, this uses the one
// standard C++ rule that ignores access: an explicit template instantiation
// may name private members ([temp.explicit]). Each Steal<> instantiation
// defines a free get() returning a pointer to one member. If upstream renames
// or retypes a member, this file stops compiling; nothing breaks silently.
namespace {

template <typename Tag, typename Tag::type Member>
struct Steal {
    friend typename Tag::type get(Tag) { return Member; }
};

struct LeftDriver { using type = TMC2209Stepper *Movement::*; friend type get(LeftDriver); };
struct RightDriver { using type = TMC2209Stepper *Movement::*; friend type get(RightDriver); };
struct LeftMotor { using type = AccelStepper *Movement::*; friend type get(LeftMotor); };
struct RightMotor { using type = AccelStepper *Movement::*; friend type get(RightMotor); };

template struct Steal<LeftDriver, &Movement::leftDriver>;
template struct Steal<RightDriver, &Movement::rightDriver>;
template struct Steal<LeftMotor, &Movement::leftMotor>;
template struct Steal<RightMotor, &Movement::rightMotor>;

TMC2209Stepper *driverOf(Movement *movement, bool left) {
    return left ? movement->*get(LeftDriver()) : movement->*get(RightDriver());
}

AccelStepper *motorOf(Movement *movement, bool left) {
    return left ? movement->*get(LeftMotor()) : movement->*get(RightMotor());
}

}

DriverStatus MovementAccess::readDriver(Movement *movement, bool left) {
    TMC2209Stepper *driver = driverOf(movement, left);
    DriverStatus s;
    s.ioin = driver->IOIN();
    bool ioinOk = !driver->CRCerror;
    s.version = (s.ioin >> 24) & 0xFF;
    s.responding = ioinOk && s.version == 0x21;
    if (!s.responding) {
        return s;
    }
    s.drvStatus = driver->DRV_STATUS();
    s.crcError |= driver->CRCerror;
    s.gstat = driver->GSTAT();
    s.crcError |= driver->CRCerror;
    s.chopconf = driver->CHOPCONF();
    s.crcError |= driver->CRCerror;
    s.rmsCurrentMa = driver->rms_current(); // from the configured IRUN, plus one CHOPCONF read
    s.crcError |= driver->CRCerror;
    s.irun = driver->irun();                // shadow register, no read
    return s;
}

StepperStatus MovementAccess::readStepper(Movement *movement, bool left) {
    AccelStepper *motor = motorOf(movement, left);
    StepperStatus s;
    s.position = motor->currentPosition();
    s.distanceToGo = motor->distanceToGo();
    s.speed = motor->speed();
    return s;
}

void MovementAccess::clearDriverFlags(Movement *movement) {
    driverOf(movement, true)->GSTAT(0b111);
    driverOf(movement, false)->GSTAT(0b111);
}

}
