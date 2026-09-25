#pragma once

#include <stddef.h>
#include <stdint.h>

#include <TubePi.h>

struct PortalHooks {
  bool (*renderState)(const tubepi::StateQuery& query, tubepi::JsonWriter& out);
  size_t (*copyRandom)(uint8_t* out, size_t max);
  void (*reset)();
};

namespace portal {

void begin(const PortalHooks& hooks);
void handle();
uint32_t clients();
const char* address();

}
