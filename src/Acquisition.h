#pragma once

#include <stdint.h>

#include <TubePi.h>

class Acquisition {
 public:
  void begin();
  uint32_t poll(tubepi::Pipeline& pipeline);
  uint32_t overruns() const;
  uint32_t lastSampleMs() const { return lastSampleMs_; }

 private:
  static constexpr uint32_t kBatch = 256;
  uint32_t batch_[kBatch];
  uint32_t lastSampleMs_ = 0;
  uint32_t lastEdge_ = 0;
  bool haveEdge_ = false;
};
