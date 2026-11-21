#ifndef PlusPersist_h
#define PlusPersist_h
#include <Preferences.h>
#include "plus_pen.h"

namespace plus {

// Plus settings in NVS, namespace "muralplus" (upstream uses "mural", so the
// keys can't clash). Writing to flash stalls the stepping loop, so nothing
// here may be called while drawing. M4 adds the hanger distance, the drawing
// and the belt position.
class Persist {
    public:
    void begin();

    PenSettings loadPenSettings();
    void savePenSettings(const PenSettings &settings);

    // Keep the web UI running while drawing (on by default). Off restores
    // upstream's behaviour of stopping the server during a drawing.
    bool getWebWhileDrawing() { return webWhileDrawing; }
    void setWebWhileDrawing(bool enabled);

    private:
    Preferences prefs;
    bool webWhileDrawing = true;
};

extern Persist persist;

}

#endif
