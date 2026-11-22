#include "ota.h"
#include <LittleFS.h>
#include <SD.h>
#include <Preferences.h>
#include <Update.h>
#include <esp_ota_ops.h>
#include <errno.h>
#include "ArduinoJson.h"
#include "logger.h"
#include "restart.h"
#include "version.h"
#include "recovery_page.h"

// Arduino confirms a new firmware as soon as it boots (esp32-hal-misc.c). This
// keeps it on probation instead, until Ota::confirm(): if it restarts before
// then, for any reason, the bootloader goes back to the previous firmware.
extern "C" bool verifyRollbackLater() {
    return true;
}

namespace plus {

Ota ota;

namespace {
    constexpr const char *NAMESPACE = "muralota";
    constexpr const char *OTA_DIR = "/ota";
    constexpr const char *UI_NEW_PATH = "/ota/ui-new.bin";
    constexpr const char *UI_BACKUP_PATH = "/ota/ui-backup.bin";
    constexpr size_t CHUNK = 4096; // flash sector

    Preferences prefs;

    // Preferences and SD log an error for a missing key or file, which is
    // normal here (no update yet, nothing staged).
    String getText(const char *key, const char *fallback) {
        return prefs.isKey(key) ? prefs.getString(key, fallback) : String(fallback);
    }

    void removeFile(const char *path) {
        if (SD.exists(path)) {
            SD.remove(path);
        }
    }

    // The SD card now and then refuses a write, early in a new file (about one
    // upload in three on the test board, 2026-11-22). After an error FatFs
    // refuses everything on that open file, so reopen it at the same position
    // and try again.
    constexpr int SD_ATTEMPTS = 3;

    String toHex(const uint8_t *bytes, size_t len);

    bool reopenAt(File &f, const char *path, const char *mode, size_t offset) {
        f.close();
        vTaskDelay(pdMS_TO_TICKS(20));
        f = SD.open(path, mode);
        return f && f.seek(offset);
    }

    bool writeAt(File &f, const char *path, size_t offset, const uint8_t *data, size_t len) {
        for (int attempt = 1;; attempt++) {
            errno = 0;
            if (f && f.write(data, len) == len) {
                return true;
            }
            Log.printf("OTA: SD write of %u bytes at %u failed (errno %d)%s\n", (unsigned)len, (unsigned)offset, errno,
                attempt < SD_ATTEMPTS ? ", retrying" : "");
            if (attempt >= SD_ATTEMPTS || !reopenAt(f, path, "r+", offset)) {
                return false;
            }
        }
    }

    bool readAt(File &f, const char *path, size_t offset, uint8_t *data, size_t len) {
        for (int attempt = 1;; attempt++) {
            errno = 0;
            if (f && f.read(data, len) == len) {
                return true;
            }
            Log.printf("OTA: SD read of %u bytes at %u failed (errno %d)%s\n", (unsigned)len, (unsigned)offset, errno,
                attempt < SD_ATTEMPTS ? ", retrying" : "");
            if (attempt >= SD_ATTEMPTS || !reopenAt(f, path, "r", offset)) {
                return false;
            }
        }
    }

    // SHA-256 of a file on the SD card, or "" if it can't be read.
    String shaOfFile(const char *path, size_t size) {
        File f = SD.open(path, "r");
        if (!f || f.size() != size) {
            return "";
        }
        uint8_t *buf = (uint8_t *)malloc(4096);
        if (!buf) {
            return "";
        }
        mbedtls_sha256_context ctx;
        mbedtls_sha256_init(&ctx);
        mbedtls_sha256_starts_ret(&ctx, 0);
        bool ok = true;
        for (size_t off = 0; off < size && ok; off += 4096) {
            size_t n = size - off < 4096 ? size - off : 4096;
            ok = readAt(f, path, off, buf, n);
            mbedtls_sha256_update_ret(&ctx, buf, n);
        }
        uint8_t hash[32];
        mbedtls_sha256_finish_ret(&ctx, hash);
        mbedtls_sha256_free(&ctx);
        free(buf);
        f.close();
        return ok ? toHex(hash, sizeof(hash)) : "";
    }

