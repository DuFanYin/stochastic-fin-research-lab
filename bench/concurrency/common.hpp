#pragma once

#include <chrono>
#include <cstdlib>
#include <cstring>
#include <string>
#include <sys/resource.h>

// Peak resident set size of this process in MiB (ru_maxrss is bytes on macOS, KiB on Linux).
inline double peak_rss_mib() {
    rusage u{};
    getrusage(RUSAGE_SELF, &u);
#ifdef __APPLE__
    return u.ru_maxrss / (1024.0 * 1024.0);
#else
    return u.ru_maxrss / 1024.0;
#endif
}

inline double now_ms() {
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

// --name value
inline std::string arg(int argc, char** argv, const char* name, const char* def) {
    for (int i = 1; i + 1 < argc; ++i)
        if (std::strcmp(argv[i], name) == 0) return argv[i + 1];
    return def;
}
