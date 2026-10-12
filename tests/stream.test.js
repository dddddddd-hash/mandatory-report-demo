import test from "node:test";
import { sessionClient } from "./support/client.js";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readEvents } from "../public/event-stream.js";

test("SSE 解码保留跨片段 UTF-8、CRLF、多行数据和结束事件", async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\nevent: delta\r\ndata: 你好\r\ndata: 第二行\r\n\r\ndata: [DONE]\n\n');
  const events = [];
  await readEvents(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), e => { events.push(e); });
  assert.deepEqual(events, [{ event: "delta", data: "你好\n第二行" }, { event: "message", data: "[DONE]" }]);
});

test("增量即时传递、刷新进度、完成落库、中断重试、断连恢复和实训流式复盘", async () => {
  let release, mode = "gated", finished = false;
  const gate = new Promise(resolve => { release = resolve; });
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(request.stream, true);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const token = content => res.write('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\r\n\r\n');
    token("你好，");
    if (mode === "gated") await gate;
    if (mode === "interrupted") return res.end();
    if (mode === "delayed") await new Promise(resolve => setTimeout(resolve, 120));
    token("这是完整的虚构测试回复。");
    res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }) + '\n\n');
    finished = true; res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mandatory-stream-"));
  process.env.DATA_DIR = dir; process.env.FREE_API_KEY = "local-test-placeholder";
  process.env.AI_CATALOG_ENABLED = "0";
  process.env.AI_BASE_URL = "http://127.0.0.1:" + upstream.address().port + "/v1";
  const { server } = await import("../server.js");
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port, model = "[故人情]gemini-3.8-flash";
  const fetch = sessionClient(base);
  const post = async (url, body) => fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const get = async (id, learnerId = "public") => (await fetch(base + "/api/sessions/" + id + "?learnerId=" + learnerId)).json();
  const collect = async response => { const events = []; await readEvents(response.body, e => events.push({ event: e.event, value: JSON.parse(e.data) })); return events; };
  const create = async body => (await post("/api/sessions", { kind: "qa", learnerId: "public", model, ...body })).json();
  const message = async (s, extra = {}) => post("/api/sessions/" + s.id + "/messages", { learnerId: s.learnerId, model, content: "完全虚构的协议验证问题", stream: true, ...extra });
  try {
    const qa = await create(), response = await message(qa), deltas = [];
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    assert.match(response.headers.get("cache-control"), /no-transform/);
    await readEvents(response.body, async e => {
      const value = JSON.parse(e.data);
      if (e.event === "delta") {
        deltas.push(value.content);
        if (deltas.length === 1) {
          assert.equal(finished, false, "首段必须在上游完成前到达");
          const progress = await get(qa.id);
          assert.equal(progress.busy, true); assert.equal(progress.generation.content, "你好，");
          const stored = JSON.parse(fs.readFileSync(path.join(dir, "database.json"), "utf8"));
          assert.equal(stored.sessions[0].messages.length, 1, "临时片段不得进入历史上下文");
          const conflict = await message(qa); assert.equal(conflict.status, 409);
          release();
        }
      }
      if (e.event === "done") assert.equal(value.messages.at(-1).content, deltas.join(""));
    });
    assert.equal(deltas.length, 2);
    assert.equal((await get(qa.id)).busy, false);
    mode = "interrupted";
    const interrupted = await create(); const failed = await collect(await message(interrupted));
    assert.equal(failed.at(-1).event, "error"); assert.match(failed.at(-1).value.error, /中断/);
    assert.equal((await get(interrupted.id)).messages.length, 1);
    assert.equal((await get(interrupted.id)).busy, false);
    mode = "normal";
    const retry = await collect(await post("/api/sessions/" + interrupted.id + "/reply", { learnerId: "public", model, stream: true }));
    assert.equal(retry.at(-1).event, "done"); assert.equal((await get(interrupted.id)).messages.length, 2);

    // Refreshing closes the browser stream; the accepted, timeout-bounded generation still saves.
    mode = "delayed";
    const disconnected = await create(), stream = await message(disconnected);
    await stream.body.cancel();
    for (let n = 0; n < 30 && (await get(disconnected.id)).busy; n++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await get(disconnected.id)).messages.at(-1).role, "assistant");
    mode = "normal";
    const training = await create({ kind: "training", learnerId: "teacher-1", caseId: "school-injury" });
    const roleplay = await collect(await message(training)); assert.equal(roleplay.at(-1).event, "done");
    const worksheet = { risk: [0, 1], communication: [0, 1], evidence: [0, 1], safety: "陪伴保护", decision: "report", reason: "疑似侵害应立即报告", report: { confirmFictional: true } };
    const feedback = await collect(await post("/api/sessions/" + training.id + "/finish", { learnerId: "teacher-1", model, worksheet, stream: true }));
    assert.equal(feedback[0].value.state, "completed"); assert.ok(feedback.some(e => e.event === "delta"));
    assert.equal(feedback.at(-1).value.feedback, deltas.join(""));
    assert.equal((await get(training.id, "teacher-1")).busy, false);
    assert.equal((await (await fetch(base + "/api/reports")).json()).length, 0);
    const names = (await (await fetch(base + "/api/ai/config")).json()).models.map(m => m.name);
    assert.ok(names.every(name => name.startsWith("Gemini ")));
    assert.match((await fetch(base + "/assets/Gemini.svg")).headers.get("content-type"), /image\/svg\+xml/);
  } finally {
    release(); server.closeAllConnections(); upstream.closeAllConnections();
    await new Promise(resolve => server.close(resolve)); await new Promise(resolve => upstream.close(resolve));
    fs.unlinkSync(path.join(dir, "database.json")); fs.rmdirSync(dir);
  }
});
