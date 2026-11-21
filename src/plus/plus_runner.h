#ifndef PlusRunner_h
#define PlusRunner_h
#include <SD.h>
#include "movement.h"
#include "display.h"
#include "tasks/task.h"
#include "plus_pen.h"

namespace plus {

// Draws the uploaded /commands file one line at a time, ported from v1.1-plus.
// Replaces upstream's Runner in plus mode.
//
// Pause and stop are requested from the web task (flags only) and carried out
// in run(): the current <=1 mm movement increment or pen move finishes, then
// the pen is lifted. Resume lowers the pen again if it was down and carries on
// from the same point. Stop ends the drawing where the bot is, with its
// position still known. A finished drawing ends at the home position. Unlike
// upstream, nothing restarts the board.
class PlusRunner {
    public:
    enum class Outcome { None, Finished, Stopped, Failed };

    PlusRunner(Movement *movement, PlusPen *pen, Display *display);
    // Throws std::invalid_argument if the file can't be read.
    void start(int speed);
    void run();

    void requestPause();
    void requestResume();
    void requestStop();

    bool isRunning() { return !stopped; }  // true while drawing, including paused
    const char *stateName();               // idle / drawing / pausing / paused / resuming / stopping
    int getProgress() { return progress < 0 ? 0 : progress; }
    double getDistanceSoFar() { return distanceSoFar; }
    double getTotalDistance() { return totalDistance; }
    unsigned long getElapsedMs();          // drawing time, not counting pauses
    Outcome getLastOutcome() { return lastOutcome; }
    const char *lastOutcomeName();
    const char *getLastError() { return lastError; }

    private:
    Movement *movement;
    PlusPen *pen;
    Display *display;

    volatile bool stopped = true;
    File openedFile;
    int speed = 650;
    Task *currentTask = nullptr;
    Task *finishingSequence[2] = {nullptr, nullptr};  // lift the pen, then go home
    int sequenceIx = 0;
    bool parseFailed = false;

    double totalDistance = 0;
    double distanceSoFar = 0;
    Movement::Point startPosition;
    Movement::Point targetPosition;
    int progress = -1;

    volatile bool pauseRequested = false;
    volatile bool resumeRequested = false;
    volatile bool stopRequested = false;
    bool paused = false;
    bool resuming = false;   // waiting for the pen to go back down
    bool penWasDown = false;

    unsigned long startMs = 0;
    unsigned long pauseStartMs = 0;
    unsigned long pausedTotalMs = 0;
    unsigned long finishedElapsedMs = 0;
    Outcome lastOutcome = Outcome::None;
    char lastError[96] = {0};

    Task *getNextTask();
    void advance();
    void fail(const char *message);
    void finishRun(Outcome outcome);
};

}

#endif
