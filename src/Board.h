#pragma once

#include <Arduino.h>

#include "Config.h"

#ifndef IRAM_ATTR
#define IRAM_ATTR
#endif

#if defined(ARDUINO_ARCH_ESP32)

#ifndef TUBEPI_BOARD_NAME
#define TUBEPI_BOARD_NAME "Seeed XIAO ESP32C3"
#endif
#ifndef TUBEPI_ANALOG_PIN
#define TUBEPI_ANALOG_PIN 3
#endif
#ifndef TUBEPI_PULSE_PIN
#define TUBEPI_PULSE_PIN 5
#endif
#define TUBEPI_DUAL_CORE 0

#elif defined(ARDUINO_ARCH_RP2040)

#ifndef TUBEPI_BOARD_NAME
#define TUBEPI_BOARD_NAME "Raspberry Pi Pico 2 W"
#endif
#ifndef TUBEPI_ANALOG_PIN
#define TUBEPI_ANALOG_PIN 26
#endif
#ifndef TUBEPI_PULSE_PIN
#define TUBEPI_PULSE_PIN 15
#endif
#define TUBEPI_DUAL_CORE 1

#else
#error "Unsupported board: use an ESP32 (arduino-esp32) or RP2040/RP2350 (arduino-pico) target"
#endif

uint32_t hardwareRandom();

class StateLock {
 public:
  StateLock();
  ~StateLock();
  StateLock(const StateLock&) = delete;
  StateLock& operator=(const StateLock&) = delete;
};
