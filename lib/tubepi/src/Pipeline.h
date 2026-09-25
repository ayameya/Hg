#pragma once

#include <cstddef>
#include <cstdint>

#include "HealthTests.h"
#include "NoiseMonitor.h"
#include "PiEstimator.h"

namespace tubepi {

enum class SourceKind : uint8_t { Analog = 0, Pulse = 1, Simulated = 2 };
enum class AnalogBitMode : uint8_t { Threshold = 0, Lsb = 1 };
enum class PulseBitMode : uint8_t { Compare = 0, Lsb = 1 };
enum class SourceState : uint8_t { WarmingUp = 0, Quiet = 1, Recovering = 2, Healthy = 3 };

struct PipelineConfig {
  SourceKind source = SourceKind::Analog;
  AnalogBitMode analogBits = AnalogBitMode::Threshold;
  PulseBitMode pulseBits = PulseBitMode::Compare;
  bool vonNeumann = true;
  uint32_t decimation = 1;
  double assumedEntropy = 1.0;
  uint32_t aptWindow = 512;
  uint32_t monitorWindow = 16384;
  uint32_t recoverySamples = 4096;
  double quietSigma = 3.0;
  uint32_t initialLow = 0;
  uint32_t initialHigh = 4096;
};

class Pipeline {
 public:
  static constexpr uint32_t kWave = 256;
  static constexpr uint32_t kRandomBytes = 4096;

  explicit Pipeline(const PipelineConfig& config = PipelineConfig()) { configure(config); }

  void configure(const PipelineConfig& config) {
    config_ = config;
    if (config_.decimation == 0) config_.decimation = 1;
    rct_.setCutoff(rctCutoff(config_.assumedEntropy));
    apt_.configure(config_.aptWindow, aptCutoff(config_.aptWindow, config_.assumedEntropy));
    monitor_.setWindow(config_.monitorWindow);
    monitor_.setInitialRange(config_.initialLow, config_.initialHigh);
  }

  const PipelineConfig& config() const { return config_; }

  void feedAnalog(uint16_t value) {
    ingest(value);
    const int32_t scaled = static_cast<int32_t>(value) << 8;
    if (!emaPrimed_) {
      ema_ = scaled;
      emaPrimed_ = true;
    }
    const uint8_t above = scaled > ema_ ? 1 : 0;
    ema_ += (scaled - ema_) >> 8;
    if (++decimationCounter_ < config_.decimation) return;
    decimationCounter_ = 0;
    if (!admit(value)) return;
    emitRaw(config_.analogBits == AnalogBitMode::Lsb ? static_cast<uint8_t>(value & 1u) : above);
  }

  void feedInterval(uint32_t interval) {
    ingest(interval);
    if (!admit(interval)) {
      pendingValid_ = false;
      return;
    }
    if (config_.pulseBits == PulseBitMode::Lsb) {
      emitRaw(static_cast<uint8_t>(interval & 1u));
      return;
    }
    if (!pendingValid_) {
      pending_ = interval;
      pendingValid_ = true;
      return;
    }
    pendingValid_ = false;
    if (interval == pending_) return;
    const uint8_t bit = static_cast<uint8_t>((pending_ < interval ? 1u : 0u) ^ flip_);
    flip_ ^= 1u;
    emitRaw(bit);
  }

  void resetStatistics() {
    estimator_.reset();
    rawBits_ = 0;
    outBits_ = 0;
    ones_ = 0;
    agree_ = 0;
    havePrev_ = false;
  }

  SourceState state() const {
    if (!ready_) return SourceState::WarmingUp;
    if (recovery_ > 0) return SourceState::Recovering;
    if (quiet_) return SourceState::Quiet;
    return SourceState::Healthy;
  }

  const PiEstimator& estimator() const { return estimator_; }
  const NoiseReport& noise() const { return monitor_.report(); }
  const RepetitionCountTest& rct() const { return rct_; }
  const AdaptiveProportionTest& apt() const { return apt_; }

  uint64_t rawSamples() const { return rawSamples_; }
  uint64_t discardedSamples() const { return discarded_; }
  uint64_t rawBits() const { return rawBits_; }
  uint64_t outputBits() const { return outBits_; }
  uint64_t ones() const { return ones_; }
  uint64_t agreements() const { return agree_; }
  uint64_t randomBytesWritten() const { return randomWritten_; }

