import crypto from "node:crypto";
import { profiles, units, cases, publicCases, materials, sources, gradeTraining } from "./content.js";
import { aiConfig, complete, defaultModel, qaSystem, feedbackSystem, validateModel } from "./ai.js";
const busy = new Set();
const live = new Map();
const limits = new Map();
const now = () => new Date().toISOString();
const fail = (message, status = 400) => { const e = Error(message); e.status = status; throw e; };
function rateLimit(req, kind) {
  const id = req.socket.remoteAddress + ":" + kind, timestamp = Date.now();
  for (const [key, window] of limits) if (timestamp - window.started >= 600000) limits.delete(key);
  const window = limits.get(id) || { started: timestamp, count: 0 };
  if (window.count >= (kind === "ai" ? 30 : 60)) fail("演示请求较频繁，请稍后再试", 429);
  window.count++; limits.set(id, window);
}
const profile = id => profiles.find(p => p.id === id) || fail("请选择有效的演示身份");
const summary = s => { const { messages, worksheet, feedback, ...rest } = s; return { ...rest, messageCount: messages.length }; };
function worksheetInput(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) fail("请填写实训记录");
  const selection = (key, max) => { if (!Array.isArray(b[key]) || b[key].some(v => !Number.isInteger(v) || v < 0 || v >= max)) fail("实训选项无效"); return [...new Set(b[key])]; };
  const text = value => typeof value === "string" ? value.trim().slice(0, 4000) : "";
  return { risk: selection("risk", 3), communication: selection("communication", 4), evidence: selection("evidence", 4), safety: text(b.safety), reason: text(b.reason), decision: text(b.decision), preserveOriginal: b.preserveOriginal === true, protectPrivacy: b.protectPrivacy === true, report: { location: text(b.report?.location), type: text(b.report?.type), description: text(b.report?.description), confirmFictional: b.report?.confirmFictional === true } };
}
const csvCell = v => { let s = String(v ?? ""); if (/^[\s]*[=+@-]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
function beginStream(res, s, kind, model) {
  const generation = { kind, model, content: "", time: now() };
  live.set(s.id, generation);
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" });
  res.flushHeaders(); res.socket?.setNoDelay(true);
  const emit = (event, data) => { if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  emit("session", { ...s, busy: true, generation });
  const heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(": keepalive\n\n"); }, 15000);
  heartbeat.unref(); res.once("close", () => clearInterval(heartbeat));
  const end = () => { clearInterval(heartbeat); if (!res.destroyed && !res.writableEnded) res.end(); };
  return {
    delta(content) { generation.content += content; emit("delta", { content }); },
    done() { emit("done", { ...s, busy: false, generation: null }); end(); },
    error(error) { emit("error", { error: error.message, session: { ...s, busy: false, generation: null } }); end(); }
  };
}
export async function handlePortal(req, res, url, db, save, body, reply) {
  const p = url.pathname;
  if (!["/api/portal/", "/api/ai/", "/api/sessions", "/api/learning", "/api/units"].some(prefix => p.startsWith(prefix))) return false;
  const send = (status, value) => { reply(res, status, value); return true; };
  db.sessions ||= []; db.learning ||= [];
  if (p === "/api/portal/catalog" && req.method === "GET") return send(200, { profiles, units, cases: publicCases(), materials: materials.map(m => ({ ...m, sources: m.sourceIndexes.map(i => sources[i]) })), sources });
  if (p === "/api/ai/config" && req.method === "GET") return send(200, aiConfig());
  if (p === "/api/sessions" && req.method === "GET") {
    const person = profile(url.searchParams.get("learnerId"));
    return send(200, db.sessions.filter(s => s.learnerId === person.id).map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }
  if (p === "/api/sessions" && req.method === "POST") {
    const b = await body(req); const person = profile(b.learnerId);
    if (!["qa", "training"].includes(b.kind)) fail("无效会话类型");
    const model = validateModel(b.model || defaultModel);
    const scenario = b.kind === "training" ? cases.find(c => c.id === b.caseId) : null;
    if (b.kind === "training" && (!scenario || person.role === "公众")) fail("请先切换教师、医护或社区/村居演示身份");
    rateLimit(req, "create");
    const s = { id: crypto.randomUUID(), learnerId: person.id, kind: b.kind, model, caseId: scenario?.id || null, title: scenario?.title || "新的问答", state: "active", createdAt: now(), updatedAt: now(), messages: scenario ? [{ role: "assistant", content: scenario.opening, origin: "scenario", time: now() }] : [], score: null, feedback: "", feedbackError: null, lastError: null };
    db.sessions.push(s); save(); return send(201, s);
  }
  const match = p.match(/^\/api\/sessions\/([^/]+)(?:\/(messages|reply|finish|feedback|worksheet))?$/);
  if (match) {
    const b = req.method === "POST" ? await body(req) : null;
    const learnerId = b?.learnerId || url.searchParams.get("learnerId"); profile(learnerId);
    const s = db.sessions.find(s => s.id === match[1] && s.learnerId === learnerId);
    if (!s) return send(404, { error: "记录不存在或演示身份不匹配" });
    if (!match[2] && req.method === "GET") return send(200, { ...s, busy: busy.has(s.id), generation: live.get(s.id) || null });
    if (!match[2] && req.method === "DELETE") {
      if (busy.has(s.id)) fail("当前会话正在生成，请稍后删除", 409);
      db.sessions = db.sessions.filter(item => item.id !== s.id); save(); return send(200, { deleted: true });
    }
    if (req.method !== "POST") return send(405, { error: "不支持的请求方法" });
    if (busy.has(s.id)) fail("当前会话正在生成，请等待完成", 409);
    const model = validateModel(b.model || s.model);
    if (match[2] === "worksheet") {
      if (s.kind !== "training" || s.state !== "active") fail("仅进行中的实训可保存填写进度");
      s.worksheet = worksheetInput(b.worksheet); s.updatedAt = now(); save(); return send(200, s);
    }
    if (["messages", "reply"].includes(match[2])) {
      if (s.state === "completed") fail("实训已结束，请开始新的实训");
      if (busy.size >= 3) fail("演示模型服务正在处理其他对话，请稍后再试", 429);
      rateLimit(req, "ai");
      if (match[2] === "messages") {
        if (s.messages.at(-1)?.role === "user") fail("上一条提问尚未获得回复，请使用重试", 409);
        if (typeof b.content !== "string" || !b.content.trim() || b.content.length > 4000) fail("请输入4000字以内的问题");
        if (s.messages.length >= 60) fail("本次会话已达到30轮，请新建会话");
        s.messages.push({ role: "user", content: b.content.trim(), time: now() });
        if (s.kind === "qa" && s.title === "新的问答") s.title = b.content.trim().slice(0, 28);
      } else if (s.messages.at(-1)?.role !== "user") fail("当前没有待重试的提问");
      s.model = model; s.updatedAt = now(); s.lastError = null; save(); busy.add(s.id);
      const stream = b.stream === true ? beginStream(res, s, "message", model) : null;
      try {
        const scenario = cases.find(c => c.id === s.caseId);
        const system = s.kind === "qa" ? qaSystem : `这是完全虚构的未成年人保护沟通实训。你只扮演${scenario.character}，不要扮演导师或透露评分答案。角色背景：${scenario.facts}。用简短自然的中文回应受训者的问题，逐步提供已知事实，不增加新的侵害或真实个人信息。不索取真实姓名、电话、地址，不描写露骨细节。面对诱导问题可以表示不确定；用户问起报告制度时保持角色立场，不给出法律判断。`;
        const content = await complete(model, [{ role: "system", content: system }, ...s.messages.map(({ role, content }) => ({ role, content }))], stream?.delta);
        s.messages.push({ role: "assistant", content, origin: "ai", model, time: now() }); s.updatedAt = now(); save();
        if (stream) { stream.done(); return true; }
        return send(200, s);
      } catch (e) { s.lastError = e.message; s.updatedAt = now(); save(); if (stream) { stream.error(e); return true; } return send(e.status || 502, { error: e.message, sessionId: s.id }); }
      finally { busy.delete(s.id); live.delete(s.id); }
    }
    if (["finish", "feedback"].includes(match[2])) {
      if (s.kind !== "training") fail("仅实训会话可评分");
      if (match[2] === "feedback" && s.feedback) return send(200, s);
      if (busy.size >= 3) fail("演示模型服务正在处理其他对话，请稍后再试", 429);
      rateLimit(req, "ai");
      if (match[2] === "finish") {
        if (s.state === "completed") fail("实训已评分，请查看已有记录", 409);
        if (!s.messages.some(m => m.origin === "ai")) fail("请先与AI角色完成至少一轮真实对话");
        s.worksheet = worksheetInput(b.worksheet);
        const scenario = cases.find(c => c.id === s.caseId);
        s.score = gradeTraining(scenario, s.worksheet, s.messages); s.state = "completed"; s.completedAt = now();
      } else if (!s.score) fail("请先完成实训评分");
      s.model = model; s.feedback = ""; s.feedbackError = null; s.updatedAt = now(); save(); busy.add(s.id);
      const stream = b.stream === true ? beginStream(res, s, "feedback", model) : null;
      try {
        s.feedback = await complete(model, [{ role: "system", content: feedbackSystem }, { role: "user", content: JSON.stringify({ scenario: cases.find(c => c.id === s.caseId).summary, rationale: cases.find(c => c.id === s.caseId).rationale, transcript: s.messages.map(({ role, content }) => ({ role, content })), worksheet: s.worksheet, score: s.score }) }], stream?.delta);
      } catch (e) { s.feedbackError = e.message; }
      finally { busy.delete(s.id); live.delete(s.id); s.updatedAt = now(); save(); }
      if (stream) { stream.done(); return true; }
      return send(200, s);
    }
  }
  if (p === "/api/learning" && req.method === "GET") { const person = profile(url.searchParams.get("learnerId")); return send(200, db.learning.filter(r => r.learnerId === person.id)); }
  if (p === "/api/learning" && req.method === "POST") {
    const b = await body(req); const person = profile(b.learnerId); const material = materials.find(m => m.id === b.materialId && m.roles.includes(person.role));
    if (!material) fail("该材料不适用于当前演示身份");
    let record = db.learning.find(r => r.learnerId === person.id && r.materialId === material.id);
    if (!record) { record = { id: crypto.randomUUID(), learnerId: person.id, materialId: material.id, title: material.title, completedAt: now() }; db.learning.push(record); save(); }
    return send(200, record);
  }
  const lessonMatch = p.match(/^\/api\/learning\/([^/]+)$/);
  if (lessonMatch && req.method === "DELETE") {
    const person = profile(url.searchParams.get("learnerId")); const index = db.learning.findIndex(r => r.id === lessonMatch[1] && r.learnerId === person.id);
    if (index < 0) return send(404, { error: "学习记录不存在" });
    db.learning.splice(index, 1); save(); return send(200, { deleted: true });
  }
  const unitMatch = p.match(/^\/api\/units\/([^/]+)(?:\/(export\.csv))?$/);
  if (unitMatch && req.method === "GET") {
    const unit = units.find(u => u.id === unitMatch[1]); if (!unit) fail("演示单位不存在");
    const people = profiles.filter(person => person.unitId === unit.id);
    const ids = people.map(p => p.id);
    const training = db.sessions.filter(s => s.kind === "training" && ids.includes(s.learnerId)).map(summary);
    const learning = db.learning.filter(r => ids.includes(r.learnerId));
    const rows = [...training.map(s => ({ kind: "实训", learnerId: s.learnerId, title: s.title, state: s.state === "completed" ? "已完成" : "进行中", score: s.score, time: s.completedAt || s.createdAt })), ...learning.map(r => ({ kind: "学习", learnerId: r.learnerId, title: r.title, state: "已完成", score: null, time: r.completedAt }))].sort((a, b) => b.time.localeCompare(a.time));
    if (unitMatch[2]) {
      const header = ["记录类型", "单位", "学员", "岗位", "案例/课程", "完成状态", "总分", "达标", "风险识别", "问询沟通", "报告判断", "证据梳理", "模拟上报", "时间"];
      const data = rows.map(r => { const who = profile(r.learnerId); return [r.kind, unit.name, who.name, who.role, r.title, r.state, r.score?.total ?? "", r.score ? (r.score.passed ? "是" : "否") : "", ...Array.from({ length: 5 }, (_, i) => r.score?.items[i]?.score ?? ""), r.time]; });
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(unit.name + "培训台账.csv"), "Cache-Control": "no-store" });
      res.end("\uFEFF" + [header, ...data].map(row => row.map(csvCell).join(",")).join("\r\n")); return true;
    }
    return send(200, { unit, people, rows, totals: { learners: people.length, completed: training.filter(s => s.state === "completed").length, passed: training.filter(s => s.score?.passed).length, learning: learning.length } });
  }
  return send(404, { error: "接口不存在" });
}
