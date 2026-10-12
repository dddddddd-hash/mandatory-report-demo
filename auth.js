import crypto from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(crypto.scrypt);
export const identities = ["未成年本人", "家长/监护人", "教师/教育工作者", "医护人员", "社区工作人员", "其他"];
const cookieName = "report_session", visitorCookie = "report_visitor", lifetime = 14 * 24 * 60 * 60 * 1000;
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const safeUser = user => ({ id: user.id, email: user.email, name: user.name, identity: user.identity, identityOther: user.identityOther });
function actor(user, guestId) {
  const ownerId = user ? "account:" + user.id : "guest:" + guestId;
  const role = { "教师/教育工作者": "教师", "医护人员": "医护", "社区工作人员": "社区/村居" }[user?.identity] || "公众";
  return { ownerId, authenticated: !!user, user: user ? safeUser(user) : null, profile: { id: ownerId, name: user?.name || "访客", role, identity: user?.identity || "", identityOther: user?.identityOther || "", unitId: ownerId, unit: "我的培训记录" } };
}
function cookie(req, res, token, name = cookieName, maxAge = lifetime / 1000) {
  const previous = res.getHeader("Set-Cookie") || [];
  res.setHeader("Set-Cookie", [...(Array.isArray(previous) ? previous : [previous]), `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${req.socket.encrypted ? "; Secure" : ""}`]);
}
function issue(req, res, db, save, userId = null) {
  const token = crypto.randomBytes(32).toString("hex");
  db.authSessions ||= [];
  const session = { hash: digest(token), userId, guestId: userId ? null : crypto.randomUUID(), expiresAt: Date.now() + lifetime };
  db.authSessions = db.authSessions.filter(s => s.expiresAt > Date.now()); db.authSessions.push(session); save(); cookie(req, res, token, userId ? cookieName : visitorCookie);
  return session;
}
export function attachActor(req, res, db, save) {
  const cookies = String(req.headers.cookie || "").split(";").map(v => v.trim().split("="));
  const findSession = name => { const token = cookies.find(([key]) => key === name)?.[1]; return /^[a-f0-9]{64}$/.test(token || "") ? db.authSessions?.find(s => s.hash === digest(token) && s.expiresAt > Date.now()) : null; };
  let visitor = findSession(visitorCookie); if (!visitor || visitor.userId) visitor = issue(req, res, db, save);
  const session = findSession(cookieName), user = session?.userId ? db.accounts?.find(u => u.id === session.userId) : null;
  req.visitorSession = visitor; req.authSession = user ? session : visitor; req.actor = actor(user, visitor.guestId);
}
export function publicActor(req) { return { authenticated: req.actor.authenticated, user: req.actor.user, profile: req.actor.profile, ownerId: req.actor.ownerId }; }
export function identityContext(req) { return req.actor.authenticated ? `当前登录用户的报告身份是${req.actor.user.identity}${req.actor.user.identityOther ? "（" + req.actor.user.identityOther + "）" : ""}。请结合该身份解释适用职责和操作；报告草稿的报告者身份使用此注册身份，不根据聊天内容改成其他身份。` : "当前用户未登录，报告身份尚未确定，不推测其岗位或本人身份；案例中的人物身份不等于用户身份。"; }
const attempts = new Map();
function limit(req) {
  const key = req.socket.remoteAddress, time = Date.now();
  for (const [id, window] of attempts) if (time - window.started > 600000) attempts.delete(id);
  const window = attempts.get(key) || { started: time, count: 0 };
  if (++window.count > 60) fail("操作较频繁，请稍后再试", 429); attempts.set(key, window);
}
export async function handleAuth(req, res, url, db, save, body, reply) {
  if (!url.pathname.startsWith("/api/auth/")) return false;
  const send = (status, value) => { reply(res, status, value); return true; };
  if (url.pathname === "/api/auth/me" && req.method === "GET") return send(200, publicActor(req));
  if (req.method !== "POST") return send(405, { error: "不支持的请求方法" });
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) fail("请求来源无效", 403);
  limit(req);
  if (url.pathname === "/api/auth/logout") {
    if (req.authSession.userId) db.authSessions = db.authSessions.filter(s => s.hash !== req.authSession.hash);
    save(); cookie(req, res, "", cookieName, 0); req.actor = actor(null, req.visitorSession.guestId);
    return send(200, publicActor(req));
  }
  const b = await body(req), email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email) || email.includes("..")) fail("请填写格式正确的邮箱");
  db.accounts ||= [];
  let user;
  if (url.pathname === "/api/auth/register") {
    if (!identities.includes(b.identity)) fail("请选择注册身份");
    if (b.identity === "其他" && (typeof b.identityOther !== "string" || !b.identityOther.trim())) fail("请说明您的身份");
    if (db.accounts.some(u => u.email === email)) fail("该邮箱已注册，请直接登录", 409);
    const salt = crypto.randomBytes(16).toString("hex"), hash = await scrypt("123456", salt, 64);
    // Check again after asynchronous hashing to avoid duplicate registrations.
    if (db.accounts.some(u => u.email === email)) fail("该邮箱已注册，请直接登录", 409);
    user = { id: crypto.randomUUID(), email, name: (typeof b.name === "string" ? b.name.trim() : "").slice(0, 60) || email.split("@")[0].slice(0, 60), identity: b.identity, identityOther: b.identity === "其他" ? b.identityOther.trim().slice(0, 100) : "", salt, passwordHash: hash.toString("hex"), createdAt: new Date().toISOString() };
    db.accounts.push(user);
  } else if (url.pathname === "/api/auth/login") {
    user = db.accounts.find(u => u.email === email);
    const value = typeof b.password === "string" && b.password.length <= 100 ? b.password : "";
    const hash = await scrypt(value, user?.salt || "unregistered-account", 64);
    if (!user || !crypto.timingSafeEqual(hash, Buffer.from(user.passwordHash, "hex"))) fail("邮箱或密码不正确", 401);
  } else return send(404, { error: "接口不存在" });
  if (req.authSession.userId) db.authSessions = db.authSessions.filter(s => s.hash !== req.authSession.hash);
  issue(req, res, db, save, user.id); req.actor = actor(user);
  return send(url.pathname.endsWith("register") ? 201 : 200, publicActor(req));
}
