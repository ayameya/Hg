#pragma once

#include <cmath>
#include <cstdint>

namespace tubepi {

struct PiHistoryEntry {
  uint64_t darts;
  float circle;
  float coprime;
};

class PiEstimator {
 public:
  static constexpr uint32_t kRecent = 512;
  static constexpr uint32_t kHistory = 128;
  static constexpr uint64_t kRadiusSq = 1ull << 34;

  void addWord(uint32_t word) {
    toggle_ = !toggle_;
    if (toggle_) {
      addDart(word);
    } else {
      addPair(word);
    }
  }

  void addDart(uint32_t word) {
    const uint64_t x = 2ull * (word >> 16) + 1ull;
    const uint64_t y = 2ull * (word & 0xFFFFu) + 1ull;
    if (x * x + y * y < kRadiusSq) ++inside_;
    ++darts_;
    recent_[static_cast<uint32_t>(darts_ - 1) % kRecent] = word;
    if (darts_ >= nextHistory_) recordHistory();
  }

  void addPair(uint32_t word) {
    const uint32_t a = (word >> 16) + 1u;
    const uint32_t b = (word & 0xFFFFu) + 1u;
    if (gcd(a, b) == 1u) ++coprime_;
    ++pairs_;
  }

  void reset() {
    darts_ = inside_ = pairs_ = coprime_ = 0;
    historyCount_ = 0;
    nextHistory_ = 16;
    toggle_ = false;
    ++epoch_;
  }

  uint64_t darts() const { return darts_; }
  uint64_t inside() const { return inside_; }
  uint64_t pairs() const { return pairs_; }
  uint64_t coprime() const { return coprime_; }
  uint32_t epoch() const { return epoch_; }

  double circleEstimate() const {
    return darts_ ? 4.0 * static_cast<double>(inside_) / static_cast<double>(darts_) : 0.0;
  }

  double circleSigma() const {
    if (darts_ < 2) return 0.0;
    const double p = static_cast<double>(inside_) / static_cast<double>(darts_);
    return 4.0 * std::sqrt(p * (1.0 - p) / static_cast<double>(darts_));
  }

  double coprimeEstimate() const {
    return coprime_ ? std::sqrt(6.0 * static_cast<double>(pairs_) / static_cast<double>(coprime_)) : 0.0;
  }

  double coprimeSigma() const {
    if (pairs_ < 2 || coprime_ == 0) return 0.0;
    const double p = static_cast<double>(coprime_) / static_cast<double>(pairs_);
    const double sp = std::sqrt(p * (1.0 - p) / static_cast<double>(pairs_));
    return 0.5 * std::sqrt(6.0) * std::pow(p, -1.5) * sp;
  }

  uint32_t historyCount() const { return historyCount_; }
  const PiHistoryEntry& history(uint32_t i) const { return history_[i]; }

  uint32_t recentAvailable() const {
    return darts_ < kRecent ? static_cast<uint32_t>(darts_) : kRecent;
  }

  uint32_t recentAt(uint64_t dartIndex) const {
    return recent_[static_cast<uint32_t>(dartIndex) % kRecent];
  }

  static uint32_t gcd(uint32_t a, uint32_t b) {
    while (b != 0u) {
      const uint32_t t = a % b;
      a = b;
      b = t;
    }
    return a;
  }

 private:
  void recordHistory() {
    if (historyCount_ < kHistory) {
      history_[historyCount_++] = {darts_, static_cast<float>(circleEstimate()),
                                   static_cast<float>(coprimeEstimate())};
    }
    nextHistory_ = darts_ + darts_ / 4 + 1;
  }

  uint64_t darts_ = 0;
  uint64_t inside_ = 0;
  uint64_t pairs_ = 0;
  uint64_t coprime_ = 0;
  uint64_t nextHistory_ = 16;
  uint32_t historyCount_ = 0;
  uint32_t epoch_ = 0;
  bool toggle_ = false;
  uint32_t recent_[kRecent] = {};
  PiHistoryEntry history_[kHistory] = {};
};

}
