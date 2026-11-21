#ifndef PlusLogger_h
#define PlusLogger_h
#include <Arduino.h>

namespace plus {

// Use Log instead of Serial in plus code: everything goes to the serial port as
// before, and is also kept in a RAM ring buffer that the Diagnostics page reads
// (/log), so no USB cable is needed. Ported from v1.1-plus.
//
// The buffer lives in RAM that a software restart doesn't clear, so after a
// crash, watchdog reset or brownout the lines from before it are usually still
// there. A power cut clears it. Upstream code still prints to Serial only.
class EventLog : public Print {
    public:
    // Call once at boot, before logging. Keeps the previous contents unless the
    // board was powered on, and marks the restart with `reason`.
    void begin(const char *reason, bool keepPrevious);

    size_t write(uint8_t c) override;
    size_t write(const uint8_t *data, size_t size) override;
    using Print::write;

    // Into the buffer only, not the serial port (for the per-move drawing log,
    // where upstream already prints its own line to Serial).
    void note(const char *format, ...) __attribute__((format(printf, 2, 3)));

    // The buffered log, oldest line first.
    String dump();

    private:
    portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
    void append(const uint8_t *data, size_t size);
    void putChar(char c);
    void putTimestamp();
};

extern EventLog Log;

}

#endif
