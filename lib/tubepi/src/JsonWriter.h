#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>

namespace tubepi {

class JsonWriter {
 public:
  JsonWriter(char* buffer, size_t capacity) : buf_(buffer), cap_(capacity) {
    if (cap_ > 0) buf_[0] = '\0';
  }

  bool ok() const { return !overflow_; }
  size_t size() const { return len_; }
  const char* c_str() const { return buf_; }

  JsonWriter& beginObject() {
    separate();
    put('{');
    comma_ = false;
    return *this;
  }

  JsonWriter& endObject() {
    put('}');
    comma_ = true;
    return *this;
  }

  JsonWriter& beginArray() {
    separate();
    put('[');
    comma_ = false;
    return *this;
  }

  JsonWriter& endArray() {
    put(']');
    comma_ = true;
    return *this;
  }

  JsonWriter& key(const char* name) {
    separate();
    quoted(name);
    put(':');
    comma_ = false;
    return *this;
  }

  JsonWriter& string(const char* s) {
    separate();
    quoted(s);
    comma_ = true;
    return *this;
  }

  JsonWriter& boolean(bool v) {
    separate();
    text(v ? "true" : "false");
    comma_ = true;
    return *this;
  }

  JsonWriter& uint(uint64_t v) {
    separate();
    digits(v);
    comma_ = true;
    return *this;
  }

  JsonWriter& fixed(double v, int decimals) {
    separate();
    if (!std::isfinite(v)) {
      text("null");
      comma_ = true;
      return *this;
    }
    if (v < 0.0) {
      put('-');
      v = -v;
    }
    uint64_t scale = 1;
    for (int i = 0; i < decimals; ++i) scale *= 10u;
    const double scaled = v * static_cast<double>(scale) + 0.5;
    if (scaled >= 1.8e19) {
      text("1e19");
      comma_ = true;
      return *this;
    }
    const uint64_t n = static_cast<uint64_t>(scaled);
    digits(n / scale);
    if (decimals > 0) {
      put('.');
      uint64_t frac = n % scale;
      char tmp[20];
      for (int i = decimals - 1; i >= 0; --i) {
        tmp[i] = static_cast<char>('0' + frac % 10u);
        frac /= 10u;
      }
      for (int i = 0; i < decimals; ++i) put(tmp[i]);
    }
    comma_ = true;
    return *this;
  }

  JsonWriter& hexWord(uint32_t v) {
    static const char kHex[] = "0123456789abcdef";
    for (int shift = 28; shift >= 0; shift -= 4) put(kHex[(v >> shift) & 0xFu]);
    return *this;
  }

  JsonWriter& openString() {
    separate();
    put('"');
    return *this;
  }

  JsonWriter& closeString() {
    put('"');
    comma_ = true;
    return *this;
  }

 private:
  void separate() {
    if (comma_) put(',');
  }

  void put(char c) {
    if (len_ + 1 < cap_) {
      buf_[len_++] = c;
      buf_[len_] = '\0';
    } else {
      overflow_ = true;
    }
  }

  void text(const char* s) {
    while (*s) put(*s++);
  }

  void quoted(const char* s) {
    put('"');
    for (; *s; ++s) {
      const char c = *s;
      if (c == '"' || c == '\\') {
        put('\\');
        put(c);
      } else if (static_cast<unsigned char>(c) < 0x20) {
        put(' ');
      } else {
        put(c);
      }
    }
    put('"');
  }

  void digits(uint64_t v) {
    char tmp[21];
    int n = 0;
    do {
      tmp[n++] = static_cast<char>('0' + v % 10u);
      v /= 10u;
    } while (v != 0u);
    while (n > 0) put(tmp[--n]);
  }

  char* buf_;
  size_t cap_;
  size_t len_ = 0;
  bool comma_ = false;
  bool overflow_ = false;
};

}
