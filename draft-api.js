import { identities } from "./auth.js";
import { reportTypes } from "./chat-tools.js";
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
export async function handleDrafts(req, res, url, db, save, body, reply) {
  const match = url.pathname.match(/^\/api\/drafts(?:\/([a-f0-9-]{36})(?:\/(attachment))?)?$/i);
  if (!url.pathname.startsWith("/api/drafts")) return false;
  const send = (status, value) => { reply(res, status, value); return true; };
  if (!req.actor.authenticated) return send(401, { error: "请登录后同步账号草稿" });
  if (!match) return send(404, { error: "草稿接口不存在" });
  db.drafts ||= [];
  db.deletedDrafts ||= [];
  const own = d => d.ownerId === req.actor.ownerId;
  const publicDraft = d => { const { ownerId, attachment, ...data } = d; return data; };
  if (!match[1] && req.method === "GET") return send(200, db.drafts.filter(own).map(publicDraft));
  let draft = db.drafts.find(d => d.id === match[1] && own(d));
  if (!match[2] && req.method === "PUT") {
    const b = await body(req), fields = b.fields;
    if (db.deletedDrafts.some(d => d.id === match[1] && own(d))) return send(410, { error: "草稿已在其他页面删除，请新建线索继续填写" });
    if ((b.revision || 0) !== (draft?.revision || 0)) return send(409, { error: "草稿已在其他页面更新，本页内容已保留在本机，请重新打开草稿后继续" });
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) fail("草稿内容无效");
    const text = (value, size = 4000) => typeof value === "string" ? value.slice(0, size) : "";
    const identity = req.actor.user.identity;
    if (!identities.includes(identity)) fail("账号身份无效");
    const cleaned = { identity, identityOther: req.actor.user.identityOther, types: Array.isArray(fields.types) ? [...new Set(fields.types.filter(t => reportTypes.includes(t)))] : [], typeOther: text(fields.typeOther, 300), region: text(fields.region, 300), address: text(fields.address, 300), occurredAt: text(fields.occurredAt, 30), age: text(fields.age, 30), description: text(fields.description), reporter: { name: text(fields.reporter?.name, 100), organization: text(fields.reporter?.organization, 200), phone: text(fields.reporter?.phone, 30) } };
    if (!draft) { draft = { id: match[1], ownerId: req.actor.ownerId }; db.drafts.push(draft); }
    Object.assign(draft, { fields: cleaned, revision: (draft.revision || 0) + 1, updatedAt: new Date().toISOString(), scrollY: Number.isFinite(b.scrollY) ? Math.max(0, Math.min(b.scrollY, 100000)) : 0, origin: b.origin === "chat" ? "chat" : "form", attachmentName: draft.attachment?.name || "" }); save();
    return send(200, publicDraft(draft));
  }
  if (!draft) return send(404, { error: "草稿不存在或不属于当前账号" });
  if (match[2] === "attachment") {
    if (req.method === "GET") return send(200, draft.attachment || null);
    if (req.method === "PUT") {
      const b = await body(req), a = b.attachment;
      if ((b.revision || 0) !== (draft.revision || 0)) return send(409, { error: "草稿已在其他页面更新，请重新打开后再添加附件" });
      if (a != null && (!a.name || !["image/png", "image/jpeg", "image/webp", "video/mp4", "application/pdf", "text/plain"].includes(a.mime) || typeof a.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data) || Buffer.from(a.data, "base64").length > 10 * 1024 * 1024)) fail("附件格式无效或超过10MB");
      draft.attachment = a ? { name: String(a.name).slice(0, 200), mime: a.mime, data: a.data } : null;
      draft.attachmentName = draft.attachment?.name || ""; draft.revision = (draft.revision || 0) + 1; draft.updatedAt = new Date().toISOString(); save(); return send(200, publicDraft(draft));
    }
  }
  if (!match[2] && req.method === "DELETE") {
    const b = await body(req);
    if ((b.revision || 0) !== (draft.revision || 0)) return send(409, { error: "草稿已在其他页面更新，请刷新记录后再删除" });
    db.deletedDrafts.push({ id: draft.id, ownerId: draft.ownerId, revision: draft.revision, deletedAt: new Date().toISOString() }); db.drafts = db.drafts.filter(d => d !== draft); save(); return send(200, { deleted: true });
  }
  return send(405, { error: "不支持的请求方法" });
}
