function parseJsonObject(event, maxBytes = 64 * 1024) {
  const raw = event.body || "{}";
  // Check encoded length first so decoding cannot allocate an unbounded buffer.
  if (Buffer.byteLength(raw, "utf8") > (event.isBase64Encoded ? Math.ceil(maxBytes / 3) * 4 : maxBytes)) {
    return { error: "Request body too large.", statusCode: 413 };
  }
  try {
    const text = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
    if (Buffer.byteLength(text, "utf8") > maxBytes) return { error: "Request body too large.", statusCode: 413 };
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { error: "Request body must be a JSON object.", statusCode: 400 };
    }
    return { payload };
  } catch {
    return { error: "Invalid JSON body.", statusCode: 400 };
  }
}

module.exports = { parseJsonObject };
