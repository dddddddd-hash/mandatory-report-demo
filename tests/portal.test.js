import test from "node:test";
import { sessionClient } from "./support/client.js";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("真实协议代理、失败重试、实训评分、记录归属、单位导出和删除", async () => {
  const requests = []; let failNext = false;
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ path: req.url, body: JSON.parse(Buffer.concat(chunks).toString()) });
    res.writeHead(failNext ? 503 : 200, { "Content-Type": "application/json" });
    if (failNext) { failNext = false; res.end(JSON.stringify({ error: { message: "upstream-private-error" } })); }
    else res.end(JSON.stringify({ choices: [{ message: { content: "测试协议响应：我现在在学校，想得到安全帮助。" } }] }));
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const testData = fs.mkdtempSync(path.join(os.tmpdir(), "mandatory-portal-"));
  process.env.DATA_DIR = testData; process.env.FREE_API_KEY = "test-key-never-public";
  process.env.AI_CATALOG_ENABLED = "0";
  process.env.AI_BASE_URL = "http://127.0.0.1:" + upstream.address().port + "/v1";
  const { server } = await import("../server.js");
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const fetch = sessionClient(base), stranger = sessionClient(base);
  const call = async (url, data, method = data ? "POST" : "GET") => { const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined }); return { status: r.status, data: await r.json() }; };
  const chosen = "[故人情]gemini-3.8-flash";
  try {
    const registration = await call("/api/auth/register", { email: "teacher@example.test", identity: "教师/教育工作者" });
    const unitPath = "/api/units/" + encodeURIComponent(registration.data.profile.unitId);
    const catalog = (await call("/api/portal/catalog")).data; assert.equal(catalog.cases.length, 5); assert.ok(catalog.cases.every(c => c.fictional && !c.facts && !c.expectedRisk));
    const config = (await call("/api/ai/config")).data; assert.equal(config.models.length, 3); assert.equal(config.defaultModel, chosen); assert.ok(!JSON.stringify(config).includes(process.env.FREE_API_KEY));
    assert.equal((await call("/api/sessions", { learnerId: "public", kind: "qa", model: "fake" })).status, 400);
    const qa = (await call("/api/sessions", { learnerId: "public", kind: "qa", model: chosen })).data;
    const qaPath = "/api/sessions/" + qa.id;
    failNext = true;
    const failure = await call(qaPath + "/messages", { learnerId: "public", model: chosen, content: "虚构测试问题" }); assert.equal(failure.status, 502); assert.ok(!failure.data.error.includes("upstream-private-error"));
    let q = (await call(qaPath + "?learnerId=public")).data; assert.equal(q.messages.length, 1); assert.ok(q.lastError);
    q = (await call(qaPath + "/reply", { learnerId: "public", model: "[故人情]gemini-2.5-pro" })).data; assert.equal(q.messages.length, 2); assert.equal(q.lastError, null); assert.equal(requests.at(-1).body.model, "[故人情]gemini-2.5-pro"); assert.equal(requests.at(-1).path, "/v1/chat/completions");
    assert.equal((await stranger(base + qaPath)).status, 404);
    assert.equal((await call("/api/sessions", { learnerId: "public", kind: "training", caseId: "missing", model: chosen })).status, 400);
    const training = (await call("/api/sessions", { learnerId: "teacher-1", kind: "training", caseId: "school-injury", model: chosen })).data;
    const target = "/api/sessions/" + training.id;
    await call(target + "/messages", { learnerId: "teacher-1", model: chosen, content: "你现在安全吗？愿意告诉我发生了什么吗？" });
    const worksheet = { risk: [0, 1], communication: [0, 1], evidence: [0, 1], safety: "在学校安全区域安排教师陪伴，及时保护并联系公安", decision: "report", reason: "发现疑似持续侵害与回家危险，应立即报告，不等待自行调查结束。", preserveOriginal: true, protectPrivacy: true, report: { location: "虚构学校辅导室", type: "身体虐待", description: "【虚构实训】学生出现反复伤痕并表达害怕回家的担忧，目前在学校安全区域由教师陪伴。", confirmFictional: true } };
    assert.equal((await call(target + "/worksheet", { learnerId: "teacher-1", worksheet })).status, 200);
    assert.equal((await call(target + "?learnerId=teacher-1")).data.worksheet.report.location, worksheet.report.location);
    const done = (await call(target + "/finish", { learnerId: "teacher-1", model: chosen, worksheet, score: { total: 999 } })).data; assert.equal(done.score.total, 100); assert.equal(done.score.passed, true); assert.equal(done.score.items.length, 5); assert.ok(done.feedback); assert.equal(done.state, "completed");
    assert.equal((await call(target + "/finish", { learnerId: "teacher-1", worksheet })).status, 409);
    assert.equal((await call("/api/reports")).data.length, 0, "模拟上报不得进入公安队列");
    assert.equal((await call("/api/learning", { learnerId: "teacher-1", materialId: "missing" })).status, 400);
    const lesson = (await call("/api/learning", { learnerId: "teacher-1", materialId: "teacher-duty" })).data;
    assert.equal((await call("/api/learning", { learnerId: "teacher-1", materialId: "teacher-duty" })).data.id, lesson.id);
    const ledger = (await call(unitPath)).data; assert.equal(ledger.totals.completed, 1); assert.equal(ledger.totals.passed, 1); assert.equal(ledger.totals.learning, 1);
    const csv = await (await fetch(base + unitPath + "/export.csv")).text(); assert.ok(csv.includes("风险识别")); assert.ok(csv.includes("100")); assert.ok(!csv.includes("愿意告诉我发生了什么")); assert.ok(!csv.includes(worksheet.report.description));
    const persisted = JSON.parse(fs.readFileSync(path.join(testData, "database.json"), "utf8")); assert.equal(persisted.sessions.length, 2); assert.equal(persisted.sessions[1].score.total, 100); assert.equal(persisted.learning.length, 1);
    assert.equal((await stranger(base + target, { method: "DELETE" })).status, 404);
    await call(target + "?learnerId=teacher-1", null, "DELETE"); await call("/api/learning/" + lesson.id + "?learnerId=teacher-1", null, "DELETE");
    const cleared = (await call(unitPath)).data; assert.equal(cleared.rows.length, 0); assert.equal(cleared.totals.completed, 0);
  } finally {
    await new Promise(resolve => server.close(resolve)); await new Promise(resolve => upstream.close(resolve));
    fs.unlinkSync(path.join(testData, "database.json")); fs.rmdirSync(testData);
  }
});
