#include "Acquisition.h"

#include "Board.h"

#if TUBEPI_SOURCE == TUBEPI_SOURCE_PULSE
namespace {

constexpr uint32_t kRingSize = 512;
volatile uint32_t ring[kRingSize];
volatile uint32_t ringHead = 0;
volatile uint32_t ringTail = 0;
volatile uint32_t ringOverruns = 0;
volatile uint32_t lastAccepted = 0;

void IRAM_ATTR onPulse() {
  const uint32_t now = micros();
  if (now - lastAccepted < TUBEPI_PULSE_MIN_GAP_US) return;
  lastAccepted = now;
  const uint32_t head = ringHead;
  const uint32_t next = (head + 1) % kRingSize;
  if (next == ringTail) {
    ringOverruns = ringOverruns + 1;
    return;
  }
  ring[head] = now;
  ringHead = next;
}

}
#endif

void Acquisition::begin() {
#if TUBEPI_SOURCE == TUBEPI_SOURCE_ANALOG
  analogReadResolution(12);
#if defined(ARDUINO_ARCH_ESP32)
  analogSetPinAttenuation(TUBEPI_ANALOG_PIN, ADC_11db);
#endif
  pinMode(TUBEPI_ANALOG_PIN, INPUT);
#elif TUBEPI_SOURCE == TUBEPI_SOURCE_PULSE
  pinMode(TUBEPI_PULSE_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(TUBEPI_PULSE_PIN), onPulse, FALLING);
#endif
}

uint32_t Acquisition::overruns() const {
#if TUBEPI_SOURCE == TUBEPI_SOURCE_PULSE
  return ringOverruns;
#else
  return 0;
#endif
}

uint32_t Acquisition::poll(tubepi::Pipeline& pipeline) {
  uint32_t n = 0;

#if TUBEPI_SOURCE == TUBEPI_SOURCE_ANALOG
  for (; n < kBatch; ++n) batch_[n] = analogRead(TUBEPI_ANALOG_PIN);
  {
    StateLock lock;
    for (uint32_t i = 0; i < n; ++i) pipeline.feedAnalog(static_cast<uint16_t>(batch_[i]));
  }

#elif TUBEPI_SOURCE == TUBEPI_SOURCE_PULSE
  while (n < kBatch && ringTail != ringHead) {
    const uint32_t tail = ringTail;
    const uint32_t t = ring[tail];
    ringTail = (tail + 1) % kRingSize;
    if (haveEdge_) batch_[n++] = t - lastEdge_;
    lastEdge_ = t;
    haveEdge_ = true;
  }
  if (n > 0) {
    StateLock lock;
    for (uint32_t i = 0; i < n; ++i) pipeline.feedInterval(batch_[i]);
  }

#else
  for (; n < kBatch; ++n) {
    const uint32_t a = hardwareRandom();
    const uint32_t b = hardwareRandom();
    batch_[n] = ((a & 0xFFFu) + ((a >> 12) & 0xFFFu) + (b & 0xFFFu) + ((b >> 12) & 0xFFFu)) >> 2;
  }
  {
    StateLock lock;
    for (uint32_t i = 0; i < n; ++i) pipeline.feedAnalog(static_cast<uint16_t>(batch_[i]));
  }
#endif

  if (n > 0) lastSampleMs_ = millis();
  return n;
}
