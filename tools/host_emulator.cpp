#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <map>
#include <mutex>
#include <random>
#include <sstream>
#include <string>
#include <thread>

#include "TubePi.h"

namespace {

std::mutex gLock;
tubepi::Pipeline* gPipeline = nullptr;
std::atomic<uint32_t> gLastSampleMs{0};
const auto gStart = std::chrono::steady_clock::now();

uint32_t nowMs() {
  return static_cast<uint32_t>(
      std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - gStart).count());
}

struct Options {
  int port = 8080;
  double rate = 60000.0;
  bool pulse = false;
  double sigma = 60.0;
  std::string web = "web/index.html";
};

void generator(Options opt) {
  std::mt19937_64 rng(std::random_device{}());
  std::normal_distribution<double> gauss(0.0, 1.0);
  const auto tick = std::chrono::milliseconds(10);
  const int perTick = static_cast<int>(opt.rate / 100.0);
  for (;;) {
    {
      std::lock_guard<std::mutex> lock(gLock);
      for (int i = 0; i < perTick; ++i) {
        if (opt.pulse) {
          const double v = 1000.0 + opt.sigma * gauss(rng);
          gPipeline->feedInterval(static_cast<uint32_t>(v < 1 ? 1 : v));
        } else {
          double v = 2048.0 + opt.sigma * gauss(rng);
          v = v < 0 ? 0 : (v > 4095 ? 4095 : v);
          gPipeline->feedAnalog(static_cast<uint16_t>(v));
        }
      }
    }
    gLastSampleMs = nowMs();
    std::this_thread::sleep_for(tick);
  }
}

std::map<std::string, std::string> parseQuery(const std::string& q) {
  std::map<std::string, std::string> out;
  std::stringstream ss(q);
  std::string part;
  while (std::getline(ss, part, '&')) {
    const size_t eq = part.find('=');
    if (eq == std::string::npos) {
      out[part] = "";
    } else {
      out[part.substr(0, eq)] = part.substr(eq + 1);
    }
  }
  return out;
}

void reply(int fd, int code, const char* status, const char* type, const std::string& body,
           const char* extra = "") {
  std::string head = "HTTP/1.1 " + std::to_string(code) + " " + status + "\r\nContent-Type: " + type +
                     "\r\nContent-Length: " + std::to_string(body.size()) +
                     "\r\nCache-Control: no-store\r\nConnection: close\r\n" + extra + "\r\n";
  std::string all = head + body;
  size_t sent = 0;
  while (sent < all.size()) {
    const ssize_t n = ::send(fd, all.data() + sent, all.size() - sent, 0);
    if (n <= 0) break;
    sent += static_cast<size_t>(n);
  }
}

void serve(int fd, const Options& opt) {
  char buf[4096];
  const ssize_t n = ::recv(fd, buf, sizeof(buf) - 1, 0);
  if (n <= 0) return;
  buf[n] = '\0';
  std::string req(buf);
  std::string method = req.substr(0, req.find(' '));
  const size_t p0 = req.find(' ') + 1;
  std::string target = req.substr(p0, req.find(' ', p0) - p0);
  std::string path = target.substr(0, target.find('?'));
  std::string query = target.find('?') == std::string::npos ? "" : target.substr(target.find('?') + 1);

  if (path == "/" || path == "/index.html") {
    std::ifstream f(opt.web, std::ios::binary);
    std::stringstream ss;
    ss << f.rdbuf();
    reply(fd, 200, "OK", "text/html; charset=utf-8", ss.str());
    return;
  }
  if (path == "/api/state") {
    auto q = parseQuery(query);
    tubepi::StateQuery sq;
    if (q.count("e") && !q["e"].empty()) sq.epoch = static_cast<uint32_t>(std::stoul(q["e"]));
    if (q.count("s")) sq.sinceDart = std::stoull(q["s"]);
    if (q.count("h")) sq.historyFrom = static_cast<uint32_t>(std::stoul(q["h"]));
    if (q.count("w")) sq.wave = q["w"] == "1";
    if (q.count("m")) sq.maxPoints = std::min<uint32_t>(tubepi::PiEstimator::kRecent, std::stoul(q["m"]));
    static char json[16384];
    tubepi::JsonWriter w(json, sizeof(json));
    tubepi::DeviceInfo d;
    d.board = "host emulator";
    d.uptimeMs = nowMs();
    d.clients = 1;
    d.idleMs = nowMs() - gLastSampleMs.load();
    bool ok;
    {
      std::lock_guard<std::mutex> lock(gLock);
      ok = tubepi::writeState(*gPipeline, d, sq, w);
    }
    if (!ok) {
      reply(fd, 500, "Internal Server Error", "application/json", "{\"error\":\"state too large\"}");
      return;
    }
    reply(fd, 200, "OK", "application/json", std::string(json, w.size()));
    return;
  }
  if (path == "/api/reset" && method == "POST") {
    std::lock_guard<std::mutex> lock(gLock);
    gPipeline->resetStatistics();
    reply(fd, 204, "No Content", "text/plain", "");
    return;
  }
  if (path == "/random.bin") {
    uint8_t bytes[tubepi::Pipeline::kRandomBytes];
    size_t count;
    {
      std::lock_guard<std::mutex> lock(gLock);
      count = gPipeline->copyRandom(bytes, sizeof(bytes));
    }
    reply(fd, 200, "OK", "application/octet-stream", std::string(reinterpret_cast<char*>(bytes), count),
          "Content-Disposition: attachment; filename=\"tg1b-random.bin\"\r\n");
    return;
  }
  reply(fd, 302, "Found", "text/plain", "", "Location: /\r\n");
}

}

int main(int argc, char** argv) {
  Options opt;
  for (int i = 1; i < argc; ++i) {
    std::string a = argv[i];
    if (a == "--port" && i + 1 < argc) opt.port = std::atoi(argv[++i]);
    else if (a == "--rate" && i + 1 < argc) opt.rate = std::atof(argv[++i]);
    else if (a == "--sigma" && i + 1 < argc) opt.sigma = std::atof(argv[++i]);
    else if (a == "--web" && i + 1 < argc) opt.web = argv[++i];
    else if (a == "--pulse") opt.pulse = true;
  }

  tubepi::PipelineConfig c;
  if (opt.pulse) {
    c.source = tubepi::SourceKind::Pulse;
    c.vonNeumann = false;
    c.assumedEntropy = 1.0;
    c.monitorWindow = 1024;
    c.quietSigma = 2.0;
    c.initialHigh = 20000;
    c.recoverySamples = 256;
  } else {
    c.source = tubepi::SourceKind::Simulated;
    c.assumedEntropy = 2.0;
    c.quietSigma = 4.0;
    c.decimation = 1;
  }
  static tubepi::Pipeline pipeline(c);
  gPipeline = &pipeline;
  std::thread(generator, opt).detach();

  const int server = ::socket(AF_INET, SOCK_STREAM, 0);
  int yes = 1;
  ::setsockopt(server, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_port = htons(static_cast<uint16_t>(opt.port));
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (::bind(server, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0 || ::listen(server, 16) != 0) {
    std::perror("bind/listen");
    return 1;
  }
  std::printf("host emulator: http://127.0.0.1:%d/  (%s, %.0f samples/s, sigma %.1f)\n", opt.port,
              opt.pulse ? "pulse" : "analog", opt.rate, opt.sigma);
  std::fflush(stdout);
  for (;;) {
    const int fd = ::accept(server, nullptr, nullptr);
    if (fd < 0) continue;
    serve(fd, opt);
    ::close(fd);
  }
}
