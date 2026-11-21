#include "movement_access.h"

namespace plus {

DriverStatus MovementAccess::readDriver(Movement *movement, bool left) {
    TMC2209Stepper *driver = left ? movement->leftDriver : movement->rightDriver;
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
    AccelStepper *motor = left ? movement->leftMotor : movement->rightMotor;
    StepperStatus s;
    s.position = motor->currentPosition();
    s.distanceToGo = motor->distanceToGo();
    s.speed = motor->speed();
    return s;
}

void MovementAccess::clearDriverFlags(Movement *movement) {
    movement->leftDriver->GSTAT(0b111);
    movement->rightDriver->GSTAT(0b111);
}

}