    String toHex(const uint8_t *bytes, size_t len) {
        static const char digits[] = "0123456789abcdef";
        String out;
        out.reserve(len * 2);
        for (size_t i = 0; i < len; i++) {
            out += digits[bytes[i] >> 4];
            out += digits[bytes[i] & 0x0F];
        }
        return out;
    }

    String shaOfPartition(const esp_partition_t *part, uint8_t *buf) {
        mbedtls_sha256_context ctx;
        mbedtls_sha256_init(&ctx);
        mbedtls_sha256_starts_ret(&ctx, 0);
        for (size_t off = 0; off < part->size; off += CHUNK) {
            if (esp_partition_read(part, off, buf, CHUNK) != ESP_OK) {
                mbedtls_sha256_free(&ctx);
                return "";
            }
            mbedtls_sha256_update_ret(&ctx, buf, CHUNK);
        }
        uint8_t hash[32];
        mbedtls_sha256_finish_ret(&ctx, hash);
        mbedtls_sha256_free(&ctx);
        return toHex(hash, sizeof(hash));
    }

    // Serves the recovery page at / while the web UI is missing, so the page
    // can still be reached after a failed UI install or an erased partition.
    class RecoveryHandler : public AsyncWebHandler {
        public:
        explicit RecoveryHandler(const Ota *ota) : ota(ota) {}
        bool canHandle(AsyncWebServerRequest *request) const override {
            return request->method() == HTTP_GET && request->url() == "/" && ota->isUiMissing();
        }
        void handleRequest(AsyncWebServerRequest *request) override {
            request->send(200, "text/html", RECOVERY_PAGE);
        }
        private:
        const Ota *ota;
    };

    const char *resultName(uint8_t result) {
        switch (result) {
            case 1: return "updated";
            case 2: return "rolled-back";
            case 3: return "ui-installed";
            case 4: return "ui-failed";
            default: return nullptr;
        }
    }
}

const esp_partition_t *Ota::uiPartition() {
    return esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_SPIFFS, nullptr);
}

void Ota::readUiVersion() {
    uiVersion = "";
    uiMissing = !LittleFS.exists("/www/index.html.gz") && !LittleFS.exists("/www/index.html");
    File f = LittleFS.open("/www/version.json", "r");
    if (!f) {
        return;
    }
    String text = f.readString();
    f.close();
    DynamicJsonBuffer jsonBuffer;
    JsonObject &root = jsonBuffer.parseObject(text);
    if (root.success()) {
        uiVersion = root["version"] | "";
    }
}

// ---------------------------------------------------------------------------
// Boot

void Ota::beginBoot() {
    prefs.begin(NAMESPACE, false);
    const esp_partition_t *running = esp_ota_get_running_partition();
    esp_ota_img_states_t imgState;
    bool onProbation = esp_ota_get_state_partition(running, &imgState) == ESP_OK
        && imgState == ESP_OTA_IMG_PENDING_VERIFY;
    State state = (State)prefs.getUChar("state", IDLE);
    bool fromHere = getText("fromSlot", "") == running->label;

    if (state == PENDING || state == INSTALLING_UI || state == UI_INSTALLED) {
        if (onProbation && !fromHere) {
            newFirmwareBoot(state); // returns only if it succeeded; confirm() follows
        } else if (fromHere) {
            oldFirmwareAfterRollback(state);
        } else {
            // A different firmware is running, but not on probation: a USB install replaced it.
            Log.println("OTA: clearing an update that a USB install replaced");
            prefs.putUChar("state", IDLE);
        }
    } else if (state == UI_ONLY) {
        installUiOnly();
    }

    if (onProbation && !needsConfirm) {
        // On probation, but not from one of our updates: don't let a later restart roll it back.
        esp_ota_mark_app_valid_cancel_rollback();
    }
    if (prefs.getUChar("state", IDLE) == IDLE) {
        removeFile(UI_NEW_PATH); // an abandoned upload. The backup stays until the next update starts.
    }
    readUiVersion();
    Log.printf("Firmware slot %s, web UI %s\n", running->label,
        uiMissing ? "missing (recovery page at /)" : uiVersion.length() ? uiVersion.c_str() : "version unknown");
}

