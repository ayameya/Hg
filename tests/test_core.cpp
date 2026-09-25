#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "TubePi.h"

using namespace tubepi;

static int gFailures = 0;
static int gChecks = 0;

#define CHECK(cond)                                                   \
  do {                                                                \
    ++gChecks;                                                        \
    if (!(cond)) {                                                    \
      ++gFailures;                                                    \
      std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);     \
    }                                                                 \
  } while (0)

struct SplitMix {
  uint64_t s;
  explicit SplitMix(uint64_t seed) : s(seed) {}
  uint64_t next() {
    uint64_t z = (s += 0x9E3779B97F4A7C15ull);
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
    return z ^ (z >> 31);
  }
  double uniform() { return (next() >> 11) * (1.0 / 9007199254740992.0); }
  double gauss() {
    double u = uniform();
    if (u < 1e-300) u = 1e-300;
    return std::sqrt(-2.0 * std::log(u)) * std::cos(6.283185307179586 * uniform());
  }
};

class JsonValidator {
 public:
  explicit JsonValidator(const std::string& s) : s_(s) {}
  bool valid() {
    ws();
    if (!value()) return false;
    ws();
    return i_ == s_.size();
  }

 private:
  void ws() {
    while (i_ < s_.size() && std::strchr(" \t\r\n", s_[i_])) ++i_;
  }
  bool lit(const char* t) {
    size_t n = std::strlen(t);
    if (s_.compare(i_, n, t) != 0) return false;
    i_ += n;
    return true;
  }
  bool str() {
    if (s_[i_] != '"') return false;
    ++i_;
    while (i_ < s_.size() && s_[i_] != '"') {
      if (s_[i_] == '\\') ++i_;
      ++i_;
    }
    if (i_ >= s_.size()) return false;
    ++i_;
    return true;
  }
  bool num() {
    size_t b = i_;
    if (s_[i_] == '-') ++i_;
    while (i_ < s_.size() && (std::isdigit(static_cast<unsigned char>(s_[i_])) || s_[i_] == '.' ||
                              s_[i_] == 'e' || s_[i_] == 'E' || s_[i_] == '+' || s_[i_] == '-'))
      ++i_;
    return i_ > b;
  }
  bool value() {
    ws();
    if (i_ >= s_.size()) return false;
    char c = s_[i_];
    if (c == '{') {
      ++i_;
      ws();
      if (s_[i_] == '}') return ++i_, true;
      for (;;) {
        ws();
        if (!str()) return false;
        ws();
        if (s_[i_++] != ':') return false;
        if (!value()) return false;
        ws();
        if (s_[i_] == ',') { ++i_; continue; }
        if (s_[i_] == '}') return ++i_, true;
        return false;
      }
    }
    if (c == '[') {
      ++i_;
      ws();
      if (s_[i_] == ']') return ++i_, true;
      for (;;) {
        if (!value()) return false;
        ws();
        if (s_[i_] == ',') { ++i_; continue; }
        if (s_[i_] == ']') return ++i_, true;
        return false;
      }
    }
    if (c == '"') return str();
    if (lit("true") || lit("false") || lit("null")) return true;
    return num();
  }
  const std::string& s_;
  size_t i_ = 0;
};

static void testCutoffs() {
  CHECK(rctCutoff(1.0) == 21);
  CHECK(rctCutoff(0.5) == 41);
  CHECK(aptCutoff(1024, 1.0) == 589);
  CHECK(aptCutoff(512, 1.0) == 311);
  CHECK(aptCutoff(512, 0.5) == 410);
  CHECK(aptCutoff(1024, 0.5) == 793);
}

static void testRctAndApt() {
  RepetitionCountTest rct(5);
  for (int i = 0; i < 4; ++i) CHECK(rct.feed(7));
  CHECK(!rct.feed(7));
  CHECK(rct.failures() == 1);
  CHECK(rct.feed(8));

  AdaptiveProportionTest apt(16, 10);
  bool failed = false;
  for (int i = 0; i < 16; ++i) failed |= !apt.feed(i % 2 == 0 ? 3 : 3);
  CHECK(failed);
  AdaptiveProportionTest apt2(512, aptCutoff(512, 8.0));
  SplitMix rng(1);
  bool anyFail = false;
  for (int i = 0; i < 200000; ++i) anyFail |= !apt2.feed(static_cast<uint32_t>(rng.next() & 0xFF));
  CHECK(!anyFail);
}

