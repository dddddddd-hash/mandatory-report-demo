import crypto from "node:crypto";
import { sources } from "./content.js";
const fallbackSources = [...sources,
  { title: "烟台市人民检察院 · 强制报告制度意见（试行）", url: "https://jcy.yantai.gov.cn/art/2020/9/30/art_33553_2867604.html" },
  { title: "浮梁县人民政府 · 九部门强制报告制度意见（试行）", url: "https://www.fuliang.gov.cn/xwjw/fgzc/zcwj/t1003653.shtml" }
];
export const reportTypes = ["身体虐待", "性侵害", "情感/精神虐待", "忽视/疏于照料", "家庭暴力", "暴力伤害", "拐卖", "遗弃", "组织乞讨", "自杀/自残", "其他"];
export const chatTools = [
  { type: "function", function: { name: "prepare_report_draft", description: "根据用户本人提供的案例事实准备报告草稿，供用户点击后进入报告表单检查；不提交报告。存在可描述的线索且用户希望报告时可调用，未知字段留空，不编造。", parameters: { type: "object", properties: { identity: { type: "string", enum: ["未成年本人", "家长/监护人", "教师/教育工作者", "医护人员", "社区工作人员", "其他", ""] }, identityOther: { type: "string" }, types: { type: "array", items: { type: "string", enum: reportTypes } }, typeOther: { type: "string" }, region: { type: "string" }, address: { type: "string" }, occurredAt: { type: "string", description: "用户明确提供的当地时间，格式 YYYY-MM-DDTHH:mm；不明时留空" }, age: { type: "string", enum: ["0-6岁", "7-13岁", "14-17岁", "18岁以上", ""] }, description: { type: "string", description: "根据用户陈述整理事实，区分待核实内容" } }, required: ["description", "types"] } } },
  { type: "function", function: { name: "web_search", description: "联网查找案例或报告制度资料。中等范围：最多5条结果和官方来源摘录；使用泛化关键词，不能发送个人姓名、电话或地址。当前日期由系统提供；引用结果注明来源，失败不可声称已检索。", parameters: { type: "object", properties: { query: { type: "string", description: "概括性检索关键词" } }, required: ["query"] } } },
  { type: "function", function: { name: "remember_user_preference", description: "仅在用户明确说请记住、以后记住等时保存稳定的岗位背景或回答偏好；不保存案例当事人的身份、住址、电话、图片或秘密。", parameters: { type: "object", properties: { preference: { type: "string" } }, required: ["preference"] } } }
];
export function reportDraft(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw Error("报告草稿字段无效");
  const clean = key => typeof fields?.[key] === "string" ? fields[key].trim().slice(0, key === "description" ? 4000 : 300) : "";
  const identity = ["未成年本人", "家长/监护人", "教师/教育工作者", "医护人员", "社区工作人员", "其他"].includes(fields.identity) ? fields.identity : "";
  const date = clean("occurredAt");
  if (!clean("description")) throw Error("需要至少一段来自用户陈述的事件经过，才能准备报告草稿");
  return { id: crypto.randomUUID(), fields: { identity, identityOther: clean("identityOther"), types: Array.isArray(fields.types) ? [...new Set(fields.types.filter(t => reportTypes.includes(t)))] : [], typeOther: clean("typeOther"), region: clean("region"), address: clean("address"), occurredAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) ? date : "", age: ["0-6岁", "7-13岁", "14-17岁", "18岁以上"].includes(fields.age) ? fields.age : "", description: clean("description"), reporter: { name: "", organization: "", phone: "" } }, updatedAt: new Date().toISOString(), scrollY: 0, attachmentName: "", origin: "chat" };
}
const xmlText = value => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, " ").trim();
const official = value => { try { const url = new URL(value); return url.protocol === "https:" && (url.hostname.endsWith(".gov.cn") || url.hostname === "gov.cn") && !url.username && !url.password; } catch { return false; } };
async function fetchText(url, signal, restricted = false) {
  for (let n = 0; n < 3; n++) {
    if (restricted && !official(url)) throw Error("仅获取官方公开来源");
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(8000)]), headers: { "User-Agent": "MandatoryReportDemo/1.0" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) { url = new URL(response.headers.get("location"), url).href; continue; }
    if (!response.ok) throw Error("来源暂不可用");
    const reader = response.body.getReader(); let size = 0, chunks = [];
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) throw Error("来源内容过大"); chunks.push(value); } } finally { await reader.cancel().catch(() => {}); }
    return new TextDecoder().decode(Buffer.concat(chunks));
  }
  throw Error("来源重定向过多");
}
export async function webSearch(query, signal) {
  if (typeof query !== "string" || !query.trim() || query.length > 180 || /\b\d{7,}\b|sk-[A-Za-z0-9]|@/.test(query)) throw Error("请使用不含个人信息或密钥的概括性关键词");
  // Only fixed topic words leave the app; never send the raw case text to search.
  const topics = query.match(/性侵|虐待|拐卖|遗弃|暴力|欺凌|疏于照料|证据|报告流程|保密|教师|医护|社区|法律责任|案例|最新/g) || [];
  query = "未成年人保护 强制报告制度 " + [...new Set(topics)].join(" ");
  let candidates = [], mode = "web-search";
  try {
    const endpoint = process.env.AI_SEARCH_ENDPOINT || "https://www.bing.com/search";
    const url = new URL(endpoint); url.searchParams.set("format", "rss"); url.searchParams.set("q", query.trim() + " site:gov.cn"); url.searchParams.set("mkt", "zh-CN");
    const xml = await fetchText(url.href, signal);
    candidates = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => ({ title: xmlText(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || ""), url: xmlText(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || ""), snippet: xmlText(item.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "").slice(0, 700) })).filter(item => official(item.url)).slice(0, 5);
  } catch (e) { if (signal?.aborted) throw e; }
  if (!candidates.length) { candidates = fallbackSources; mode = "official-source-fallback"; }
  const results = (await Promise.all(candidates.slice(0, 5).map(async item => {
    try { const html = await fetchText(item.url, signal, true); const body = xmlText(html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")); const article = body.search(/第一条\s/); const start = article >= 0 ? article : Math.max(0, body.search(/强制报告|未成年人保护/)); return { ...item, snippet: body.slice(start, start + 1400) }; }
    catch (e) { if (signal?.aborted) throw e; return item.snippet ? item : null; }
  }))).filter(Boolean);
  return { query, strength: "medium", searchedAt: new Date().toISOString(), mode, results, note: mode === "official-source-fallback" ? "全网搜索未返回可用官方结果，本次仅联网读取项目已有官方来源；不是完整全网检索或最新案例检索。" : "结果为网页摘录，不代表已核实全部正文或现行效力。", ...(results.length ? {} : { error: "联网来源暂不可用，请勿声称已查到最新资料" }) };
}