void Ota::newFirmwareBoot(State state) {
    Log.printf("OTA: first boot of %s, updated from %s\n", MURAL_FW_VERSION, getText("from", "?").c_str());
    if (state == PENDING) {
        String error;
        if (!backupUi(error)) {
            failAndRollBack("Couldn't back up the current web UI: " + error, false);
        }
        prefs.putUChar("state", INSTALLING_UI);
        state = INSTALLING_UI;
    }
    if (state == INSTALLING_UI) {
        Log.println("OTA: installing the new web UI");
        LittleFS.end();
        String error;
        if (!writeUiPartition(UI_NEW_PATH, getText("uiSha", ""), error)) {
            failAndRollBack("Couldn't install the new web UI: " + error, true);
        }
        if (!LittleFS.begin(false)) {
            failAndRollBack("The new web UI image can't be read", true);
        }
        readUiVersion();
        if (uiVersion != MURAL_FW_VERSION) {
            failAndRollBack("The new web UI is version " + (uiVersion.length() ? uiVersion : String("unknown"))
                + ", but the firmware is " + MURAL_FW_VERSION, true);
        }
        prefs.putUChar("state", UI_INSTALLED);
    }
    needsConfirm = true;
}

void Ota::confirm() {
    if (!needsConfirm) {
        return;
    }
    needsConfirm = false;
    esp_ota_mark_app_valid_cancel_rollback();
    finish(UPDATED, "");
    Log.printf("OTA: update to %s complete\n", MURAL_FW_VERSION);
}

// Runs on the old firmware when the new one didn't confirm itself. The new
// firmware may have stopped partway through writing the UI, so put the backup back.
void Ota::oldFirmwareAfterRollback(State state) {
    String reason = "The new firmware restarted before it had finished starting up. "
                    "This can be a power cut, a crash, or no WiFi connection";
    Log.printf("OTA: back on %s, the update to %s didn't complete\n", MURAL_FW_VERSION, getText("to", "?").c_str());
    if (state == INSTALLING_UI || state == UI_INSTALLED) {
        LittleFS.end();
        String error;
        if (writeUiPartition(UI_BACKUP_PATH, getText("bakSha", ""), error)) {
            Log.println("OTA: restored the previous web UI");
        } else {
            Log.printf("OTA: couldn't restore the previous web UI: %s\n", error.c_str());
            reason += ". Restoring the previous web UI also failed (" + error + "), so upload it from the recovery page";
        }
        LittleFS.begin(true);
    }
    finish(ROLLED_BACK, reason);
}

void Ota::failAndRollBack(const String &reason, bool uiTouched) {
    Log.printf("OTA: %s. Going back to %s\n", reason.c_str(), getText("from", "the previous firmware").c_str());
    String fullReason = reason;
    if (uiTouched) {
        LittleFS.end();
        String error;
        if (!writeUiPartition(UI_BACKUP_PATH, getText("bakSha", ""), error)) {
            Log.printf("OTA: couldn't restore the previous web UI: %s\n", error.c_str());
            fullReason += ". Restoring the previous web UI also failed (" + error + "), so upload it from the recovery page";
        }
    }
    finish(ROLLED_BACK, fullReason);
    keepHotspotAcrossRestart();
    esp_ota_mark_app_invalid_rollback_and_reboot();
    esp_restart(); // only reached if there's no other firmware to go back to
}

void Ota::installUiOnly() {
    Log.println("OTA: installing the uploaded web UI");
    LittleFS.end();
    String error;
    bool ok = writeUiPartition(UI_NEW_PATH, getText("uiSha", ""), error);
    LittleFS.begin(true);
    readUiVersion();
    prefs.putString("to", uiVersion);
    prefs.putString("from", MURAL_FW_VERSION);
    if (ok) {
        Log.printf("OTA: web UI %s installed\n", uiVersion.c_str());
    } else {
        Log.printf("OTA: web UI install failed: %s\n", error.c_str());
    }
    finish(ok ? UI_ONLY_INSTALLED : UI_ONLY_FAILED, error);
}

void Ota::finish(Result result, const String &reason) {
    prefs.putUChar("state", IDLE);
    prefs.putUChar("result", result);
    prefs.putString("reason", reason);
    removeFile(UI_NEW_PATH);
}

