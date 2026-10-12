// Shared SSE decoder. UTF-8 characters and event lines may span network chunks.
export async function readEvents(body, onEvent) {
  if (!body) throw Error("流式响应为空");
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = "", event = "message", data = [], stopped = false;
  const dispatch = async () => {
    if (data.length) stopped = await onEvent({ event, data: data.join("\n") }) === false;
    event = "message"; data = [];
  };
  const line = async value => {
    if (!value) return dispatch();
    if (value.startsWith(":")) return;
    const colon = value.indexOf(":"), field = colon < 0 ? value : value.slice(0, colon);
    let valueText = colon < 0 ? "" : value.slice(colon + 1);
    if (valueText.startsWith(" ")) valueText = valueText.slice(1);
    if (field === "data") data.push(valueText);
    if (field === "event") event = valueText;
  };
  const consume = async final => {
    while (!stopped) {
      const match = /[\r\n]/.exec(buffer);
      if (!match) break;
      const index = match.index;
      if (!final && buffer[index] === "\r" && index === buffer.length - 1) break;
      const length = buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
      const value = buffer.slice(0, index); buffer = buffer.slice(index + length);
      await line(value);
    }
    if (final && !stopped) { if (buffer) await line(buffer); await dispatch(); }
    if (buffer.length > 1024 * 1024) throw Error("流式响应片段过大");
  };
  try {
    while (!stopped) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      await consume(done);
      if (done) break;
    }
  } finally {
    try { await reader.cancel(); } catch { /* The connection may already be closed. */ }
    reader.releaseLock();
  }
}
