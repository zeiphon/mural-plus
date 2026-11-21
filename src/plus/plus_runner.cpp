#include "plus_runner.h"
#include <stdexcept>
#include "tasks/interpolatingmovementtask.h"

namespace plus {

namespace {
    constexpr const char *COMMANDS_PATH = "/commands";

    // Non-blocking pen move: waits for the ramp to finish.
    class PlusPenTask : public Task {
        public:
        PlusPenTask(bool up, PlusPen *pen) : up(up), pen(pen) {}
        void startRunning() override {
            if (up) {
                pen->up();
            } else {
                pen->down();
            }
        }
        bool isDone() override { return !pen->isMoving(); }
        const char *name() override { return "PlusPenTask"; }

        private:
        bool up;
        PlusPen *pen;
    };

    // Reads a "<letter><number>" header line such as "d1234.5". Upstream's
    // Runner drops the last character of the number, so a whole-number
    // distance ("d12345") comes out ten times too small.
    bool readHeader(File &file, char letter, double &value) {
        String line = file.readStringUntil('\n');
        line.trim();
        if (line.length() < 2 || line.charAt(0) != letter) {
            return false;
        }
        value = line.substring(1).toDouble();
        return true;
    }
}

PlusRunner::PlusRunner(Movement *movement, PlusPen *pen, Display *display) {
    this->movement = movement;
    this->pen = pen;
    this->display = display;
}

void PlusRunner::start(int speed) {
    openedFile = SD.open(COMMANDS_PATH);
    if (!openedFile || !openedFile.available()) {
        throw std::invalid_argument("No drawing on the SD card");
    }
    double height;
    if (!readHeader(openedFile, 'd', totalDistance) || !readHeader(openedFile, 'h', height)) {
        openedFile.close();
        throw std::invalid_argument("The drawing file is damaged, choose it again");
    }

    this->speed = speed;
    distanceSoFar = 0;
    progress = -1; // so 0% shows right away
    startPosition = movement->getCoordinates();
    targetPosition = startPosition;
    finishingSequence[0] = new PlusPenTask(true, pen);
    finishingSequence[1] = new InterpolatingMovementTask(movement, movement->getHomeCoordinates(), speed);
    sequenceIx = 0;
    parseFailed = false;
    pauseRequested = resumeRequested = stopRequested = false;
    paused = resuming = penWasDown = false;
    pausedTotalMs = 0;
    lastOutcome = Outcome::None;
    lastError[0] = '\0';
    Serial.printf("Total distance to travel: %.1f mm\n", totalDistance);

    startMs = millis();
    stopped = false;
    currentTask = getNextTask();
    if (currentTask) {
        try {
            currentTask->startRunning();
        } catch (const std::exception &e) {
            fail(e.what());
        }
    } else if (!parseFailed) {
        finishRun(Outcome::Finished);
    }
}

void PlusRunner::requestPause() {
    if (!stopped && !paused) {
        resumeRequested = false;
        pauseRequested = true;
    }
}

void PlusRunner::requestResume() {
    if (!stopped && (paused || pauseRequested)) {
        resumeRequested = true;
    }
}

void PlusRunner::requestStop() {
    if (!stopped) {
        stopRequested = true;
    }
}

const char *PlusRunner::stateName() {
    if (stopped) return "idle";
    if (stopRequested) return "stopping";
    if (paused) return resumeRequested ? "resuming" : "paused";
    if (pauseRequested) return "pausing";
    if (resuming) return "resuming";
    return "drawing";
}

unsigned long PlusRunner::getElapsedMs() {
    if (stopped) {
        return finishedElapsedMs;
    }
    unsigned long now = millis();
    unsigned long pausedNow = paused ? now - pauseStartMs : 0;
    return now - startMs - pausedTotalMs - pausedNow;
}

const char *PlusRunner::lastOutcomeName() {
    switch (lastOutcome) {
        case Outcome::Finished: return "finished";
        case Outcome::Stopped:  return "stopped";
        case Outcome::Failed:   return "failed";
        default:                return "none";
    }
}

// Returns nullptr at the end, or on a line it can't read (parseFailed is set).
Task *PlusRunner::getNextTask() {
    while (openedFile.available()) {
        String line = openedFile.readStringUntil('\n');
        line.trim();
        if (line.length() == 0) {
            continue;
        }
        if (line == "p1") {
            return new PlusPenTask(false, pen);
        }
        if (line == "p0") {
            return new PlusPenTask(true, pen);
        }
        int space = line.indexOf(' ');
        char first = line.charAt(0);
        if (space > 0 && (isDigit(first) || first == '-' || first == '.')) {
            double x = line.substring(0, space).toDouble();
            double y = line.substring(space + 1).toDouble();
            targetPosition = Movement::Point(x, y);
            return new InterpolatingMovementTask(movement, targetPosition, speed);
        }
        // Unknown line: probably a newer upstream command format (see UPSTREAM.md).
        char message[96];
        snprintf(message, sizeof(message), "Unknown line in the drawing file: %.40s", line.c_str());
        parseFailed = true;
        fail(message);
        return nullptr;
    }

    if (sequenceIx < 2) {
        Task *task = finishingSequence[sequenceIx];
        finishingSequence[sequenceIx] = nullptr; // ownership passes to currentTask
        sequenceIx++;
        return task;
    }
    return nullptr;
}

void PlusRunner::fail(const char *message) {
    snprintf(lastError, sizeof(lastError), "%s", message);
    Serial.printf("Drawing failed: %s\n", message);
    finishRun(Outcome::Failed);
}

// Ends the run: frees the tasks and closes the file. The bot stays where it is.
void PlusRunner::finishRun(Outcome outcome) {
    finishedElapsedMs = getElapsedMs();
    if (currentTask) {
        delete currentTask;
        currentTask = nullptr;
    }
    for (auto &task : finishingSequence) {
        if (task) {
            delete task;
            task = nullptr;
        }
    }
    openedFile.close();
    pauseRequested = resumeRequested = stopRequested = false;
    paused = resuming = false;
    lastOutcome = outcome;
    stopped = true;

    unsigned long s = finishedElapsedMs / 1000;
    Serial.printf("Drawing %s at %d%% after %lum %lus\n", lastOutcomeName(), getProgress(), s / 60, s % 60);
}

void PlusRunner::run() {
    if (stopped) {
        return;
    }

    // Pause or stop: let the current increment or pen move finish, then lift the pen.
    if (pauseRequested || stopRequested) {
        if (!paused) {
            if (movement->isMoving() || pen->isMoving()) {
                return;
            }
            paused = true;
            pauseRequested = true;
            pauseStartMs = millis();
            penWasDown = pen->isDown();
            if (penWasDown) {
                pen->up();
            }
            Serial.printf("Drawing paused at %d%%%s\n", getProgress(), penWasDown ? " (pen lifted)" : "");
        }

        if (stopRequested) {
            if (!pen->isMoving()) {
                finishRun(Outcome::Stopped);
            }
            return;
        }

        if (!resumeRequested) {
            return; // paused
        }

        pausedTotalMs += millis() - pauseStartMs;
        paused = false;
        pauseRequested = false;
        resumeRequested = false;
        if (penWasDown) {
            pen->down();
            resuming = true;
        }
        Serial.println("Drawing resumed");
        return;
    }

    if (resuming) {
        if (pen->isMoving()) {
            return; // wait for the pen to be back on the wall
        }
        resuming = false;
    }

    try {
        advance();
    } catch (const std::exception &e) {
        // A move the kinematics rejected: the coordinates may no longer match the belts.
        fail(e.what());
    }
}

void PlusRunner::advance() {
    if (!currentTask->isDone()) {
        return;
    }
    if (currentTask->name() == InterpolatingMovementTask::NAME) {
        distanceSoFar += Movement::distanceBetweenPoints(startPosition, targetPosition);
        startPosition = targetPosition;
        int newProgress = totalDistance > 0 ? int(floor(distanceSoFar / totalDistance * 100)) : 100;
        if (newProgress > 100) {
            newProgress = 100;
        }
        if (progress != newProgress) {
            progress = newProgress;
            Serial.printf("Progress: %d%%\n", progress);
            display->showDrawing(progress);
        }
    }
    Task *done = currentTask;
    currentTask = nullptr; // so a parse failure in getNextTask() doesn't free it again
    delete done;
    Task *next = getNextTask();
    if (stopped) {
        return; // getNextTask() failed the run
    }
    currentTask = next;
    if (currentTask) {
        currentTask->startRunning();
    } else {
        finishRun(Outcome::Finished);
    }
}

}
