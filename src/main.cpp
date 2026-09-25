#include <Arduino.h>
#include <TubePi.h>

#include "Acquisition.h"
#include "Board.h"
#include "Portal.h"

namespace {

tubepi::PipelineConfig makeConfig() {
  tubepi::PipelineConfig c;
#if TUBEPI_SOURCE == TUBEPI_SOURCE_PULSE
  c.source = tubepi::SourceKind::Pulse;
  c.initialLow = 0;
  c.initialHigh = TUBEPI_PULSE_RANGE_US;
  c.recoverySamples = 256;
#elif TUBEPI_SOURCE == TUBEPI_SOURCE_SIMULATED
  c.source = tubepi::SourceKind::Simulated;
#else
  c.source = tubepi::SourceKind::Analog;
#endif
  c.analogBits = TUBEPI_ANALOG_BITS_LSB ? tubepi::AnalogBitMode::Lsb : tubepi::AnalogBitMode::Threshold;
  c.pulseBits = TUBEPI_PULSE_BITS_LSB ? tubepi::PulseBitMode::Lsb : tubepi::PulseBitMode::Compare;
  c.vonNeumann = TUBEPI_VON_NEUMANN != 0;
  c.decimation = TUBEPI_ANALOG_DECIMATION;
  c.assumedEntropy = TUBEPI_ASSUMED_ENTROPY;
  c.monitorWindow = TUBEPI_MONITOR_WINDOW;
  c.quietSigma = TUBEPI_QUIET_SIGMA;
  return c;
}

tubepi::Pipeline pipeline(makeConfig());
Acquisition acquisition;
uint32_t lastLogMs = 0;
#if TUBEPI_HV_ENABLE_PIN >= 0 && TUBEPI_SOURCE != TUBEPI_SOURCE_SIMULATED
bool highVoltageOn = false;
#endif

uint32_t warmupRemaining() {
#if TUBEPI_HV_ENABLE_PIN >= 0 && TUBEPI_SOURCE != TUBEPI_SOURCE_SIMULATED
  if (highVoltageOn) return 0;
  const uint32_t now = millis();
  return now < TUBEPI_WARMUP_MS ? TUBEPI_WARMUP_MS - now : 0;
#else
  return 0;
#endif
}

void beginHighVoltage() {
#if TUBEPI_HV_ENABLE_PIN >= 0
  digitalWrite(TUBEPI_HV_ENABLE_PIN, LOW);
  pinMode(TUBEPI_HV_ENABLE_PIN, OUTPUT);
  digitalWrite(TUBEPI_HV_ENABLE_PIN, LOW);
#endif
}

void serviceHighVoltage() {
#if TUBEPI_HV_ENABLE_PIN >= 0 && TUBEPI_SOURCE != TUBEPI_SOURCE_SIMULATED
  if (highVoltageOn || warmupRemaining() > 0) return;
  digitalWrite(TUBEPI_HV_ENABLE_PIN, HIGH);
  highVoltageOn = true;
  Serial.println("[tg1b] heater warm-up complete, anode supply enabled");
#endif
}

bool renderState(const tubepi::StateQuery& query, tubepi::JsonWriter& out) {
  tubepi::DeviceInfo info;
  info.board = TUBEPI_BOARD_NAME;
  const uint32_t now = millis();
  info.uptimeMs = now;
  info.clients = portal::clients();
  info.pulseOverruns = acquisition.overruns();
  info.idleMs = now - acquisition.lastSampleMs();
  info.warmupMs = warmupRemaining();
  StateLock lock;
  return tubepi::writeState(pipeline, info, query, out);
}

size_t copyRandom(uint8_t* out, size_t max) {
  StateLock lock;
  return pipeline.copyRandom(out, max);
}

void resetEstimate() {
  StateLock lock;
  pipeline.resetStatistics();
}

void logStatus() {
  const uint32_t now = millis();
  if (now - lastLogMs < 5000) return;
  lastLogMs = now;
  double estimate;
  unsigned long long darts;
  const char* state;
  double sigma;
  {
    StateLock lock;
    estimate = pipeline.estimator().circleEstimate();
    darts = pipeline.estimator().darts();
    state = tubepi::stateName(pipeline.state());
    sigma = pipeline.noise().sigma;
  }
  Serial.printf("[tg1b] http://%s/  state=%s  noise_sd=%.2f  darts=%llu  pi~%.6f\n", portal::address(), state, sigma,
                darts, estimate);
}

void startPortal() {
  Serial.begin(115200);
  portal::begin({renderState, copyRandom, resetEstimate});
  Serial.printf("[tg1b] AP \"%s\" at http://%s/ on %s\n", TUBEPI_AP_SSID, portal::address(), TUBEPI_BOARD_NAME);
}

}

#if TUBEPI_DUAL_CORE

void setup() {
  beginHighVoltage();
  startPortal();
}

void loop() {
  serviceHighVoltage();
  portal::handle();
  logStatus();
  delay(1);
}

void setup1() { acquisition.begin(); }

void loop1() { acquisition.poll(pipeline); }

#else

void setup() {
  beginHighVoltage();
  acquisition.begin();
  startPortal();
}

void loop() {
  serviceHighVoltage();
  portal::handle();
  acquisition.poll(pipeline);
  logStatus();
  delay(1);
}

#endif
