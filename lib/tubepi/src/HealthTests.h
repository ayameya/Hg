#pragma once

#include <cmath>
#include <cstdint>

namespace tubepi {

inline uint32_t rctCutoff(double entropyPerSample, double alphaLog2 = 20.0) {
  return 1u + static_cast<uint32_t>(std::ceil(alphaLog2 / entropyPerSample));
}

inline uint32_t aptCutoff(uint32_t window, double entropyPerSample, double alphaLog2 = 20.0) {
  const double p = std::pow(2.0, -entropyPerSample);
  if (p >= 1.0) return window;
  const double alpha = std::pow(2.0, -alphaLog2);
  const double logP = std::log(p);
  const double logQ = std::log1p(-p);
  const double logN = std::lgamma(window + 1.0);
  double tail = 0.0;
  for (int64_t k = window; k >= 0; --k) {
    const double kk = static_cast<double>(k);
    const double lp = logN - std::lgamma(kk + 1.0) - std::lgamma(window - kk + 1.0) + kk * logP +
                      (window - kk) * logQ;
    tail += std::exp(lp);
    if (tail > alpha) return static_cast<uint32_t>(k + 1);
  }
  return 1;
}

class RepetitionCountTest {
 public:
  explicit RepetitionCountTest(uint32_t cutoff = 21) : cutoff_(cutoff) {}

  void setCutoff(uint32_t cutoff) { cutoff_ = cutoff; }
  uint32_t cutoff() const { return cutoff_; }
  uint32_t failures() const { return failures_; }

  bool feed(uint32_t value) {
    if (primed_ && value == last_) {
      if (++run_ >= cutoff_) {
        ++failures_;
        run_ = 1;
        return false;
      }
      return true;
    }
    primed_ = true;
    last_ = value;
    run_ = 1;
    return true;
  }

  void reset() {
    primed_ = false;
    run_ = 0;
    failures_ = 0;
  }

 private:
  uint32_t cutoff_;
  uint32_t last_ = 0;
  uint32_t run_ = 0;
  uint32_t failures_ = 0;
  bool primed_ = false;
};

class AdaptiveProportionTest {
 public:
  AdaptiveProportionTest(uint32_t window = 512, uint32_t cutoff = 311)
      : window_(window), cutoff_(cutoff) {}

  void configure(uint32_t window, uint32_t cutoff) {
    window_ = window;
    cutoff_ = cutoff;
    index_ = 0;
  }
  uint32_t window() const { return window_; }
  uint32_t cutoff() const { return cutoff_; }
  uint32_t failures() const { return failures_; }

  bool feed(uint32_t value) {
    if (index_ == 0) {
      reference_ = value;
      count_ = 1;
      index_ = 1;
      return true;
    }
    if (value == reference_) ++count_;
    if (++index_ >= window_) index_ = 0;
    if (count_ >= cutoff_) {
      ++failures_;
      index_ = 0;
      return false;
    }
    return true;
  }

  void reset() {
    index_ = 0;
    failures_ = 0;
  }

 private:
  uint32_t window_;
  uint32_t cutoff_;
  uint32_t reference_ = 0;
  uint32_t count_ = 0;
  uint32_t index_ = 0;
  uint32_t failures_ = 0;
};

}