static void testJsonWriter() {
  char buf[128];
  JsonWriter w(buf, sizeof(buf));
  w.beginObject().key("a").fixed(3.14159265, 4).key("b").fixed(-0.5, 2).key("c").fixed(12.0, 0);
  w.key("d").uint(18446744073709551615ull).key("e").string("q\"x").endObject();
  CHECK(w.ok());
  CHECK(std::string(buf) == "{\"a\":3.1416,\"b\":-0.50,\"c\":12,\"d\":18446744073709551615,\"e\":\"q\\\"x\"}");

  char tiny[8];
  JsonWriter t(tiny, sizeof(tiny));
  t.beginObject().key("long_key").uint(1).endObject();
  CHECK(!t.ok());
  CHECK(std::strlen(tiny) < sizeof(tiny));
}

static void testLatticeBias() {
  uint64_t inside = 0;
  for (uint64_t x = 0; x < 65536; ++x) {
    const uint64_t X = 2 * x + 1;
    const uint64_t rem = PiEstimator::kRadiusSq - X * X;
    uint64_t y = static_cast<uint64_t>(std::sqrt(static_cast<double>(rem)));
    while (y * y >= rem && y > 0) --y;
    while ((y + 1) * (y + 1) < rem) ++y;
    inside += (y + 1) / 2;
  }
  const double lattice = 4.0 * static_cast<double>(inside) / 4294967296.0;
  CHECK(std::fabs(lattice - M_PI) < 1e-4);
}

static void testEstimatorWithIdealBits() {
  PiEstimator e;
  SplitMix rng(42);
  for (int i = 0; i < 4000000; ++i) e.addWord(static_cast<uint32_t>(rng.next()));
  CHECK(e.darts() == 2000000);
  CHECK(e.pairs() == 2000000);
  CHECK(std::fabs(e.circleEstimate() - M_PI) < 5.0 * e.circleSigma());
  CHECK(std::fabs(e.coprimeEstimate() - M_PI) < 5.0 * e.coprimeSigma());
  CHECK(std::fabs(e.circleSigma() - 1.6420 / std::sqrt(2000000.0)) < 1e-4);
  CHECK(e.historyCount() > 40);
  for (uint32_t i = 1; i < e.historyCount(); ++i) CHECK(e.history(i).darts > e.history(i - 1).darts);
  const uint32_t before = e.epoch();
  e.reset();
  CHECK(e.darts() == 0 && e.epoch() == before + 1 && e.historyCount() == 0);
}

static PipelineConfig analogConfig() {
  PipelineConfig c;
  c.source = SourceKind::Analog;
  c.assumedEntropy = 2.0;
  c.monitorWindow = 8192;
  c.quietSigma = 3.0;
  return c;
}

static void testAnalogPipelineHealthy() {
  Pipeline p(analogConfig());
  SplitMix rng(7);
  for (int i = 0; i < 3000000; ++i) {
    double v = 2048.0 + 60.0 * rng.gauss();
    p.feedAnalog(static_cast<uint16_t>(v < 0 ? 0 : (v > 4095 ? 4095 : v)));
  }
  CHECK(p.state() == SourceState::Healthy);
  CHECK(p.rct().failures() == 0);
  CHECK(p.apt().failures() == 0);
  CHECK(p.noise().valid);
  CHECK(std::fabs(p.noise().sigma - 60.0) < 3.0);
  CHECK(p.noise().minEntropy > 4.0);
  const double ones = static_cast<double>(p.ones()) / static_cast<double>(p.outputBits());
  CHECK(std::fabs(ones - 0.5) < 0.005);
  const PiEstimator& e = p.estimator();
  CHECK(e.darts() > 5000);
  CHECK(std::fabs(e.circleEstimate() - M_PI) < 5.0 * e.circleSigma());
  CHECK(p.randomBytesWritten() > 0);
  uint8_t out[16];
  CHECK(p.copyRandom(out, sizeof(out)) == sizeof(out));
  CHECK(p.waveCount() == Pipeline::kWave);
}

static void testVonNeumannRemovesBias() {
  PipelineConfig c = analogConfig();
  c.analogBits = AnalogBitMode::Lsb;
  c.assumedEntropy = 0.5;
  Pipeline p(c);
  SplitMix rng(9);
  for (int i = 0; i < 2000000; ++i) {
    uint16_t base = static_cast<uint16_t>(2000 + (rng.next() % 200) * 2);
    uint16_t bit = rng.uniform() < 0.8 ? 1 : 0;
    p.feedAnalog(static_cast<uint16_t>(base | bit));
  }
  const double rawOnes = 0.8;
  const double ones = static_cast<double>(p.ones()) / static_cast<double>(p.outputBits());
  CHECK(std::fabs(ones - 0.5) < 0.005);
  CHECK(p.outputBits() < p.rawBits() * rawOnes * (1 - rawOnes) + p.rawBits() / 100);
}

