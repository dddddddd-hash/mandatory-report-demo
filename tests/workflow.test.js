import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const testData = fs.mkdtempSync(path.join(os.tmpdir(), "mandatory-workflow-"));
process.env.DATA_DIR = testData;
process.env.FREE_API_KEY = "test-only";
process.env.AI_CATALOG_ENABLED = "0";
const { server } = await import("../server.js");
test("报告、人工复核、监督摘要和部门隔离", async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const call = async (url, data, role = "公安") => { const r = await fetch(base + url, { method: data ? "POST" : "GET", headers: { "Content-Type": "application/json", "X-Demo-Role": encodeURIComponent(role) }, body: data ? JSON.stringify(data) : undefined }); return { status: r.status, data: await r.json() }; };
  try {
    for (const type of ["性侵害", "身体虐待", "拐卖", "遗弃", "暴力伤害"]) {
      const assessment = await call("/api/assess", { types: [type], description: "虚构线索" });
      assert.equal(assessment.data.tag, "A", type);
      assert.equal(assessment.data.risk, "高", type);
    }
    const payload = { identity: "教师/教育工作者", types: ["身体虐待"], region: "演示省", address: "虚构学校", occurredAt: new Date().toISOString(), age: "7-13岁", description: "虚构演示身体虐待线索", consent: true, reporter: {}, attachment: { name: "demo.txt", mime: "text/plain", data: Buffer.from("demo").toString("base64") } };
    assert.equal((await call("/api/reports", { ...payload, consent: false })).status, 400);
    const submitted = await call("/api/reports", payload); assert.equal(submitted.status, 201); const id = submitted.data.id; const target = "/api/reports/" + id;
    let detail = (await call(target)).data; assert.equal(detail.ai.tag, "A"); assert.equal(detail.confirmedTag, null); assert.equal(Date.parse(detail.deadline) - Date.parse(detail.receivedAt), 86400000);
    assert.equal((await call(target, null, "教育")).status, 404);
    assert.equal((await call("/api/receipt", { id, receipt: submitted.data.receipt })).status, 200);
    assert.equal((await call("/api/receipt", { id, receipt: "wrong" })).status, 404);
    assert.equal((await call(target + "/action", { action: "status", status: "已受理", note: "demo" })).status, 400);
    await call(target + "/action", { action: "review", tag: "A", note: "人工核实演示" });
    await call(target + "/action", { action: "simulate" });
    const summary = (await call(target, null, "检察院")).data; assert.equal(summary.supervision[0].reason, "超期未处置"); assert.equal(summary.description, undefined); assert.equal(summary.reporter, undefined);
    await call(target + "/action", { action: "status", status: "已受理", note: "受理" });
    await call(target + "/action", { action: "status", status: "初查", note: "初查" });
    await call(target + "/action", { action: "status", status: "不予立案", note: "演示决定" });
    assert.ok((await call(target, null, "检察院")).data.supervision.some(s => s.reason === "不予立案"));
    await call(target + "/action", { action: "review", tag: "B", note: "核实为帮扶风险" });
    await call(target + "/action", { action: "divert", department: "教育", note: "脱敏帮扶摘要" });
    const help = (await call(target, null, "教育")).data; assert.equal(help.description, "脱敏帮扶摘要"); assert.equal(help.reporter, undefined); assert.equal(help.attachment, undefined); assert.equal(help.address, undefined);
    assert.equal((await call(target, null, "民政")).status, 404);
    assert.equal((await call(target + "/action", { action: "review", tag: "A", note: "demo" }, "教育")).status, 403);
    await call(target + "/action", { action: "help", note: "完成演示帮扶" }, "教育");
    await call(target + "/action", { action: "upgrade", note: "发现新的侵害信号" }, "教育");
    detail = (await call(target)).data; assert.equal(detail.status, "待受理"); assert.equal(detail.confirmedTag, null); assert.equal(detail.helpRecords.length, 2);
    const attachment = await fetch(base + target + "/attachment"); assert.equal(await attachment.text(), "demo");
    assert.ok((await call("/api/logs")).data.some(l => l.reportId === id));
  } finally { await new Promise(resolve => server.close(resolve)); fs.unlinkSync(path.join(testData, "database.json")); fs.rmdirSync(testData); }
});
