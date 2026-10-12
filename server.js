import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { handlePortal } from "./portal-api.js";
import { attachActor, handleAuth } from "./auth.js";
import { handleDrafts } from "./draft-api.js";
const root = path.dirname(fileURLToPath(import.meta.url));
const dir = process.env.DATA_DIR || path.join(root, "data");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, "database.json");
let db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { reports: [], logs: [] };
const save = () => { const temp = file + ".tmp"; fs.writeFileSync(temp, JSON.stringify(db, null, 2)); fs.renameSync(temp, file); };
if (!db.accountSchemaVersion) {
  if (fs.existsSync(file)) { const backupDir = path.join(dir, "backups"); fs.mkdirSync(backupDir, { recursive: true }); fs.copyFileSync(file, path.join(backupDir, "before-accounts-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json")); }
  db.accountSchemaVersion = 1; save();
}
const log = (role, action, id) => { db.logs.push({ id: crypto.randomUUID(), role, action, reportId: id, time: new Date().toISOString() }); save(); };
const departments = ["民政", "教育", "妇联"];
const roles = ["公安", ...departments, "检察院"];
const required = ["identity", "region", "address", "occurredAt", "age", "description"];
function assess(body) {
  const severe = /身体虐待|性侵害|家庭暴力|暴力伤害|自杀|自残|遗弃|拐卖|组织乞讨/.test((body.types || []).join(" ") + body.description);
  const help = /忽视|照料|情感|精神|困难/.test((body.types || []).join(" ") + body.description);
  return { tag: severe ? "A" : help ? "B" : "C", risk: severe ? "高" : help ? "中" : "待核实", threshold: severe ? "出现疑似侵害信号，建议立即报告并人工核实" : help ? "需核实是否存在疑似侵害或当前危险，不能仅凭帮扶标签排除报告义务" : "信息不足，需核实侵害或危险信号", infringement: (body.types || []).join("、") || "待核实", reason: severe ? "描述或事件类型含侵害风险信号，建议优先人工核实。" : help ? "含照料或情绪风险信号，建议核实后评估帮扶需求。" : "现有信息不足，请人工核实事件性质与未成年人当前安全。", evidence: ["保存原始聊天、照片或视频及时间信息", "记录事件地点、经过和可联系的见证人", "避免反复问询或传播未成年人隐私"], mock: true };
}
function supervise() {
  let changed = false;
  for (const r of db.reports) {
    if (r.confirmedTag !== "A") continue;
    const reasons = [];
    if (Date.now() > Date.parse(r.deadline) && ["待受理", "已受理", "初查"].includes(r.status)) reasons.push("超期未处置");
    if (r.status === "不予立案") reasons.push("不予立案");
    for (const reason of reasons) if (!r.supervision.some(s => s.reason === reason)) { r.supervision.push({ reason, time: new Date().toISOString() }); changed = true; db.logs.push({ id: crypto.randomUUID(), role: "系统", action: "自动推送检察监督：" + reason, reportId: r.id, time: new Date().toISOString() }); }
  }
  if (changed) save();
}
function view(r, role) {
  if (role === "公安") return { ...r, attachment: r.attachment ? { name: r.attachment.name, mime: r.attachment.mime } : null };
  if (role === "检察院") return { id: r.id, receivedAt: r.receivedAt, status: r.status, supervision: r.supervision };
  return { id: r.id, types: r.types, age: r.age, region: r.region, occurredAt: r.occurredAt, description: r.helpSummary, status: r.status, department: r.department, helpRecords: r.helpRecords, receivedAt: r.receivedAt };
}
const accessible = (r, role) => role === "公安" || (role === "检察院" ? r.supervision.length > 0 : r.department === role);
function reply(res, status, value) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); }
async function body(req) { let chunks = []; let size = 0; for await (const c of req) { size += c.length; if (size > 15 * 1024 * 1024) throw new Error("请求过大，附件最多10MB"); chunks.push(c); } return JSON.parse(Buffer.concat(chunks).toString() || "{}"); }
export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const role = decodeURIComponent(req.headers["x-demo-role"] || "%E5%85%AC%E5%AE%89");
    if (url.pathname.startsWith("/api/")) {
      if (!["GET", "HEAD"].includes(req.method) && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return reply(res, 403, { error: "请求来源无效" });
      attachActor(req, res, db, save);
      if (!url.pathname.startsWith("/api/auth/") && req.headers["x-record-owner"] && req.headers["x-record-owner"] !== req.actor.ownerId) return reply(res, 409, { error: "登录状态已改变，请刷新页面后继续" });
      if (await handleAuth(req, res, url, db, save, body, reply)) return;
      if (await handleDrafts(req, res, url, db, save, body, reply)) return;
      if (await handlePortal(req, res, url, db, save, body, reply)) return;
      if (url.pathname === "/api/my-reports" && req.method === "GET") return reply(res, 200, db.reports.filter(r => r.ownerId === req.actor.ownerId).map(({ id, status, receivedAt }) => ({ id, status, receivedAt })));
      if (!roles.includes(role)) return reply(res, 403, { error: "无效演示部门" });
      supervise();
      if (url.pathname === "/api/assess" && req.method === "POST") return reply(res, 200, assess(await body(req)));
      if (url.pathname === "/api/reports" && req.method === "POST") {
        const b = await body(req);
        if (req.actor.authenticated) { b.identity = req.actor.user.identity; b.identityOther = req.actor.user.identityOther; }
        if (!b.consent || required.some(k => typeof b[k] !== "string" || !b[k].trim()) || !Array.isArray(b.types) || !b.types.length || b.types.some(t => typeof t !== "string") || !Number.isFinite(Date.parse(b.occurredAt))) return reply(res, 400, { error: "请填写全部必填项并确认重要提示" });
        if (b.identity === "其他" && !b.identityOther?.trim() || b.types.includes("其他") && !b.typeOther?.trim()) return reply(res, 400, { error: "请补充其他身份或事件说明" });
        let attachment = null;
        if (b.attachment) {
          const a = b.attachment;
          if (typeof a.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data) || !a.name || !["image/png", "image/jpeg", "image/webp", "video/mp4", "application/pdf", "text/plain"].includes(a.mime)) return reply(res, 400, { error: "附件支持PNG、JPG、WebP、MP4、PDF、TXT" });
          if (Buffer.from(a.data, "base64").length > 10 * 1024 * 1024) return reply(res, 400, { error: "附件最多10MB" });
          attachment = { name: String(a.name).slice(0, 200), mime: a.mime, data: a.data };
        }
        const now = new Date(); const id = "CL-" + now.toISOString().slice(0,10).replaceAll("-", "") + "-" + crypto.randomBytes(3).toString("hex").toUpperCase(); const receipt = crypto.randomBytes(24).toString("hex");
        const r = { id, receipt, ...Object.fromEntries(required.map(k => [k, b[k].trim().slice(0, 10000)])), identityOther: b.identityOther || "", typeOther: b.typeOther || "", types: b.types, reporter: { name: b.reporter?.name || "", organization: b.reporter?.organization || "", phone: b.reporter?.phone || "" }, anonymous: !b.reporter?.name?.trim() && !b.reporter?.phone?.trim(), obligated: ["教师/教育工作者", "医护人员", "社区工作人员"].includes(b.identity), attachment, receivedAt: now.toISOString(), deadline: new Date(now.getTime() + 86400000).toISOString(), ai: assess(b), confirmedTag: null, status: "待受理", department: null, helpSummary: "", helpRecords: [], supervision: [] };
        r.ownerId = req.actor.ownerId;
        db.reports.unshift(r); log("公众", "提交线索，接收工作台开始24小时计时", id); return reply(res, 201, { id, receipt, receivedAt: r.receivedAt, status: r.status });
      }
      if (url.pathname === "/api/receipt" && req.method === "POST") { const b = await body(req); const r = db.reports.find(r => r.id === b.id && r.receipt === b.receipt); return r ? reply(res, 200, { id: r.id, status: r.status, receivedAt: r.receivedAt }) : reply(res, 404, { error: "记录不存在或查询凭证不正确" }); }
      if (url.pathname === "/api/reports" && req.method === "GET") { const reports = db.reports.filter(r => accessible(r, role)).map(r => view(r, role)); log(role, "查看线索列表", null); return reply(res, 200, reports); }
      if (url.pathname === "/api/logs" && req.method === "GET") return role === "公安" ? reply(res, 200, db.logs.slice(-200).reverse()) : reply(res, 403, { error: "仅公安可查看全量日志" });
      const match = url.pathname.match(new RegExp("^/api/reports/([^/]+)(?:/(attachment|action))?$"));
      if (match) {
        const r = db.reports.find(r => r.id === match[1]);
        if (!r || !accessible(r, role)) return reply(res, 404, { error: "线索不存在或当前部门无权查看" });
        if (match[2] === "attachment" && req.method === "GET") {
          if (role !== "公安" || !r.attachment) return reply(res, 403, { error: "无权查看附件" });
          log(role, "查看附件", r.id); res.writeHead(200, { "Content-Type": r.attachment.mime, "X-Content-Type-Options": "nosniff", "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(r.attachment.name) }); return res.end(Buffer.from(r.attachment.data, "base64"));
        }
        if (match[2] === "action" && req.method === "POST") {
          const b = await body(req); const note = typeof b.note === "string" ? b.note.trim().slice(0, 10000) : "";
          if (role === "公安") {
            if (b.action === "review") { if (!["A", "B", "C"].includes(b.tag) || !note) return reply(res, 400, { error: "请选择标签并填写复核依据" }); r.confirmedTag = b.tag; }
            else if (b.action === "simulate") { r.deadline = new Date(Date.now() - 1000).toISOString(); }
            else if (b.action === "failure") { if (!note) return reply(res, 400, { error: "请填写应报未报监督线索摘要" }); r.supervision.push({ reason: "应报未报：" + note, time: new Date().toISOString() }); }
            else if (b.action === "divert") { if (r.confirmedTag !== "B" || !departments.includes(b.department) || !note) return reply(res, 400, { error: "仅人工确认B类后可分流，请填写脱敏帮扶摘要" }); r.department = b.department; r.helpSummary = note; r.status = "分流帮扶"; }
            else if (b.action === "status") {
              const transitions = { "待受理": ["已受理"], "已受理": ["初查"], "初查": ["已立案", "不予立案", "已归档"], "已立案": ["已归档"], "不予立案": ["已归档"], "分流帮扶": ["已归档"], "已归档": [] };
              if (!r.confirmedTag || !note || !transitions[r.status]?.includes(b.status)) return reply(res, 400, { error: "请先人工复核，按处置流程选择下一状态并填写处置记录" }); r.status = b.status;
            } else return reply(res, 400, { error: "无效操作" });
          } else if (departments.includes(role)) {
            if (!note) return reply(res, 400, { error: "请填写帮扶记录或升级原因" });
            if (b.action === "help") r.helpRecords.push({ department: role, note, time: new Date().toISOString() });
            else if (b.action === "upgrade") { r.helpRecords.push({ department: role, note: "升级回公安：" + note, time: new Date().toISOString() }); r.department = null; r.status = "待受理"; r.confirmedTag = null; r.receivedAt = new Date().toISOString(); r.deadline = new Date(Date.now() + 86400000).toISOString(); }
            else return reply(res, 403, { error: "无权执行该操作" });
          } else return reply(res, 403, { error: "检察端只接收监督摘要" });
          log(role, b.action + (b.tag ? " 标签" + b.tag : "") + (b.status ? " " + b.status : "") + (note ? "：" + note : ""), r.id); supervise(); return reply(res, 200, view(r, role));
        }
        if (!match[2] && req.method === "GET") { log(role, "查看线索详情", r.id); return reply(res, 200, view(r, role)); }
      }
      return reply(res, 404, { error: "接口不存在" });
    }
    const routes = { "/": "login.html", "/login": "login.html", "/login.css": "login.css", "/login.js": "login.js", "/account.js": "account.js", "/ask": "portal.html", "/training": "portal.html", "/learning": "portal.html", "/records": "portal.html", "/ledger": "portal.html", "/report": "report.html", "/receiver": "receiver.html", "/style.css": "style.css", "/portal.css": "portal.css", "/portal.js": "portal.js", "/shell.js": "shell.js", "/report.js": "report.js", "/receiver.js": "receiver.js", "/common.js": "common.js" };
    for (const asset of ["Gemini.svg", "OpenAI.svg", "Claude.svg", "deepseek.svg", "GROK.svg", "GLM.svg", "kimi.svg", "minimax-color.svg", "longcat-bright.svg", "AI.svg"]) routes["/assets/" + asset] = "assets/" + asset;
    routes["/model-brand.js"] = "model-brand.js";
    routes["/event-stream.js"] = "event-stream.js";
    routes["/report-drafts.js"] = "report-drafts.js";
    routes["/report-tags.js"] = "report-tags.js";
    const name = routes[url.pathname];
    if (!name || req.method !== "GET") { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": name.endsWith("html") ? "text/html; charset=utf-8" : name.endsWith("css") ? "text/css; charset=utf-8" : name.endsWith("svg") ? "image/svg+xml" : "application/javascript; charset=utf-8", "X-Content-Type-Options": "nosniff" }); res.end(fs.readFileSync(path.join(root, "public", name)));
  } catch (e) { if (res.headersSent) { if (!res.writableEnded) res.end(); } else reply(res, e.status || 400, { error: e.message }); }
});
if (process.argv[1] === fileURLToPath(import.meta.url)) { server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () => console.log("报告端 http://localhost:" + (process.env.PORT || 3000) + "/report\n接收端 http://localhost:" + (process.env.PORT || 3000) + "/receiver")); setInterval(supervise, 10000).unref(); }