  uint32_t waveCount() const {
    return rawSamples_ < kWave ? static_cast<uint32_t>(rawSamples_) : kWave;
  }

  uint32_t waveAt(uint32_t i) const {
    const uint32_t n = waveCount();
    const uint32_t start = static_cast<uint32_t>((rawSamples_ - n) % kWave);
    return wave_[(start + i) % kWave];
  }

  size_t copyRandom(uint8_t* out, size_t max) const {
    size_t n = randomWritten_ < kRandomBytes ? static_cast<size_t>(randomWritten_) : kRandomBytes;
    if (n > max) n = max;
    const uint64_t start = randomWritten_ - n;
    for (size_t i = 0; i < n; ++i) out[i] = random_[(start + i) % kRandomBytes];
    return n;
  }

 private:
  void ingest(uint32_t value) {
    wave_[static_cast<uint32_t>(rawSamples_ % kWave)] = value;
    ++rawSamples_;
    monitor_.add(value);
    const NoiseReport& r = monitor_.report();
    if (r.generation != seenGeneration_) {
      seenGeneration_ = r.generation;
      ready_ = true;
      quiet_ = r.sigma < config_.quietSigma;
    }
  }

  bool admit(uint32_t value) {
    const bool rctOk = rct_.feed(value);
    const bool aptOk = apt_.feed(value);
    if (!rctOk || !aptOk) {
      recovery_ = config_.recoverySamples;
      resetConditioner();
    }
    if (recovery_ > 0) {
      --recovery_;
      ++discarded_;
      return false;
    }
    if (!ready_ || quiet_) {
      ++discarded_;
      resetConditioner();
      return false;
    }
    return true;
  }

  void resetConditioner() {
    vnPending_ = false;
    wordBits_ = 0;
    pendingValid_ = false;
  }

  void emitRaw(uint8_t bit) {
    ++rawBits_;
    if (config_.vonNeumann) {
      if (!vnPending_) {
        vnFirst_ = bit;
        vnPending_ = true;
        return;
      }
      vnPending_ = false;
      if (vnFirst_ == bit) return;
      bit = vnFirst_;
    }
    emitOutput(bit);
  }

  void emitOutput(uint8_t bit) {
    ++outBits_;
    ones_ += bit;
    if (havePrev_ && bit == prev_) ++agree_;
    prev_ = bit;
    havePrev_ = true;
    word_ = (word_ << 1) | bit;
    if (++wordBits_ == 32) {
      wordBits_ = 0;
      onWord(word_);
    }
  }

  void onWord(uint32_t word) {
    for (int shift = 24; shift >= 0; shift -= 8) {
      random_[randomWritten_ % kRandomBytes] = static_cast<uint8_t>(word >> shift);
      ++randomWritten_;
    }
    estimator_.addWord(word);
  }

  PipelineConfig config_;
  RepetitionCountTest rct_;
  AdaptiveProportionTest apt_;
  NoiseMonitor monitor_;
  PiEstimator estimator_;

  uint32_t seenGeneration_ = 0;
  bool ready_ = false;
  bool quiet_ = false;
  uint32_t recovery_ = 0;

  int32_t ema_ = 0;
  bool emaPrimed_ = false;
  uint32_t decimationCounter_ = 0;

  uint32_t pending_ = 0;
  bool pendingValid_ = false;
  uint8_t flip_ = 0;

  bool vnPending_ = false;
  uint8_t vnFirst_ = 0;
  uint32_t word_ = 0;
  uint32_t wordBits_ = 0;
  uint8_t prev_ = 0;
  bool havePrev_ = false;

  uint64_t rawSamples_ = 0;
  uint64_t discarded_ = 0;
  uint64_t rawBits_ = 0;
  uint64_t outBits_ = 0;
  uint64_t ones_ = 0;
  uint64_t agree_ = 0;

  uint32_t wave_[kWave] = {};
  uint8_t random_[kRandomBytes] = {};
  uint64_t randomWritten_ = 0;
};

}