// Copies the UI partition to the SD card, once per update.
bool Ota::backupUi(String &error) {
    const esp_partition_t *part = uiPartition();
    if (!part) {
        error = "no web UI partition";
        return false;
    }
    if (getText("bakSha", "").length() && SD.exists(UI_BACKUP_PATH)) {
        return true; // already backed up for this update
    }
    SD.mkdir(OTA_DIR);
    File f = SD.open(UI_BACKUP_PATH, "w");
    if (!f) {
        error = "can't create the backup file on the SD card";
        return false;
    }
    uint8_t *buf = (uint8_t *)malloc(CHUNK);
    if (!buf) {
        f.close();
        error = "out of memory";
        return false;
    }
    mbedtls_sha256_context ctx;
    mbedtls_sha256_init(&ctx);
    mbedtls_sha256_starts_ret(&ctx, 0);
    bool ok = true;
    for (size_t off = 0; off < part->size && ok; off += CHUNK) {
        ok = esp_partition_read(part, off, buf, CHUNK) == ESP_OK && writeAt(f, UI_BACKUP_PATH, off, buf, CHUNK);
        mbedtls_sha256_update_ret(&ctx, buf, CHUNK);
        if ((off / CHUNK) % 16 == 15) {
            vTaskDelay(1);
        }
    }
    uint8_t hash[32];
    mbedtls_sha256_finish_ret(&ctx, hash);
    mbedtls_sha256_free(&ctx);
    free(buf);
    f.close();
    if (!ok) {
        error = "writing the backup to the SD card failed";
        return false;
    }
    prefs.putString("bakSha", toHex(hash, sizeof(hash)));
    Log.println("OTA: backed up the current web UI");
    return true;
}

