#pragma once

#include <cmath>
#include <cstdint>
#include <cstring>

namespace tubepi {

struct NoiseReport {
  static constexpr uint32_t kDisplayBins = 64;
  bool valid = false;
  uint32_t samples = 0;
  double mean = 0.0;
  double sigma = 0.0;
  double minEntropy = 0.0;
  uint32_t minValue = 0;
  uint32_t maxValue = 0;
  uint32_t binLow = 0;
  uint32_t binHigh = 4096;
  uint32_t bins[kDisplayBins] = {};
  uint32_t outOfRange = 0;
  uint32_t generation = 0;
};

class NoiseMonitor {
 public:
  static constexpr uint32_t kEntropyBins = 4096;
  static constexpr uint32_t kMaxWindow = 65535;

  explicit NoiseMonitor(uint32_t window = 16384) { setWindow(window); }

  void setWindow(uint32_t window) {
    window_ = window < 64 ? 64 : (window > kMaxWindow ? kMaxWindow : window);
    restart();
  }
  uint32_t window() const { return window_; }

  void setInitialRange(uint32_t low, uint32_t high) {
    low_ = low;
    high_ = high > low ? high : low + 1;
  }

  void add(uint32_t value) {
    const uint16_t c = ++counts_[value & (kEntropyBins - 1)];
    if (c > maxCount_) maxCount_ = c;
    sum_ += value;
    sumSq_ += static_cast<uint64_t>(value) * value;
    if (value < min_) min_ = value;
    if (value > max_) max_ = value;
    if (value < low_ || value >= high_) {
      ++outOfRange_;
    } else {
      const uint64_t span = high_ - low_;
      const uint32_t bin =
          static_cast<uint32_t>((static_cast<uint64_t>(value - low_) * NoiseReport::kDisplayBins) / span);
      ++bins_[bin < NoiseReport::kDisplayBins ? bin : NoiseReport::kDisplayBins - 1];
    }
    if (++n_ >= window_) publish();
  }

  const NoiseReport& report() const { return report_; }

 private:
  void publish() {
    const double n = static_cast<double>(n_);
    const double mean = static_cast<double>(sum_) / n;
    double var = static_cast<double>(sumSq_) / n - mean * mean;
    if (var < 0.0) var = 0.0;
    const double p = static_cast<double>(maxCount_) / n;
    double pu = p + 2.576 * std::sqrt(p * (1.0 - p) / (n - 1.0));
    if (pu > 1.0) pu = 1.0;

    report_.valid = true;
    report_.samples = n_;
    report_.mean = mean;
    report_.sigma = std::sqrt(var);
    report_.minEntropy = -std::log2(pu);
    report_.minValue = min_;
    report_.maxValue = max_;
    report_.binLow = low_;
    report_.binHigh = high_;
    std::memcpy(report_.bins, bins_, sizeof(bins_));
    report_.outOfRange = outOfRange_;
    ++report_.generation;

    const double spread = report_.sigma < 1.0 ? 8.0 : 5.0 * report_.sigma;
    const double lo = std::floor(mean - spread);
    const double hi = std::ceil(mean + spread) + 1.0;
    low_ = lo < 0.0 ? 0u : static_cast<uint32_t>(lo);
    high_ = static_cast<uint32_t>(hi);
    if (high_ <= low_) high_ = low_ + 1;
    restart();
  }

  void restart() {
    std::memset(counts_, 0, sizeof(counts_));
    std::memset(bins_, 0, sizeof(bins_));
    maxCount_ = 0;
    sum_ = 0;
    sumSq_ = 0;
    min_ = UINT32_MAX;
    max_ = 0;
    outOfRange_ = 0;
    n_ = 0;
  }

  uint32_t window_ = 16384;
  uint16_t counts_[kEntropyBins];
  uint32_t bins_[NoiseReport::kDisplayBins];
  uint16_t maxCount_ = 0;
  uint64_t sum_ = 0;
  uint64_t sumSq_ = 0;
  uint32_t min_ = UINT32_MAX;
  uint32_t max_ = 0;
  uint32_t low_ = 0;
  uint32_t high_ = 4096;
  uint32_t outOfRange_ = 0;
  uint32_t n_ = 0;
  NoiseReport report_;
};

}
