#include "Board.h"

#if defined(ARDUINO_ARCH_ESP32)

#include <esp_system.h>

uint32_t hardwareRandom() { return esp_random(); }

StateLock::StateLock() {}
StateLock::~StateLock() {}

#elif defined(ARDUINO_ARCH_RP2040)

#include <pico/mutex.h>

auto_init_mutex(stateMutex);

uint32_t hardwareRandom() { return rp2040.hwrand32(); }

StateLock::StateLock() { mutex_enter_blocking(&stateMutex); }
StateLock::~StateLock() { mutex_exit(&stateMutex); }

#endif
