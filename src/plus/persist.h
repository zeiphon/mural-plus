#ifndef PlusPersist_h
#define PlusPersist_h
#include <Preferences.h>
#include "plus_pen.h"

namespace plus {

// Plus settings in NVS, namespace "muralplus" (upstream uses "mural", so the
// keys can't clash). Writing to flash stalls the stepping loop, so nothing
// here may be called while drawing. The belt position isn't saved: with the
// power off, the motors let go and Mural slides down the wall.
class Persist {
    public:
    void begin();

    PenSettings loadPenSettings();
    void savePenSettings(const PenSettings &settings);

    // Keep the web UI running while drawing (on by default). Off restores
    // upstream's behaviour of stopping the server during a drawing.
    bool getWebWhileDrawing() { return webWhileDrawing; }
    void setWebWhileDrawing(bool enabled);

    // The hanger distance (mm), or -1 if none has been set.
    int getTopDistance() { return topDistance; }
    void setTopDistance(int mm);

    // The drawing on the SD card: the hanger distance it was made for, and its
    // size, to check at boot that it's still the same file. -1 / 0 if none.
    int getDrawingTopDistance() { return drawingTopDistance; }
    uint32_t getDrawingSize() { return drawingSize; }
    void setDrawing(int topDistanceMm, uint32_t size);
    void clearDrawing();

    private:
    Preferences prefs;
    bool webWhileDrawing = true;
    int topDistance = -1;
    int drawingTopDistance = -1;
    uint32_t drawingSize = 0;
};

extern Persist persist;

}

#endif
