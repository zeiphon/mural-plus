#ifndef PlusVersion_h
#define PlusVersion_h

// Set at build time from git by scripts/fw_version.py.
#ifndef MURAL_FW_VERSION
#define MURAL_FW_VERSION "unknown"
#endif

// Identifies this firmware's update files (scripts/package_release.py), so an
// update for other hardware or another fork isn't installed by mistake.
#define MURAL_PRODUCT "mural-plus"

#endif
