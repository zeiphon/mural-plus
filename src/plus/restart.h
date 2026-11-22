#ifndef PlusRestart_h
#define PlusRestart_h

namespace plus {
    // Call before any restart. If Mural is running on its own hotspot, it comes
    // back on the hotspot instead of going through the WiFi setup flow.
    void keepHotspotAcrossRestart();

    // Restarts in half a second, so the response that asked for it can still
    // be sent. Keeps the hotspot, as above.
    void restartSoon();
}

#endif
