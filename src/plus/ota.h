#ifndef PlusOta_h
#define PlusOta_h
#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <esp_partition.h>
#include <functional>
#include <mbedtls/sha256.h>

namespace plus {

// Firmware and web UI updates from the browser (OTA_PLAN.md). Runs in both
// modes, so classic mode can be updated and rolled back too.
//
// An update uploads the UI image to the SD card, then writes the firmware to
// the spare app slot and restarts. The new firmware boots "on probation": it
// backs up the current UI to the SD card, installs the new one and confirms
// itself. If it fails, or restarts for any reason before confirming, the
// bootloader goes back to the old firmware, which restores the old UI from
// the backup.
//
// Routes:
//   GET  /ota/status      versions, slots, the last update's result
//   POST /ota/ui          ?size=&sha256= (optional), multipart file: stage a UI image on the SD card
//   POST /ota/firmware    ?size=&sha256=&version=&uiSha256=, multipart file: write the
//                         firmware to the spare slot, then restart to install
//   POST /ota/installUi   install the staged UI image only (recovery), then restart
//   POST /ota/dismiss     clear the last result
//   GET  /recovery        a small built-in page to upload an update or a UI image
//                         (also served at / when the web UI is missing)
class Ota {
    public:
    // Returns why updates aren't allowed right now, or nullptr.
    using BusyCheck = std::function<const char *()>;

    // Call first thing in plus::begin(), in both modes, after WiFi and the SD
    // card are up and before the web server starts. Finishes or rolls back an
    // update in progress. May restart the board.
    void beginBoot();

    // Marks a new firmware as good once it's up: after the web server starts in
    // plus mode, or before handing over to upstream in classic mode.
    void confirm();

    void registerRoutes(AsyncWebServer *server, BusyCheck busy);

    // No web UI in LittleFS: / serves the recovery page instead.
    bool isUiMissing() const { return uiMissing; }

    private:
    enum State : uint8_t { IDLE = 0, PENDING = 1, INSTALLING_UI = 2, UI_INSTALLED = 3, UI_ONLY = 4 };
    enum Result : uint8_t { NO_RESULT = 0, UPDATED = 1, ROLLED_BACK = 2, UI_ONLY_INSTALLED = 3, UI_ONLY_FAILED = 4 };

    // Hex SHA-256 of a staged UI image, a backup, or a firmware upload
    using Sha = String;

    struct Upload {
        bool active = false;
        int errorCode = 0;
        String error;
        size_t expected = 0;
        size_t received = 0;
        String expectedSha;
        mbedtls_sha256_context sha;
        File file;
    };

    BusyCheck busy;
    bool needsConfirm = false;
    bool uiMissing = false;
    String uiVersion;          // from /www/version.json
    Sha stagedUiSha;           // a complete, verified UI image in UI_NEW_PATH
    size_t stagedUiSize = 0;
    Upload uiUpload;
    Upload fwUpload;
    String fwTargetVersion;

    const esp_partition_t *uiPartition();
    void readUiVersion();

    // Boot
    void newFirmwareBoot(State state);
    void oldFirmwareAfterRollback(State state);
    void installUiOnly();
    bool backupUi(String &error);
    bool writeUiPartition(const char *path, const Sha &expected, String &error);
    [[noreturn]] void failAndRollBack(const String &reason, bool uiTouched);
    void finish(Result result, const String &reason);

    // Routes
    void handleStatus(AsyncWebServerRequest *request);
    void handleUiUpload(AsyncWebServerRequest *request, size_t index, uint8_t *data, size_t len, bool final);
    void handleUiDone(AsyncWebServerRequest *request);
    void handleFirmwareUpload(AsyncWebServerRequest *request, size_t index, uint8_t *data, size_t len, bool final);
    void handleFirmwareDone(AsyncWebServerRequest *request);
    void handleInstallUi(AsyncWebServerRequest *request);
    void handleDismiss(AsyncWebServerRequest *request);
    bool startUpload(Upload &upload, AsyncWebServerRequest *request, bool shaRequired);
    void failUpload(Upload &upload, int code, const String &error);
    Sha finishSha(Upload &upload);
};

extern Ota ota;

}

#endif
