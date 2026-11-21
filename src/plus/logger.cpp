#include "logger.h"
#include <esp_attr.h>
#include <stdarg.h>

namespace plus {

EventLog Log;

namespace {
    constexpr size_t CAPACITY = 8192;
    constexpr uint32_t MAGIC = 0x4D4C4F47; // "MLOG"

    // Not cleared by a software restart (see logger.h). Checked by begin().
    struct Ring {
        uint32_t magic;
        uint32_t head;      // next write position
        uint32_t wrapped;   // the buffer has been filled at least once
        uint32_t atLineStart;
        char buffer[CAPACITY];
    };
    __NOINIT_ATTR Ring ring;
    bool ready = false;
}

void EventLog::begin(const char *reason, bool keepPrevious) {
    portENTER_CRITICAL(&mux);
    bool valid = ring.magic == MAGIC && ring.head < CAPACITY && ring.wrapped <= 1 && ring.atLineStart <= 1;
    if (!keepPrevious || !valid) {
        ring.magic = MAGIC;
        ring.head = 0;
        ring.wrapped = 0;
        ring.atLineStart = 1;
        keepPrevious = false;
    }
    ready = true;
    portEXIT_CRITICAL(&mux);

    if (keepPrevious) {
        // Each boot starts its timestamps from zero again, so mark the join.
        if (!ring.atLineStart) {
            append((const uint8_t *)"\n", 1);
        }
        char marker[96];
        int n = snprintf(marker, sizeof(marker), "===== Restarted: %s =====\n", reason);
        append((const uint8_t *)marker, n);
    }
}

void EventLog::putChar(char c) {
    ring.buffer[ring.head] = c;
    ring.head = (ring.head + 1) % CAPACITY;
    if (ring.head == 0) {
        ring.wrapped = 1;
    }
}

void EventLog::putTimestamp() {
    char stamp[16];
    unsigned long ms = millis();
    int n = snprintf(stamp, sizeof(stamp), "[%6lu.%03lu] ", ms / 1000, ms % 1000);
    for (int i = 0; i < n; i++) {
        putChar(stamp[i]);
    }
}

void EventLog::append(const uint8_t *data, size_t size) {
    if (!ready) {
        return; // before begin(), the ring may hold garbage
    }
    portENTER_CRITICAL(&mux);
    for (size_t i = 0; i < size; i++) {
        char c = (char)data[i];
        if (c == '\r') {
            continue;
        }
        if (ring.atLineStart) {
            putTimestamp();
            ring.atLineStart = 0;
        }
        putChar(c);
        if (c == '\n') {
            ring.atLineStart = 1;
        }
    }
    portEXIT_CRITICAL(&mux);
}

size_t EventLog::write(uint8_t c) {
    return write(&c, 1);
}

size_t EventLog::write(const uint8_t *data, size_t size) {
    Serial.write(data, size);
    append(data, size);
    return size;
}

void EventLog::note(const char *format, ...) {
    char line[128];
    va_list args;
    va_start(args, format);
    int n = vsnprintf(line, sizeof(line), format, args);
    va_end(args);
    if (n > 0) {
        append((const uint8_t *)line, n < (int)sizeof(line) ? n : sizeof(line) - 1);
    }
}

String EventLog::dump() {
    // Copy out under the lock, and build the String outside it (no allocation in a critical section).
    char *copy = (char *)malloc(CAPACITY + 1);
    if (!copy) {
        return String("(not enough memory to read the log)");
    }

    size_t length = 0;
    bool skipPartialLine = false;
    portENTER_CRITICAL(&mux);
    if (ready) {
        if (ring.wrapped) {
            size_t tail = CAPACITY - ring.head;
            memcpy(copy, ring.buffer + ring.head, tail);
            memcpy(copy + tail, ring.buffer, ring.head);
            length = CAPACITY;
            skipPartialLine = true;
        } else {
            memcpy(copy, ring.buffer, ring.head);
            length = ring.head;
        }
    }
    portEXIT_CRITICAL(&mux);

    copy[length] = '\0';
    // A NUL kept from a crash would cut the String short.
    for (size_t i = 0; i < length; i++) {
        if (copy[i] == '\0') copy[i] = '?';
    }
    char *start = copy;
    if (skipPartialLine) {
        // The oldest line was partly overwritten, so start from the next full one.
        char *newline = strchr(copy, '\n');
        if (newline) {
            start = newline + 1;
        }
    }
    String result(start);
    free(copy);
    return result;
}

}