static void testQuietSourceIsRejected() {
  Pipeline p(analogConfig());
  SplitMix rng(3);
  for (int i = 0; i < 200000; ++i) p.feedAnalog(static_cast<uint16_t>(2048 + (rng.next() % 3)));
  CHECK(p.state() == SourceState::Quiet || p.state() == SourceState::Recovering);
  CHECK(p.estimator().darts() == 0);
  CHECK(p.discardedSamples() > 190000);
}

static void testStuckSourceTripsHealth() {
  Pipeline p(analogConfig());
  SplitMix rng(5);
  for (int i = 0; i < 20000; ++i) p.feedAnalog(static_cast<uint16_t>(2048 + 60.0 * rng.gauss()));
  for (int i = 0; i < 100; ++i) p.feedAnalog(4095);
  CHECK(p.rct().failures() > 0);
  CHECK(p.state() == SourceState::Recovering);
}

static void testPulsePipeline() {
  PipelineConfig c;
  c.source = SourceKind::Pulse;
  c.vonNeumann = false;
  c.assumedEntropy = 1.0;
  c.monitorWindow = 1024;
  c.quietSigma = 2.0;
  c.initialLow = 0;
  c.initialHigh = 5000;
  Pipeline p(c);
  SplitMix rng(11);
  for (int i = 0; i < 400000; ++i) {
    double v = 1000.0 + 25.0 * rng.gauss();
    p.feedInterval(static_cast<uint32_t>(v));
  }
  CHECK(p.state() == SourceState::Healthy);
  CHECK(p.rawBits() > 150000);
  const double ones = static_cast<double>(p.ones()) / static_cast<double>(p.outputBits());
  CHECK(std::fabs(ones - 0.5) < 0.01);
  CHECK(std::fabs(p.noise().mean - 1000.0) < 2.0);
  CHECK(std::fabs(p.estimator().circleEstimate() - M_PI) < 5.0 * p.estimator().circleSigma());
}

static void testStateJson() {
  Pipeline p(analogConfig());
  SplitMix rng(13);
  for (int i = 0; i < 400000; ++i) p.feedAnalog(static_cast<uint16_t>(2048 + 60.0 * rng.gauss()));

  static char buf[24576];
  DeviceInfo d;
  d.board = "native";
  d.uptimeMs = 1234;
  StateQuery q;
  q.wave = true;
  JsonWriter w(buf, sizeof(buf));
  CHECK(writeState(p, d, q, w));
  std::string s(buf);
  CHECK(JsonValidator(s).valid());
  CHECK(s.find("\"source\":\"analog\"") != std::string::npos);
  CHECK(s.find("\"wave\":[") != std::string::npos);

  const size_t hexPos = s.find("\"hex\":\"") + 7;
  const size_t hexEnd = s.find('"', hexPos);
  CHECK((hexEnd - hexPos) == 8 * q.maxPoints);

  StateQuery q2;
  q2.epoch = p.estimator().epoch();
  q2.sinceDart = p.estimator().darts();
  q2.historyFrom = p.estimator().historyCount();
  JsonWriter w2(buf, sizeof(buf));
  CHECK(writeState(p, d, q2, w2));
  std::string s2(buf);
  CHECK(JsonValidator(s2).valid());
  CHECK(s2.find("\"hex\":\"\"") != std::string::npos);
  CHECK(s2.find("\"rows\":[]") != std::string::npos);
  CHECK(s2.size() < 2048);

  if (const char* path = std::getenv("TUBEPI_JSON_OUT")) {
    if (FILE* f = std::fopen(path, "w")) {
      std::fputs(s.c_str(), f);
      std::fclose(f);
    }
  }
}

int main() {
  testCutoffs();
  testRctAndApt();
  testJsonWriter();
  testLatticeBias();
  testEstimatorWithIdealBits();
  testAnalogPipelineHealthy();
  testVonNeumannRemovesBias();
  testQuietSourceIsRejected();
  testStuckSourceTripsHealth();
  testPulsePipeline();
  testStateJson();
  std::printf("%d checks, %d failures\n", gChecks, gFailures);
  return gFailures == 0 ? 0 : 1;
}
