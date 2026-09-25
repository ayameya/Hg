#include "Portal.h"

#include <DNSServer.h>
#include <WebServer.h>
#include <WiFi.h>
#include <stdlib.h>
#include <string.h>

#include "Board.h"
#include "generated/index_html.h"

namespace portal {
namespace {

const IPAddress kApIp(192, 168, 4, 1);
const IPAddress kNetmask(255, 255, 255, 0);
const char kLocalName[] = "tg1b.pi";

WebServer server(80);
DNSServer dns;
PortalHooks hooks;
String apAddress;
char jsonBuffer[16384];
uint8_t randomBuffer[tubepi::Pipeline::kRandomBytes];

bool isPortalHost() {
  String host = server.hostHeader();
  const int colon = host.indexOf(':');
  if (colon >= 0) host = host.substring(0, colon);
  return host.length() == 0 || host == apAddress || host.equalsIgnoreCase(kLocalName);
}

void noStore() {
  server.sendHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  server.sendHeader("Pragma", "no-cache");
  server.sendHeader("Expires", "0");
}

void redirectToPortal() {
  noStore();
  server.sendHeader("Location", String("http://") + apAddress + "/", true);
  server.send(302, "text/html", "");
}

void handleRoot() {
  if (!isPortalHost()) {
    redirectToPortal();
    return;
  }
  noStore();
  server.sendHeader("Content-Encoding", "gzip");
  server.send_P(200, "text/html; charset=utf-8", reinterpret_cast<const char*>(kIndexHtmlGz), kIndexHtmlGzLen);
}

uint64_t argU64(const char* name, uint64_t fallback) {
  if (!server.hasArg(name)) return fallback;
  return strtoull(server.arg(name).c_str(), nullptr, 10);
}

void handleState() {
  tubepi::StateQuery query;
  query.epoch = static_cast<uint32_t>(argU64("e", UINT32_MAX));
  query.sinceDart = argU64("s", 0);
  query.historyFrom = static_cast<uint32_t>(argU64("h", 0));
  query.wave = argU64("w", 0) != 0;
  const uint64_t maxPoints = argU64("m", query.maxPoints);
  query.maxPoints = maxPoints > tubepi::PiEstimator::kRecent ? tubepi::PiEstimator::kRecent
                                                              : static_cast<uint32_t>(maxPoints);

  tubepi::JsonWriter out(jsonBuffer, sizeof(jsonBuffer));
  noStore();
  if (!hooks.renderState(query, out)) {
    server.send(500, "application/json", "{\"error\":\"state too large\"}");
    return;
  }
  server.send(200, "application/json", jsonBuffer);
}

void handleReset() {
  hooks.reset();
  noStore();
  server.send(204, "text/plain", "");
}

void handleRandom() {
  const size_t n = hooks.copyRandom(randomBuffer, sizeof(randomBuffer));
  noStore();
  server.sendHeader("Content-Disposition", "attachment; filename=\"tg1b-random.bin\"");
  server.send_P(200, "application/octet-stream", reinterpret_cast<const char*>(randomBuffer), n);
}

void handleNotFound() { redirectToPortal(); }

}

void begin(const PortalHooks& h) {
  hooks = h;
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(kApIp, kApIp, kNetmask);
  const char* password = strlen(TUBEPI_AP_PASSWORD) >= 8 ? TUBEPI_AP_PASSWORD : nullptr;
  WiFi.softAP(TUBEPI_AP_SSID, password, TUBEPI_AP_CHANNEL, 0, TUBEPI_AP_MAX_CLIENTS);
  apAddress = WiFi.softAPIP().toString();

  dns.start(53, "*", WiFi.softAPIP());

  server.on("/", HTTP_GET, handleRoot);
  server.on("/index.html", HTTP_GET, handleRoot);
  server.on("/api/state", HTTP_GET, handleState);
  server.on("/api/reset", HTTP_POST, handleReset);
  server.on("/random.bin", HTTP_GET, handleRandom);
  server.onNotFound(handleNotFound);
  server.begin();
}

void handle() {
  dns.processNextRequest();
  server.handleClient();
}

uint32_t clients() { return WiFi.softAPgetStationNum(); }

const char* address() { return apAddress.c_str(); }

}