// Writes an image from the SD card into the UI partition and checks it by
// reading it back. LittleFS must be unmounted.
bool Ota::writeUiPartition(const char *path, const String &expectedSha, String &error) {
    const esp_partition_t *part = uiPartition();
    if (!part) {
        error = "no web UI partition";
        return false;
    }
    File f = SD.open(path, "r");
    if (!f) {
        error = String(path) + " is missing from the SD card";
        return false;
    }
    if (f.size() != part->size) {
        f.close();
        error = String(path) + " is the wrong size";
        return false;
    }
    uint8_t *buf = (uint8_t *)malloc(CHUNK);
    if (!buf) {
        f.close();
        error = "out of memory";
        return false;
    }
    bool ok = true;
    for (size_t off = 0; off < part->size && ok; off += CHUNK) {
        ok = readAt(f, path, off, buf, CHUNK)
            && esp_partition_erase_range(part, off, CHUNK) == ESP_OK
            && esp_partition_write(part, off, buf, CHUNK) == ESP_OK;
        if ((off / CHUNK) % 16 == 15) {
            vTaskDelay(1);
        }
    }
    f.close();
    if (!ok) {
        free(buf);
        error = "writing the web UI partition failed";
        return false;
    }
    String written = shaOfPartition(part, buf);
    free(buf);
    if (expectedSha.length() && written != expectedSha) {
        error = "the web UI partition doesn't match the image after writing";
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Routes

void Ota::registerRoutes(AsyncWebServer *server, BusyCheck busy) {
    this->busy = busy;
    server->addHandler(new RecoveryHandler(this));
    server->on("/recovery", HTTP_GET, [](AsyncWebServerRequest *r) { r->send(200, "text/html", RECOVERY_PAGE); });
    server->on("/ota/status", HTTP_GET, [this](AsyncWebServerRequest *r) { handleStatus(r); });
    server->on("/ota/ui", HTTP_POST,
        [this](AsyncWebServerRequest *r) { handleUiDone(r); },
        [this](AsyncWebServerRequest *r, String filename, size_t index, uint8_t *data, size_t len, bool final) {
            handleUiUpload(r, index, data, len, final);
        });
    server->on("/ota/firmware", HTTP_POST,
        [this](AsyncWebServerRequest *r) { handleFirmwareDone(r); },
        [this](AsyncWebServerRequest *r, String filename, size_t index, uint8_t *data, size_t len, bool final) {
            handleFirmwareUpload(r, index, data, len, final);
        });
    server->on("/ota/installUi", HTTP_POST, [this](AsyncWebServerRequest *r) { handleInstallUi(r); });
    server->on("/ota/dismiss", HTTP_POST, [this](AsyncWebServerRequest *r) { handleDismiss(r); });
}

void Ota::handleStatus(AsyncWebServerRequest *request) {
    AsyncResponseStream *response = request->beginResponseStream("application/json");
    DynamicJsonBuffer jsonBuffer;
    JsonObject &root = jsonBuffer.createObject();
    root["product"] = MURAL_PRODUCT;
    root["firmware"] = MURAL_FW_VERSION;
    root["ui"] = uiVersion;
    root["uiMissing"] = uiMissing;
    root["slot"] = esp_ota_get_running_partition()->label;
    const esp_partition_t *next = esp_ota_get_next_update_partition(nullptr);
    root["nextSlot"] = next ? next->label : "";
    root["firmwareSlotBytes"] = next ? next->size : 0;
    const esp_partition_t *ui = uiPartition();
    root["uiPartitionBytes"] = ui ? ui->size : 0;
    const char *why = busy ? busy() : nullptr;
    if (why) {
        root["busy"] = why;
    }
    const char *result = resultName(prefs.getUChar("result", NO_RESULT));
    if (result) {
        JsonObject &r = root.createNestedObject("result");
        r["kind"] = result;
        r["from"] = getText("from", "");
        r["to"] = getText("to", "");
        r["reason"] = getText("reason", "");
    }
    root.printTo(*response);
    request->send(response);
}

bool Ota::startUpload(Upload &upload, AsyncWebServerRequest *request, bool shaRequired) {
    if (upload.active) {
        // The last upload was abandoned partway through.
        upload.file.close();
        mbedtls_sha256_free(&upload.sha);
        upload.active = false;
    }
    upload.errorCode = 0;
    upload.error = "";
    upload.received = 0;
    upload.expected = request->hasParam("size") ? strtoul(request->getParam("size")->value().c_str(), nullptr, 10) : 0;
    upload.expectedSha = request->hasParam("sha256") ? request->getParam("sha256")->value() : "";
    upload.expectedSha.toLowerCase();
    const char *why = busy ? busy() : nullptr;
    if (why) {
        failUpload(upload, 409, why);
        return false;
    }
    if (upload.expected == 0) {
        failUpload(upload, 400, "Missing size");
        return false;
    }
    if (shaRequired && upload.expectedSha.length() != 64) {
        failUpload(upload, 400, "Missing sha256");
        return false;
    }
    mbedtls_sha256_init(&upload.sha);
    mbedtls_sha256_starts_ret(&upload.sha, 0);
    upload.active = true;
    return true;
}

void Ota::failUpload(Upload &upload, int code, const String &error) {
    if (upload.errorCode == 0) {
        upload.errorCode = code;
        upload.error = error;
        Log.printf("OTA: upload failed: %s\n", error.c_str());
    }
    if (upload.active) {
        upload.file.close();
        mbedtls_sha256_free(&upload.sha);
        upload.active = false;
    }
}

Ota::Sha Ota::finishSha(Upload &upload) {
    uint8_t hash[32];
    mbedtls_sha256_finish_ret(&upload.sha, hash);
    mbedtls_sha256_free(&upload.sha);
    upload.active = false;
    return toHex(hash, sizeof(hash));
}

void Ota::failUiPiece(int code, const String &error) {
    if (uiPiece.errorCode == 0) {
        uiPiece.errorCode = code;
        uiPiece.error = error;
        Log.printf("OTA: web UI upload failed: %s\n", error.c_str());
    }
    uiPiece.file.close();
}

// Stages a UI image on the SD card, a piece per request like the drawing
// upload, so a piece the card refuses can be sent again. Offset 0 starts a new
// update: the previous staged image and backup are deleted.
void Ota::handleUiUpload(AsyncWebServerRequest *request, size_t index, uint8_t *data, size_t len, bool final) {
    if (index == 0) {
        uiPiece = UiPiece();
        uiPiece.started = true;
        const char *why = busy ? busy() : nullptr;
        if (why) {
            failUiPiece(409, why);
            return;
        }
        auto param = [request](const char *name) -> size_t {
            return request->hasParam(name) ? strtoul(request->getParam(name)->value().c_str(), nullptr, 10) : 0;
        };
        size_t total = request->hasParam("total") ? param("total") : param("size"); // size: the whole image at once
        uiPiece.offset = param("offset");
        const esp_partition_t *part = uiPartition();
        size_t partSize = part ? part->size : 0;
        if (total != partSize) {
            failUiPiece(400, "That isn't a web UI image for this board (" + String((unsigned)total)
                + " bytes, expected " + String((unsigned)partSize) + ")");
            return;
        }
        if (uiPiece.offset == 0) {
            if (Update.isRunning()) {
                Update.abort();
            }
            stagedUiSha = "";
            uiStagingTotal = 0;
            uiStagingEnd = 0;
            if (prefs.isKey("bakSha")) {
                prefs.remove("bakSha");
            }
            removeFile(UI_NEW_PATH);
            removeFile(UI_BACKUP_PATH);
            SD.mkdir(OTA_DIR);
            uint64_t freeBytes = SD.totalBytes() - SD.usedBytes();
            uint64_t needed = 2 * (uint64_t)partSize + 64 * 1024; // new image and backup
            if (freeBytes < needed) {
                failUiPiece(400, "Not enough space on the SD card: an update needs "
                    + String((unsigned)(needed / 1024)) + " KB free");
                return;
            }
            uiPiece.file = SD.open(UI_NEW_PATH, "w");
            uiStagingTotal = total;
            Log.println("OTA: receiving the web UI");
        } else {
            if (uiStagingTotal != total || uiPiece.offset > uiStagingEnd) {
                failUiPiece(409, "Upload out of order, start again");
                return;
            }
            uiPiece.file = SD.open(UI_NEW_PATH, "r+");
            if (uiPiece.file && !uiPiece.file.seek(uiPiece.offset)) {
                uiPiece.file.close();
            }
        }
        if (!uiPiece.file) {
            failUiPiece(500, "Couldn't open the update file on the SD card");
            return;
        }
    }
    if (uiPiece.errorCode) {
        return;
    }
    if (len) {
        size_t at = uiPiece.offset + uiPiece.received;
        if (at + len > uiStagingTotal) {
            failUiPiece(400, "More data than the image's size");
            return;
        }
        if (!writeAt(uiPiece.file, UI_NEW_PATH, at, data, len)) {
            failUiPiece(500, "Writing to the SD card failed at byte " + String((unsigned)at));
            return;
        }
        uiPiece.received += len;
    }
    if (final) {
        uiPiece.file.close();
        size_t end = uiPiece.offset + uiPiece.received;
        if (end > uiStagingEnd) {
            uiStagingEnd = end;
        }
        if (end == uiStagingTotal) {
            String expectedSha = request->hasParam("sha256") ? request->getParam("sha256")->value() : "";
            expectedSha.toLowerCase();
            finishUiStaging(expectedSha);
        }
    }
}

// The last piece is in: check the whole image as it is on the card.
void Ota::finishUiStaging(const String &expectedSha) {
    String sha = shaOfFile(UI_NEW_PATH, uiStagingTotal);
    if (sha.isEmpty()) {
        failUiPiece(500, "Reading the web UI image back from the SD card failed");
    } else if (expectedSha.length() && sha != expectedSha) {
        failUiPiece(400, "The web UI image was damaged in transfer");
    } else {
        stagedUiSha = sha;
        uiPiece.complete = true;
        Log.println("OTA: web UI received");
        return;
    }
    uiStagingTotal = 0;
    uiStagingEnd = 0;
    removeFile(UI_NEW_PATH);
}

// Responds with the image's SHA-256 after the last piece, or OK.
void Ota::handleUiDone(AsyncWebServerRequest *request) {
    if (uiPiece.errorCode) {
        request->send(uiPiece.errorCode, "text/plain", uiPiece.error);
    } else if (!uiPiece.started) {
        request->send(400, "text/plain", "No web UI image received");
    } else {
        request->send(200, "text/plain", uiPiece.complete ? stagedUiSha : String("OK"));
    }
    uiPiece.started = false;
}

// Writes the firmware to the spare slot. The UI image has to be staged first,
// because finishing this switches the boot slot.
void Ota::handleFirmwareUpload(AsyncWebServerRequest *request, size_t index, uint8_t *data, size_t len, bool final) {
    if (index == 0) {
        if (!startUpload(fwUpload, request, true)) {
            return;
        }
        fwTargetVersion = request->hasParam("version") ? request->getParam("version")->value() : "";
        String uiSha = request->hasParam("uiSha256") ? request->getParam("uiSha256")->value() : "";
        uiSha.toLowerCase();
        if (fwTargetVersion.isEmpty()) {
            failUpload(fwUpload, 400, "Missing version");
            return;
        }
        if (stagedUiSha.isEmpty() || uiSha != stagedUiSha) {
            failUpload(fwUpload, 409, "Upload the matching web UI first");
            return;
        }
        if (Update.isRunning()) {
            Update.abort();
        }
        if (!Update.begin(fwUpload.expected, U_FLASH)) {
            failUpload(fwUpload, 400, String("Can't start the firmware update: ") + Update.errorString());
            return;
        }
        Log.printf("OTA: receiving firmware %s\n", fwTargetVersion.c_str());
    }
    if (!fwUpload.active) {
        return;
    }
    if (len) {
        fwUpload.received += len;
        if (fwUpload.received > fwUpload.expected) {
            Update.abort();
            failUpload(fwUpload, 400, "More data than the given size");
            return;
        }
        if (Update.write(data, len) != len) {
            String error = String("Writing the firmware failed: ") + Update.errorString();
            Update.abort();
            failUpload(fwUpload, 500, error);
            return;
        }
        mbedtls_sha256_update_ret(&fwUpload.sha, data, len);
    }
    if (final) {
        Sha sha = finishSha(fwUpload);
        const char *why = busy ? busy() : nullptr;
        if (fwUpload.received != fwUpload.expected) {
            Update.abort();
            failUpload(fwUpload, 400, "The upload was incomplete");
            return;
        }
        if (sha != fwUpload.expectedSha) {
            Update.abort();
            failUpload(fwUpload, 400, "The firmware was damaged in transfer");
            return;
        }
        if (why) {
            Update.abort();
            failUpload(fwUpload, 409, why);
            return;
        }
        // Recorded before the boot slot switches, so a restart at any point
        // afterwards is picked up by beginBoot() on one firmware or the other.
        prefs.putString("to", fwTargetVersion);
        prefs.putString("from", MURAL_FW_VERSION);
        prefs.putString("fromSlot", esp_ota_get_running_partition()->label);
        prefs.putString("uiSha", stagedUiSha);
        prefs.putUChar("result", NO_RESULT);
        prefs.putString("reason", "");
        prefs.putUChar("state", PENDING);
        if (!Update.end()) {
            prefs.putUChar("state", IDLE);
            failUpload(fwUpload, 400, String("The firmware was rejected: ") + Update.errorString());
            return;
        }
        Log.printf("OTA: firmware %s written, restarting to install it\n", fwTargetVersion.c_str());
    }
}

void Ota::handleFirmwareDone(AsyncWebServerRequest *request) {
    if (fwUpload.errorCode) {
        request->send(fwUpload.errorCode, "text/plain", fwUpload.error);
        return;
    }
    if (prefs.getUChar("state", IDLE) != PENDING) {
        request->send(400, "text/plain", "No firmware received");
        return;
    }
    request->send(200, "text/plain", "Restarting");
    restartSoon();
}

// Recovery: installs the staged UI image at the next boot, keeping the firmware.
void Ota::handleInstallUi(AsyncWebServerRequest *request) {
    const char *why = busy ? busy() : nullptr;
    if (why) {
        request->send(409, "text/plain", why);
        return;
    }
    if (stagedUiSha.isEmpty()) {
        request->send(409, "text/plain", "Upload a web UI image first");
        return;
    }
    prefs.putString("uiSha", stagedUiSha);
    prefs.putUChar("result", NO_RESULT);
    prefs.putUChar("state", UI_ONLY);
    Log.println("OTA: restarting to install the uploaded web UI");
    request->send(200, "text/plain", "Restarting");
    restartSoon();
}

void Ota::handleDismiss(AsyncWebServerRequest *request) {
    prefs.putUChar("result", NO_RESULT);
    if (prefs.isKey("reason")) {
        prefs.remove("reason");
    }
    request->send(200, "text/plain", "OK");
}

}
