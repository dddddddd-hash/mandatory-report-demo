import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readEvents } from "../public/event-stream.js";
import { canonicalModelId, displayModelName } from "../public/model-brand.js";

test("分密钥发现模型、去重与厂商图标、正确路由和流式回退边界", async () => {
  const calls = []; let partialFailure = false, queued = true;
  const tokens = ["model-test-primary", "model-test-two", "model-test-three", "model-test-four"];
  const primary = http.createServer(async (req, res) => {
    if (req.url === "/v1/models") {
      assert.equal(req.headers.authorization, "Bearer " + tokens[2]);
      const ids = ["[镜像]gpt-6-sol①", "deepseek-v4", "[备用]deepseek-v4②", "[镜像]gemini-3.8-flash", "[故人情]gemini-3.8-flash",
        "[新]gpt-5.4①", "[新]gemini-4-argon③", "[新]claude-5-opus㉗", "[新]claude-fable-5", "[新]claude-fable-5.1", "[新]claude-4.8-opus", "[新]glm-5.2②"];
      res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ data: ids.map(id => ({ id })) }));
    }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    calls.push({ channel: "primary", authorization: req.headers.authorization, model: body.model, stream: body.stream, path: req.url });
    if (req.headers.authorization === "Bearer " + tokens[2]) {
      res.writeHead(200, { "Content-Type": "text/event-stream" }); return res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: "路由正确" } }] }) + '\n\ndata: [DONE]\n\n');
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "原有通道正确" } }] }));
  });
  const secondary = http.createServer(async (req, res) => {
    const auth = req.headers.authorization;
    if (req.url === "/v1/models") {
      const ids = auth === "Bearer " + tokens[1] ? ["gpt-6-sol", "gpt-6-astra", "image-test"] : [];
      res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ data: ids.map(id => ({ id })) }));
    }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    calls.push({ channel: "secondary", authorization: auth, model: body.model, stream: body.stream, path: req.url });
    if (body.model === "gpt-6-sol" && auth === "Bearer " + tokens[1] && !partialFailure) {
      res.writeHead(429, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { message: "private upstream error" } }));
    }
    if (body.model === "gpt-6-astra" && queued) {
      queued = false; res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "0.01" }); return res.end(JSON.stringify({ error: { code: "concurrency_queued" } }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: "路由正确" } }] }) + '\n\n');
    if (partialFailure) return res.end('data: ' + JSON.stringify({ error: { message: "private upstream error" } }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
  await Promise.all([primary, secondary].map(s => new Promise(resolve => s.listen(0, "127.0.0.1", resolve))));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mandatory-models-"));
  process.env.DATA_DIR = dir; process.env.AI_CATALOG_ENABLED = "1";
  process.env.AI_BASE_URL = "http://127.0.0.1:" + primary.address().port;
  process.env.AI_SECONDARY_BASE_URL = "http://127.0.0.1:" + secondary.address().port + "/v1";
  process.env.AI_KEY_3_BASE_URL = process.env.AI_BASE_URL;
  [process.env.FREE_API_KEY, process.env.FREE_API_KEY_2, process.env.FREE_API_KEY_3, process.env.FREE_API_KEY_4] = tokens;
  const { server } = await import("../server.js");
  const { complete, aiConfig } = await import("../ai.js");
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (url, body) => fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    const config = aiConfig(); assert.equal(config.models.length, 9);
    assert.equal(config.channels[0].modelCount, 2); assert.equal(config.channels[1].modelCount, 12); assert.equal(config.channels[2].state, "empty");
    assert.deepEqual(config.models.filter(m => m.brand === "claude").map(m => canonicalModelId(m.id)), ["claude-5-opus", "claude-fable-5"]);
    assert.ok(config.models.filter(m => m.brand === "claude").every(m => m.icon === "/assets/Claude.svg"));
    assert.ok(config.models.some(m => canonicalModelId(m.id) === "glm-5.2"));
    for (const removed of ["gpt-5.4", "gemini-4-argon", "claude-fable-5.1", "claude-4.8-opus"]) {
      assert.ok(!config.models.some(m => canonicalModelId(m.id) === removed));
      await assert.rejects(complete("fuka:[新]" + removed, []), /请选择/);
    }
    assert.equal(config.models.filter(m => m.id === "jianzhile:gpt-6-sol").length, 1);
    const gpt = config.models.filter(m => m.brand === "openai");
    assert.equal(gpt.length, 2); assert.ok(gpt.every(m => m.icon === "/assets/OpenAI.svg"));
    assert.equal(config.models.find(m => m.id === "fuka:deepseek-v4").icon, "/assets/deepseek.svg");
    assert.equal(config.models.filter(m => m.name === "Gemini 3.8 Flash").length, 1);
    assert.equal(canonicalModelId("[奇异果]claude-4.6-opus-thinking㉗"), "claude-4.6-opus-thinking");
    assert.notEqual(canonicalModelId("claude-4.6-opus-thinking"), canonicalModelId("claude-4.6-opus"));
    assert.equal(displayModelName("[鸢尾花]gemini-3.1-pro-preview-search②"), "Gemini 3.1 Pro Preview Search");
    const publicConfig = JSON.stringify(config); assert.ok(tokens.every(token => !publicConfig.includes(token))); assert.ok(!publicConfig.includes('"key"'));
    assert.equal(await complete("[故人情]gemini-3.8-flash", [{ role: "user", content: "虚构测试" }]), "原有通道正确");
    assert.equal(calls.at(-1).authorization, "Bearer " + tokens[0]);
    const session = await (await post("/api/sessions", { kind: "qa", learnerId: "public", model: "jianzhile:gpt-6-sol" })).json();
    const response = await post("/api/sessions/" + session.id + "/messages", { learnerId: "public", model: session.model, content: "虚构测试", stream: true });
    let done; await readEvents(response.body, e => { if (e.event === "done") done = JSON.parse(e.data); });
    assert.equal(done.messages.at(-1).content, "路由正确"); assert.equal(done.messages.at(-1).model, session.model);
    const requests = calls.filter(c => c.stream); assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(c => c.authorization), ["Bearer " + tokens[1], "Bearer " + tokens[2]]);
    assert.deepEqual(requests.map(c => c.channel), ["secondary", "primary"]);
    assert.deepEqual(requests.map(c => c.model), ["gpt-6-sol", "[镜像]gpt-6-sol①"]);
    assert.ok(requests.every(c => c.path === "/v1/chat/completions" && c.stream));
    assert.equal(await complete("jianzhile:gpt-6-astra", [{ role: "user", content: "排队重试" }], () => {}), "路由正确");
    assert.equal(calls.filter(c => c.model === "gpt-6-astra").length, 2, "遵循 Retry-After 有限重试");
    const before = calls.length; partialFailure = true;
    await assert.rejects(complete(session.model, [{ role: "user", content: "中断测试" }], () => {}), /中断/);
    assert.equal(calls.length, before + 1, "已经输出片段后不得切通道拼接重复答案");
    await assert.rejects(complete("not-registered", []), /请选择/);
    assert.match((await fetch(base + "/assets/OpenAI.svg")).headers.get("content-type"), /image\/svg\+xml/);
    assert.match((await (await fetch(base + "/assets/OpenAI.svg")).text()), /<title>OpenAI<\/title>/);
  } finally {
    server.closeAllConnections(); primary.closeAllConnections(); secondary.closeAllConnections();
    await Promise.all([server, primary, secondary].map(s => new Promise(resolve => s.close(resolve))));
    fs.unlinkSync(path.join(dir, "database.json")); fs.rmdirSync(dir);
  }
});
