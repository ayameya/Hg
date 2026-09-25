#pragma once

#include <cstdint>

#include "JsonWriter.h"
#include "Pipeline.h"

namespace tubepi {

struct DeviceInfo {
  const char* board = "unknown";
  const char* tube = "ТГ1Б";
  uint32_t uptimeMs = 0;
  uint32_t clients = 0;
  uint32_t pulseOverruns = 0;
  uint32_t idleMs = 0;
  uint32_t warmupMs = 0;
};

struct StateQuery {
  uint32_t epoch = UINT32_MAX;
  uint64_t sinceDart = 0;
  uint32_t historyFrom = 0;
  uint32_t maxPoints = 256;
  bool wave = false;
};

inline const char* sourceName(SourceKind kind) {
  switch (kind) {
    case SourceKind::Analog:
      return "analog";
    case SourceKind::Pulse:
      return "pulse";
    case SourceKind::Simulated:
      return "simulated";
  }
  return "unknown";
}

inline const char* stateName(SourceState state) {
  switch (state) {
    case SourceState::WarmingUp:
      return "warming";
    case SourceState::Quiet:
      return "quiet";
    case SourceState::Recovering:
      return "recovering";
    case SourceState::Healthy:
      return "healthy";
  }
  return "unknown";
}

inline bool writeState(const Pipeline& p, const DeviceInfo& d, const StateQuery& q, JsonWriter& w) {
  const PiEstimator& e = p.estimator();
  const bool sameEpoch = q.epoch == e.epoch();
  const PipelineConfig& c = p.config();

  w.beginObject();
  w.key("v").uint(1);
  w.key("board").string(d.board);
  w.key("tube").string(d.tube);
  w.key("source").string(sourceName(c.source));
  w.key("ms").uint(d.uptimeMs);
  w.key("clients").uint(d.clients);
  w.key("idle").uint(d.idleMs);
  w.key("warmup").uint(d.warmupMs);
  w.key("state").string(stateName(p.state()));

  w.key("pi").beginObject();
  w.key("epoch").uint(e.epoch());
  w.key("darts").uint(e.darts());
  w.key("inside").uint(e.inside());
  w.key("est").fixed(e.circleEstimate(), 9);
  w.key("sd").fixed(e.circleSigma(), 9);
  w.key("pairs").uint(e.pairs());
  w.key("coprime").uint(e.coprime());
  w.key("cest").fixed(e.coprimeEstimate(), 9);
  w.key("csd").fixed(e.coprimeSigma(), 9);
  w.endObject();

  const uint32_t histFrom = sameEpoch && q.historyFrom <= e.historyCount() ? q.historyFrom : 0;
  w.key("hist").beginObject();
  w.key("from").uint(histFrom);
  w.key("rows").beginArray();
  for (uint32_t i = histFrom; i < e.historyCount(); ++i) {
    const PiHistoryEntry& h = e.history(i);
    w.beginArray().uint(h.darts).fixed(h.circle, 7).fixed(h.coprime, 7).endArray();
  }
  w.endArray();
  w.endObject();

  const uint64_t darts = e.darts();
  uint64_t start = sameEpoch && q.sinceDart <= darts ? q.sinceDart : 0;
  const uint64_t oldest = darts - e.recentAvailable();
  if (start < oldest) start = oldest;
  if (darts - start > q.maxPoints) start = darts - q.maxPoints;
  w.key("pts").beginObject();
  w.key("from").uint(start);
  w.key("hex").openString();
  for (uint64_t i = start; i < darts; ++i) w.hexWord(e.recentAt(i));
  w.closeString();
  w.endObject();

  w.key("bits").beginObject();
  w.key("samples").uint(p.rawSamples());
  w.key("discarded").uint(p.discardedSamples());
  w.key("raw").uint(p.rawBits());
  w.key("out").uint(p.outputBits());
  w.key("ones").uint(p.ones());
  w.key("agree").uint(p.agreements());
  w.key("bytes").uint(p.randomBytesWritten());
  w.key("vn").boolean(c.vonNeumann);
  w.endObject();

  const NoiseReport& n = p.noise();
  w.key("noise").beginObject();
  w.key("valid").boolean(n.valid);
  w.key("gen").uint(n.generation);
  w.key("n").uint(n.samples);
  w.key("mean").fixed(n.mean, 3);
  w.key("sd").fixed(n.sigma, 3);
  w.key("hmin").fixed(n.minEntropy, 4);
  w.key("min").uint(n.minValue);
  w.key("max").uint(n.maxValue);
  w.key("lo").uint(n.binLow);
  w.key("hi").uint(n.binHigh);
  w.key("oor").uint(n.outOfRange);
  w.key("quiet").fixed(c.quietSigma, 2);
  w.key("bins").beginArray();
  for (uint32_t i = 0; i < NoiseReport::kDisplayBins; ++i) w.uint(n.bins[i]);
  w.endArray();
  w.endObject();

  w.key("health").beginObject();
  w.key("h").fixed(c.assumedEntropy, 3);
  w.key("rctCut").uint(p.rct().cutoff());
  w.key("rct").uint(p.rct().failures());
  w.key("aptWin").uint(p.apt().window());
  w.key("aptCut").uint(p.apt().cutoff());
  w.key("apt").uint(p.apt().failures());
  w.key("overruns").uint(d.pulseOverruns);
  w.endObject();

  if (q.wave) {
    w.key("wave").beginArray();
    const uint32_t count = p.waveCount();
    for (uint32_t i = 0; i < count; ++i) w.uint(p.waveAt(i));
    w.endArray();
  }

  w.endObject();
  return w.ok();
}

}
