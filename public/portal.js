import { api, post, esc, time, toast, icon, openDialog, bindDialog, chatUserId } from "/common.js";
import { mountShell, learnerId, chooseLearner } from "/shell.js";
import { readEvents } from "/event-stream.js";
import { modelBrand, displayModelName } from "/model-brand.js";
import { listDrafts, getDraft, saveDraft, removeDraft } from "/report-drafts.js";
const $ = id => document.getElementById(id);
const page = location.pathname.slice(1) || "ask";
const main = $("portal-main");
let data, config, current = null, generating = false, recent = [], learning = [], filter = "all", pendingDelete = null;
let streamingText = "", streamingKind = "message", streamingModel = "", streamError = false;
let activeRequestId = null, streamController = null, stopRequested = false, stopping = false, stopPromise = null, outgoingText = "", pollVersion = 0;
const quickQuestions = [
  ["教师发现伤痕怎么办？", "学生出现伤痕并害怕回家，教师应该怎么做？"],
  ["证据不充分能报告吗？", "没有完整证据，可以报告疑似侵害吗？"],
  ["匿名报告要注意什么？", "匿名报告需要注意哪些事项？"],
  ["疑似性侵如何保护孩子？", "发现未成年人疑似遭受性侵害，应如何保护孩子并报告？"],
  ["孩子说被虐待怎么回应？", "孩子说自己被虐待，应该如何回应并记录，避免反复问询？"],
  ["发现疑似拐卖怎么办？", "发现疑似拐卖未成年人的线索，应如何报告并保护安全？"],
  ["发现孩子被遗弃怎么办？", "发现未成年人疑似被遗弃，应采取哪些保护和报告措施？"],
  ["暴力伤害后先做什么？", "未成年人遭受暴力伤害时，如何安排紧急求助、就医和报告？"],
  ["照片与聊天记录怎么留存？", "报告疑似侵害时，如何保存照片、聊天记录等原始证据？"]
];
let questionPage = 0, questionTimer, questionAnimation, questionRotating = false;
const questionPages = Math.ceil(quickQuestions.length / 3);
function questionButtons() {
  return quickQuestions.slice(questionPage * 3, questionPage * 3 + 3).map(([label, question]) => `<button data-question="${esc(question)}" type="button">${esc(label)}</button>`).join("");
}
async function rotateQuestions() {
  const target = $("quick-questions");
  if (!target || questionRotating) return;
  questionRotating = true;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    questionAnimation = target.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 0 : 260, easing: "ease-in", fill: "forwards" });
    await questionAnimation.finished;
    if (target !== $("quick-questions") || current) return;
    questionPage = (questionPage + 1) % questionPages;
    target.innerHTML = questionButtons();
    questionAnimation.cancel();
    questionAnimation = target.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 0 : 340, easing: "ease-out" });
    await questionAnimation.finished;
  } catch { /* Navigation or a new conversation cancels the transition. */ }
  finally { questionAnimation = null; questionRotating = false; }
}
function stopQuestions() {
  clearInterval(questionTimer);
  questionAnimation?.cancel();
}
function startQuestions() {
  clearInterval(questionTimer);
  questionTimer = setInterval(() => {
    const area = $("question-carousel");
    if (!area || document.hidden || current || generating || $("chat-input")?.value.trim() || area.matches(":hover") || area.contains(document.activeElement)) return;
    rotateQuestions();
  }, 8000);
}
window.addEventListener("pagehide", stopQuestions);
window.addEventListener("pageshow", () => { if ($("question-carousel")) startQuestions(); });
const query = new URLSearchParams(location.search);
const model = () => $("model-choice")?.value || localStorage.getItem("chosenModel") || config.defaultModel;
const modelName = id => config.models.find(m => m.id === id)?.name || displayModelName(id);
const modelIdentity = id => config.models.find(m => m.id === id) || modelBrand(id);
const modelImage = (id, size = 28, named = false) => { const identity = modelIdentity(id); return `<img src="${esc(identity.icon)}" alt="${named ? esc(identity.brandName) : ""}" width="${size}" height="${size}">`; };
const text = value => esc(value).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/^\s*\* +/gm, "• ").replace(/^#{1,4} (.+)$/gm, "<strong>$1</strong>");
const personUrl = path => path + (path.includes("?") ? "&" : "?") + "learnerId=" + encodeURIComponent(learnerId());
const sessionGet = id => api(personUrl("/api/sessions/" + encodeURIComponent(id)));
const disclaimer = `<div class="legal-notice">AI 仅供辅助参考，不构成法律意见；紧急危险请直接拨打 <strong>110</strong>。请使用虚构信息，保护未成年人隐私。</div>`;
function picker() {
  let selected = localStorage.getItem("chosenModel") || config.defaultModel;
  if (!config.models.some(m => m.id === selected)) selected = config.defaultModel;
  return `<div class="model-picker"><span class="model-picker-label">对话模型</span><input type="hidden" id="model-choice" value="${esc(selected)}"><button type="button" id="model-trigger" class="model-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="model-options">${modelImage(selected, 25)}<span id="model-current-name">${esc(modelName(selected))}</span><svg class="model-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7 5 5 5-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div id="model-menu" class="model-menu" hidden><div class="model-menu-caption">选择对话模型</div><div id="model-options" role="listbox" aria-label="选择对话模型">${config.models.map(m => `<button type="button" role="option" class="model-option" data-model-id="${esc(m.id)}" aria-selected="${m.id === selected}" tabindex="-1">${modelImage(m.id, 26)}<span>${esc(m.name)}</span><span class="model-check" aria-hidden="true">✓</span></button>`).join("")}</div></div></div>`;
}
function intro(title, description, actions = "") { return `<div class="page-intro"><div><div class="eyebrow">强制报告 · 公众服务</div><h1>${title}</h1><p>${description}</p></div>${actions ? `<div class="intro-actions">${actions}</div>` : ""}</div>`; }
function footer() { return `<div class="portal-footer"><span>强制报告智能体 · 让每一条线索被看见</span><span>本地保存 · 虚构演示</span></div>`; }
function closeModelMenu(focus = false) {
  if (!$("model-menu")) return;
  $("model-menu").hidden = true; $("model-trigger").setAttribute("aria-expanded", "false");
  if (focus) $("model-trigger").focus();
}
function setModel(id, persist = true) {
  if (!config.models.some(m => m.id === id)) id = config.defaultModel;
  if ($("model-choice")) {
    $("model-choice").value = id; $("model-current-name").textContent = modelName(id);
    $("model-trigger").title = modelName(id);
    $("model-trigger").setAttribute("aria-label", "对话模型：" + modelName(id));
    $("model-trigger").querySelector("img").src = modelIdentity(id).icon;
    for (const option of $("model-options").children) option.setAttribute("aria-selected", String(option.dataset.modelId === id));
  }
  if (persist) localStorage.setItem("chosenModel", id);
}
function bindModel() {
  const trigger = $("model-trigger"), menu = $("model-menu"); if (!trigger) return;
  const options = [...$("model-options").children];
  const open = index => {
    if (trigger.disabled) return;
    menu.hidden = false; menu.classList.remove("above");
    $("model-options").style.maxHeight = "280px";
    const rect = trigger.getBoundingClientRect(), below = window.innerHeight - rect.bottom - 20, above = rect.top - 28;
    const upwards = below < menu.scrollHeight && above > below;
    menu.classList.toggle("above", upwards);
    $("model-options").style.maxHeight = Math.min(280, Math.max(100, (upwards ? above : below) - 36)) + "px";
    trigger.setAttribute("aria-expanded", "true"); options[index ?? options.findIndex(o => o.dataset.modelId === model())]?.focus({ preventScroll: true });
    options[index ?? options.findIndex(o => o.dataset.modelId === model())]?.scrollIntoView({ block: "nearest" });
  };
  trigger.onclick = () => menu.hidden ? open() : closeModelMenu(true);
  trigger.onkeydown = e => { if (["ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); open(e.key === "ArrowUp" ? options.length - 1 : undefined); } if (e.key === "Escape") closeModelMenu(); };
  for (const [index, option] of options.entries()) {
    option.onclick = () => { setModel(option.dataset.modelId); closeModelMenu(true); if (current?.kind === "qa") updateChat(); };
    option.onkeydown = e => {
      const keys = { ArrowDown: (index + 1) % options.length, ArrowUp: (index - 1 + options.length) % options.length, Home: 0, End: options.length - 1 };
      if (e.key in keys) { e.preventDefault(); options[keys[e.key]].focus(); }
      if (e.key === "Escape") { e.preventDefault(); closeModelMenu(true); }
    };
  }
  trigger.closest(".model-picker").onfocusout = e => { if (e.relatedTarget && !trigger.closest(".model-picker").contains(e.relatedTarget)) closeModelMenu(); };
  setModel(model(), false); trigger.disabled = generating;
}
document.addEventListener("click", e => { if (!e.target.closest(".model-picker")) closeModelMenu(); });
function streamMessageHTML() {
  return `<div class="message assistant streaming-message"><span class="message-avatar">${modelImage(streamingModel || model())}</span><div class="message-body"><div id="streaming-message-text" class="message-text">${streamingText ? text(streamingText) : '<span class="thinking-dots" aria-label="正在等待模型回复"><i></i><i></i><i></i></span>'}</div><div class="message-meta"><span id="streaming-message-status">${streamError ? "回答中断 · 此片段未保存，可重试" : streamingText ? "正在回复…" : "正在思考…"}</span> · ${esc(modelName(streamingModel || model()))}</div></div></div>`;
}
function showDelta(content) {
  if (stopRequested) return;
  streamingText += content;
  const container = $("chat-messages"), follow = container && container.scrollHeight - container.scrollTop - container.clientHeight < 100;
  const target = streamingKind === "feedback" ? $("feedback-stream-text") : $("streaming-message-text");
  if (target) target.innerHTML = text(streamingText);
  if ($("streaming-message-status")) $("streaming-message-status").textContent = "正在回复…";
  if (follow) container.scrollTop = container.scrollHeight;
}
function clearStream() { streamingText = ""; streamError = false; }
async function streamSession(path, payload, kind = "message") {
  clearStream(); streamingKind = kind; streamingModel = payload.model; closeModelMenu();
  streamController = new AbortController();
  const response = await fetch(path, { method: "POST", signal: streamController.signal, headers: { "Content-Type": "application/json", Accept: "text/event-stream", "X-Chat-User": chatUserId() }, body: JSON.stringify({ ...payload, stream: true, ...(kind === "message" ? { requestId: activeRequestId } : {}) }) });
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const result = await response.json(); if (!response.ok) throw Error(result.error || "请求失败"); return result;
  }
  let result;
  await readEvents(response.body, ({ event, data: raw }) => {
    const value = JSON.parse(raw);
    if (event === "session") { if (!stopRequested) { current = value; if (kind === "feedback") renderTraining(); else updateChat(); } }
    else if (event === "delta") showDelta(value.content);
    else if (event === "status") { if (!stopRequested && $("streaming-message-status")) $("streaming-message-status").textContent = value.label; }
    else if (event === "done") { result = value; return false; }
    else if (event === "stopped") { result = { ...value.session, stopped: true, restore: value.restore }; return false; }
    else if (event === "error") { if (!stopRequested) { if (value.session) current = value.session; streamError = true; } throw Error(value.error || "回复中断，请重试"); }
  });
  if (!result) { streamError = true; throw Error("连接中断，回答尚未完成，请重试"); }
  clearStream(); return result;
}
function messagesHTML(s) {
  return s.messages.map(m => `<div class="message ${m.role === "user" ? "user" : "assistant"}"><span class="message-avatar">${m.role === "user" ? "我" : modelImage(m.model || s.model, 28, true)}</span><div class="message-body"><div class="message-text">${text(m.content)}</div>${m.sources?.length ? `<div class="message-sources"><span>联网参考 · 中等范围</span>${m.sources.map(source => `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} ↗</a>`).join("")}<p>${esc(m.searchNote || "")}</p></div>` : ""}<div class="message-meta">${m.origin === "scenario" ? "虚构情景 · 角色开场" : m.role === "user" ? "我的提问" : "AI · " + esc(modelName(m.model || s.model))} · ${time(m.time)}</div></div></div>`).join("") + (s.kind === "qa" && s.reportDraft ? `<section class="chat-report-action"><div><strong>已根据对话整理报告草稿</strong><p>${esc(s.reportDraft.fields.description.slice(0, 100))}</p><small>未知信息留空；进入表单后请核对，尚未提交。</small></div><button type="button" class="primary mini" data-open-report="${esc(s.id)}">检查并填写报告 ↗</button></section>` : "");
}
function composer() { return `<form id="chat-form" class="chat-composer"><label for="chat-input" class="visually-hidden">输入对话内容</label><textarea id="chat-input" rows="1" maxlength="4000" placeholder="描述您的问题；请不要提供真实未成年人的个人信息…"></textarea><div class="composer-bottom"><span>Enter 发送 · Shift + Enter 换行<br>对话会保存到“我的记录”</span><button id="chat-send" class="primary" type="submit">发送 <span aria-hidden="true">↑</span></button></div></form>`; }
function chatCard(training = false) {
  return `<section class="chat-card"><div class="chat-heading"><div><h2 id="chat-title">${training ? esc(data.cases.find(c => c.id === current.caseId).character) : "强制报告助手"}</h2><p id="chat-subtitle">${training ? "与AI角色沟通，逐步了解情形" : "围绕报告判断、证据留存与保护措施提问"}</p></div></div>${training ? `<div class="training-case-note">${esc(data.cases.find(c => c.id === current.caseId).summary)}</div>` : ""}<div id="chat-messages" class="chat-messages" aria-live="polite"></div><div id="chat-retry" class="chat-retry" hidden></div>${composer()}</section>`;
}
function updateChat() {
  if (!$("chat-messages")) return;
  stopQuestions();
  $("chat-messages").innerHTML = current ? messagesHTML(current) : `<div class="chat-welcome"><span class="welcome-symbol">${icon("spark")}</span><h2>先聊聊您遇到的情况。</h2><p>了解什么时候需要报告，以及如何保护、记录和求助。</p><div id="question-carousel" class="question-carousel" aria-live="off"><div id="quick-questions" class="question-examples">${questionButtons()}</div></div></div>`;
  if (!current) startQuestions();
  const retry = $("chat-retry");
  const pending = current?.messages.at(-1)?.role === "user";
  retry.hidden = !(current?.lastError || pending && !generating);
  if (!retry.hidden) retry.innerHTML = `<span>${esc(current.lastError || "上一条提问尚未返回回复，可以重试。")}</span><button type="button" data-retry ${generating ? "disabled" : ""}>重试回复</button>`;
  const canStop = generating && streamingKind === "message";
  $("chat-send").disabled = stopping || (canStop ? !current?.id : generating || pending);
  $("chat-send").textContent = stopping ? "正在停止…" : canStop ? "停止 ■" : "发送 ↑";
  $("chat-send").classList.toggle("stop-generation", canStop);
  if (!stopRequested && (generating || streamError && streamingText) && streamingKind === "message") $("chat-messages").insertAdjacentHTML("beforeend", streamMessageHTML());
  if ($("model-trigger")) $("model-trigger").disabled = generating;
  if (current?.kind === "qa") { $("chat-title").textContent = current.title; $("chat-subtitle").textContent = "当前模型 " + modelName(model()); }
  $("chat-messages").scrollTop = $("chat-messages").scrollHeight;
  resizeComposer();
}
let composerObserver;
function resizeComposer() {
  const input = $("chat-input"); if (!input) return;
  const messages = $("chat-messages"), follow = messages && messages.scrollHeight - messages.scrollTop - messages.clientHeight < 100;
  const style = getComputedStyle(input), border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  input.style.height = "0px";
  const height = input.scrollHeight + border, maximum = parseFloat(style.maxHeight);
  input.style.height = Math.min(maximum, Math.max(parseFloat(style.minHeight), height)) + "px";
  input.style.overflowY = height > maximum ? "auto" : "hidden";
  if (follow) messages.scrollTop = messages.scrollHeight;
}
function bindComposer() {
  $("chat-form").onsubmit = e => { e.preventDefault(); if (generating && streamingKind === "message") stopReply(); else sendMessage(); };
  $("chat-input").oninput = resizeComposer;
  $("chat-input").onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!generating && !current?.lastError) sendMessage(); } };
  composerObserver?.disconnect();
  let previousWidth = 0;
  composerObserver = new ResizeObserver(([entry]) => { if (entry.contentRect.width !== previousWidth) { previousWidth = entry.contentRect.width; resizeComposer(); } });
  composerObserver.observe($("chat-input"));
  resizeComposer();
}
function resumeGeneration(s) {
  if (!s.busy) return;
  const version = ++pollVersion;
  activeRequestId = s.generation?.id || null; outgoingText = s.messages.at(-1)?.role === "user" ? s.messages.at(-1).content : "";
  generating = true; streamingKind = s.generation?.kind || (s.state === "completed" ? "feedback" : "message"); streamingModel = s.model; streamingText = s.generation?.content || "";
  if (s.state === "completed") renderTraining(); else updateChat();
  const id = s.id;
  const poll = async () => {
    if (current?.id !== id || version !== pollVersion || stopRequested) return;
    try { const result = await sessionGet(id); if (version !== pollVersion || stopRequested) return; current = result; if (current.busy) { streamingText = current.generation?.content || ""; if (current.state === "completed") renderTraining(); else updateChat(); setTimeout(poll, 2000); } else { generating = false; clearStream(); if (page === "training" && current.state === "completed") renderTraining(); else updateChat(); } }
    catch { generating = false; updateChat(); }
  };
  setTimeout(poll, 2000);
}
async function refreshRecent() { recent = await api(personUrl("/api/sessions")); if ($("chat-session-list")) renderRecent(); }
function renderRecent() { $("chat-session-list").innerHTML = recent.filter(s => s.kind === "qa").slice(0, 12).map(s => `<button class="session-link ${s.id === current?.id ? "active" : ""}" type="button" data-session="${s.id}"><span>${esc(s.title)}</span></button>`).join("") || `<p class="muted">还没有问答记录</p>`; }
async function qaPage() {
  main.innerHTML = intro("智能问答", "从一个问题开始，了解报告与保护的下一步。", `<button type="button" data-open-memory class="secondary mini">我的记忆</button>` + picker()) + disclaimer + `<div class="chat-layout"><aside class="chat-sessions"><h3>最近的对话</h3><button id="new-chat" type="button" class="secondary">＋ 新建问答</button><div id="chat-session-list" class="chat-session-list"></div></aside>${chatCard()}</div><div class="qa-links"><span>联网检索 · 中等范围 · 尚未接入专用案例库</span><div class="actions"><button type="button" class="text-button mini" data-build-report>从对话整理报告 ↗</button><a href="/report">填写表单 ↗</a></div></div>` + footer();
  bindModel(); bindComposer(); updateChat();
  $("new-chat").onclick = () => { if (generating) return toast("请等待当前回复完成"); clearStream(); current = null; history.replaceState(null, "", "/ask"); $("chat-title").textContent = "强制报告助手"; $("chat-input").value = ""; updateChat(); renderRecent(); };
  await refreshRecent();
  if (query.get("session")) { const s = await sessionGet(query.get("session")); if (s.kind !== "qa") throw Error("会话类型不匹配"); openQA(s); }
  if (query.get("question")) { $("chat-input").value = query.get("question").slice(0, 4000); resizeComposer(); $("chat-input").focus(); }
}
function openQA(s) { clearStream(); current = s; setModel(s.model); history.replaceState(null, "", "/ask?session=" + s.id); updateChat(); renderRecent(); resumeGeneration(s); }
async function sendMessage(retry = false) {
  if (generating) return;
  const content = $("chat-input").value.trim();
  if (!retry && !content) return toast("请先输入对话内容");
  if (!retry && current?.lastError) return toast("请先重试上一条提问");
  clearStream(); streamingKind = "message"; generating = true;
  stopRequested = false; stopping = false; stopPromise = null;
  activeRequestId = crypto.randomUUID(); outgoingText = retry ? current?.messages.at(-1)?.content || "" : content;
  const selected = model();
  streamingModel = selected;
  let beforeCount = current?.messages.length || 0;
  try {
    if (!current) { current = await post("/api/sessions", { kind: "qa", learnerId: learnerId(), model: selected }); history.replaceState(null, "", "/ask?session=" + current.id); }
    beforeCount = current.messages.length;
    if (!retry) { current.messages.push({ role: "user", content, time: new Date().toISOString() }); $("chat-input").value = ""; }
    updateChat();
    const result = await streamSession(`/api/sessions/${current.id}/${retry ? "reply" : "messages"}`, { learnerId: learnerId(), model: selected, content });
    if (!stopRequested) { current = result; if (result.stopped) { $("chat-input").value = result.restore?.content || outgoingText; clearStream(); } }
  } catch (e) { if (!stopRequested) { streamError = !!streamingText; toast(e.message); if (current?.id) { try { current = await sessionGet(current.id); if (!retry && current.messages.length <= beforeCount) $("chat-input").value = content; } catch {} } } }
  finally { if (stopPromise) await stopPromise; generating = false; stopping = false; stopRequested = false; activeRequestId = null; streamController = null; if (current?.messages.at(-1)?.role === "assistant") clearStream(); if (current?.busy) resumeGeneration(current); else updateChat(); if (page === "ask") await refreshRecent(); }
}
async function stopReply() {
  if (!generating || stopping || !current?.id) return;
  stopping = true; stopRequested = true; ++pollVersion;
  const fallback = outgoingText || (current.messages.at(-1)?.role === "user" ? current.messages.at(-1).content : "");
  clearStream(); $("chat-input").value = fallback; updateChat();
  stopPromise = (async () => {
    try {
      const result = await post(`/api/sessions/${current.id}/stop`, { learnerId: learnerId(), requestId: activeRequestId || current.generation?.id });
      current = result.session;
      if ($("chat-input").value === fallback) $("chat-input").value = result.restore?.content || fallback;
      streamController?.abort(); clearStream();
      // A restored page has a polling loop rather than a local send promise.
      if (!streamController) { generating = false; stopping = false; stopRequested = false; activeRequestId = null; updateChat(); }
      $("chat-input").focus(); resizeComposer(); toast(result.completed ? "回复已完成，提问已放回输入框，可继续编辑" : "已停止，原消息已放回输入框，可编辑后重新发送");
    } catch (e) {
      stopRequested = false; stopping = false; toast("停止请求未完成：" + e.message);
      try { current = await sessionGet(current.id); if (current.busy) resumeGeneration(current); } catch {}
      updateChat();
    }
  })();
  await stopPromise;
}
async function openMemory() {
  const memory = await api(personUrl("/api/memory"));
  $("memory-owner").textContent = data.who.name;
  $("memory-long-term").value = memory.longTerm;
  $("memory-short-term").innerHTML = memory.shortTerm.length ? memory.shortTerm.slice().reverse().map(item => `<div class="memory-item"><strong>${esc(item.question)}</strong><p>${esc(item.answer.slice(0, 250))}</p><small>${time(item.updatedAt)}</small></div>`).join("") : `<p class="muted">还没有近期对话记忆。完成问答后会自动保存。</p>`;
  openDialog($("memory-dialog"));
}
async function openReportDraft(value) {
  const existing = getDraft(learnerId(), value.id);
  saveDraft(learnerId(), existing || value);
  location.href = "/report?draft=" + encodeURIComponent(value.id);
}
function trainingListing() {
  clearStream(); current = null;
  main.innerHTML = intro("情景实训", "在虚构情景中练习沟通、判断和报告，完成后获得评分与纠错。", picker()) + disclaimer + (data.who.role === "公众" ? `<div class="soft-callout" style="margin-bottom:20px">实训面向教师、医护和社区村居等义务主体。<button type="button" class="text-button mini" data-become-teacher>切换教师身份体验 ↗</button></div>` : "") + `<div class="case-grid-public">${data.cases.map((c, i) => `<section class="scenario-card"><div class="scenario-top"><span class="scenario-number">情景 ${String(i + 1).padStart(2, "0")}</span><span class="badge subtle">虚构案例</span></div><h2>${esc(c.title)}</h2><p>${esc(c.summary)}</p><div class="case-tags"><span>${esc(c.role)}</span><span>·</span><span>${esc(c.character)}</span><span>· ${c.difficulty}</span></div><button type="button" class="primary" data-start="${c.id}" ${data.who.role === "公众" ? "disabled" : ""}>开始实训 →</button></section>`).join("")}</div>` + footer(); bindModel();
}
const checks = (options, name) => options.map((o, i) => `<label class="checkline"><input type="checkbox" name="${name}" value="${i}">${esc(o)}</label>`).join("");
function worksheetHTML(c) {
  return `<form id="worksheet-form" class="worksheet"><h2>完成五步实训</h2><p>五项各20分，80分达标。沟通和作答共同计分。</p><details open><summary>01 风险识别 <span>20分</span></summary><div class="step-content">${checks(c.riskOptions, "risk")}<label class="field"><span>当前如何保护安全？</span><textarea name="safety" maxlength="4000" placeholder="写明当前危险、保护与陪伴措施"></textarea></label></div></details><details><summary>02 问询沟通 <span>20分</span></summary><div class="step-content">${checks(c.communicationOptions, "communication")}<p class="muted">请在左侧与AI角色实际完成至少一轮沟通。</p></div></details><details><summary>03 报告判断 <span>20分</span></summary><div class="step-content"><label class="field"><span>下一步判断</span><select name="decision" aria-label="下一步判断"><option value="">请选择</option><option value="report">出现疑似侵害或危险，应立即报告</option><option value="wait">等自行调查清楚后再报告</option><option value="none">无需关注或报告</option></select></label><label class="field"><span>判断依据</span><textarea name="reason" maxlength="4000" placeholder="结合当前情形说明，不作犯罪终审"></textarea></label></div></details><details><summary>04 证据梳理 <span>20分</span></summary><div class="step-content">${checks(c.evidenceOptions, "evidence")}<label class="checkline"><input type="checkbox" name="preserveOriginal">保留已有原始材料及时间信息</label><label class="checkline"><input type="checkbox" name="protectPrivacy">避免公开传播可识别信息</label></div></details><details><summary>05 模拟上报 <span>20分</span></summary><div class="step-content"><label class="field"><span>虚构地点</span><input name="reportLocation" maxlength="300" placeholder="例如：虚构学校辅导室"></label><label class="field"><span>疑似事件类型</span><select name="reportType" aria-label="疑似事件类型"><option value="">请选择</option>${[...new Set(data.cases.map(c => c.type))].map(t => `<option>${esc(t)}</option>`).join("")}</select></label><label class="field"><span>客观事件经过</span><textarea name="reportDescription" maxlength="4000" placeholder="记录已有事实、时间和当前安全；区分事实与推测"></textarea></label><label class="checkline"><input type="checkbox" name="confirmFictional">确认仅为虚构实训，模拟上报不发送公安</label></div></details><div class="worksheet-footer"><button type="submit" id="finish-training" class="primary">完成实训，查看评分 →</button><button type="button" id="save-worksheet" class="text-button full-width" style="margin-top:7px">保存填写进度</button><p>分数按固定检查点计算，AI生成复盘解释。演示规则可在后续调整。</p></div></form>`;
}
function getWorksheet() {
  const f = new FormData($("worksheet-form"));
  return { risk: f.getAll("risk").map(Number), communication: f.getAll("communication").map(Number), evidence: f.getAll("evidence").map(Number), safety: f.get("safety"), reason: f.get("reason"), decision: f.get("decision"), preserveOriginal: f.has("preserveOriginal"), protectPrivacy: f.has("protectPrivacy"), report: { location: f.get("reportLocation"), type: f.get("reportType"), description: f.get("reportDescription"), confirmFictional: f.has("confirmFictional") } };
}
function restoreWorksheet(w) {
  if (!w) return;
  const form = $("worksheet-form");
  for (const name of ["risk", "communication", "evidence"]) for (const input of form.querySelectorAll(`[name="${name}"]`)) input.checked = w[name]?.includes(Number(input.value));
  for (const name of ["safety", "reason", "decision"]) form.elements[name].value = w[name] || "";
  for (const name of ["preserveOriginal", "protectPrivacy"]) form.elements[name].checked = !!w[name];
  form.elements.reportLocation.value = w.report?.location || ""; form.elements.reportType.value = w.report?.type || ""; form.elements.reportDescription.value = w.report?.description || ""; form.elements.confirmFictional.checked = !!w.report?.confirmFictional;
}
function scoreHTML(s) {
  return `<section class="training-score"><div class="score-head"><div><div class="eyebrow">实训结果 · 固定检查点评分</div><strong>${s.score.total}<span>/ 100</span></strong></div><span>${s.score.passed ? "✓ 已达标" : "建议再练一次"}<br><small>达标线 80 分</small></span></div><div class="score-items">${s.score.items.map(item => `<div><span>${item.title}</span><b>${item.score}<small> / 20</small></b></div>`).join("")}</div></section>`;
}
function feedbackHTML(s) {
  const active = s.busy || generating && streamingKind === "feedback";
  const content = s.feedback || (active ? streamingText : "");
  return `<section class="feedback-panel"><h2>纠错与复盘</h2>${content || active ? `<span class="badge" style="margin-bottom:14px">AI · ${esc(modelName(s.model))}</span><div id="feedback-stream-text" class="feedback-text">${content ? text(content) : '<span class="thinking-dots" aria-label="正在等待复盘"><i></i><i></i><i></i></span>'}</div>${active ? '<div class="stream-status" role="status">正在生成复盘…</div>' : ""}` : `<div class="portal-error">${esc(s.feedbackError || "尚未生成AI复盘")}<button type="button" class="mini" data-feedback style="margin-left:10px">重试AI复盘</button></div>`}<div class="fixed-feedback">${s.score.items.map(item => `<p><strong>${item.title} · ${item.score}/20：</strong>${esc(item.advice)}</p>`).join("")}</div><p class="muted">本次仅为虚构模拟上报，没有发送公安；AI反馈不构成法律意见。</p></section>`;
}
function renderTraining() {
  const c = data.cases.find(c => c.id === current.caseId);
  if (current.state === "completed") {
    main.innerHTML = intro(c.title + " · 实训复盘", "成绩和完整对话已保存，可在个人记录及单位台账查看。", picker() + `<button type="button" data-back-training class="secondary mini">返回案例</button>`) + disclaimer + scoreHTML(current) + feedbackHTML(current) + `<details class="panel"><summary>查看完整实训对话</summary><div class="chat-messages">${messagesHTML(current)}</div></details>` + footer(); bindModel(); setModel(current.model, false); return;
  }
  main.innerHTML = intro(c.title, "虚构演示 · " + c.role + " · " + c.character, picker() + `<button type="button" data-back-training class="secondary mini">返回案例</button>`) + disclaimer + `<div class="training-layout">${chatCard(true)}${worksheetHTML(c)}</div>` + footer(); bindModel(); setModel(current.model, false); bindComposer(); restoreWorksheet(current.worksheet); updateChat();
  $("worksheet-form").onsubmit = async e => {
    e.preventDefault(); if (generating) return toast("请等待AI回复完成");
    const worksheet = getWorksheet(); current.worksheet = worksheet;
    clearStream(); streamingKind = "feedback"; generating = true; $("finish-training").disabled = $("save-worksheet").disabled = true; $("finish-training").textContent = "正在评分与复盘…"; updateChat();
    try { current = await streamSession(`/api/sessions/${current.id}/finish`, { learnerId: learnerId(), model: model(), worksheet }, "feedback"); }
    catch (e) { toast(e.message); try { current = await sessionGet(current.id); if (current.state === "active") current.worksheet = worksheet; } catch {} }
    finally { generating = false; if (current.busy) resumeGeneration(current); else renderTraining(); }
  };
  $("save-worksheet").onclick = async () => { if (generating) return toast("请等待当前生成完成"); $("save-worksheet").disabled = true; try { current = await post(`/api/sessions/${current.id}/worksheet`, { learnerId: learnerId(), worksheet: getWorksheet() }); toast("填写进度已保存，刷新后可继续"); } catch (e) { toast(e.message); } finally { $("save-worksheet").disabled = false; } };
}
async function trainingPage() { trainingListing(); if (query.get("session")) { current = await sessionGet(query.get("session")); if (current.kind !== "training") throw Error("会话类型不匹配"); renderTraining(); resumeGeneration(current); } else if (query.get("case") && data.who.role !== "公众") await startTraining(query.get("case")); }
async function startTraining(id) { current = await post("/api/sessions", { kind: "training", learnerId: learnerId(), model: model(), caseId: id }); history.replaceState(null, "", "/training?session=" + current.id); renderTraining(); }
async function learningPage() {
  learning = await api(personUrl("/api/learning"));
  const applicable = data.materials.filter(m => m.roles.includes(data.who.role));
  main.innerHTML = intro("普法学习", `为${data.who.role === "公众" ? "公众" : data.who.role + "岗位"}准备的要点、实操问答与短案例。`) + `<div class="legal-notice">材料为内置制度要点，来源可查；短案例均为虚构。当前未接入案例知识库。</div><div class="lesson-grid">${applicable.map(m => { const done = learning.some(r => r.materialId === m.id); return `<section class="lesson-card"><div class="lesson-meta"><span>${m.format} · 约${m.minutes}分钟</span><span class="badge ${done ? "" : "subtle"}">${done ? "已完成" : "待学习"}</span></div><h2>${esc(m.title)}</h2><p>${esc(m.intro)}</p><ul>${m.points.map(p => `<li>${esc(p)}</li>`).join("")}</ul><div class="lesson-qa"><strong>${esc(m.question)}</strong><p>${esc(m.answer)}</p></div><div class="lesson-sources">${m.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a>`).join("")}</div><button type="button" class="${done ? "secondary" : "primary"}" data-learn="${m.id}" ${done ? "disabled" : ""}>${done ? "✓ 学习已记录" : "我已阅读，记录完成"}</button></section>`; }).join("")}</div>` + footer();
}
async function recordsPage() {
  [recent, learning] = await Promise.all([api(personUrl("/api/sessions")), api(personUrl("/api/learning"))]);
  let receipts = []; try { receipts = JSON.parse(localStorage.getItem("reportReceipts") || "[]"); } catch {}
  data.receipts = await Promise.all(receipts.map(async r => { try { return await post("/api/receipt", r); } catch { return { ...r, status: "暂无法查询" }; } }));
  main.innerHTML = intro("我的记录", `${data.who.name}的问答、实训和学习记录；报告草稿与上报回执保存在本浏览器。`, `<button type="button" data-refresh-records class="secondary mini">刷新记录 ↻</button>`) + `<div id="record-filters" class="records-toolbar"></div><div id="record-list" class="portal-records"></div>` + footer(); renderRecords();
}
function renderRecords() {
  let drafts = []; try { drafts = listDrafts(learnerId()); } catch { toast("无法读取报告草稿，请检查浏览器存储设置"); }
  const all = [...recent.map(s => ({ ...s, type: s.kind })), ...learning.map(l => ({ ...l, type: "learning", updatedAt: l.completedAt })), ...data.receipts.map(r => ({ ...r, title: r.id, type: "report", updatedAt: r.receivedAt })), ...drafts.map(d => ({ ...d, title: d.fields.description?.trim().slice(0, 42) || d.fields.types?.join("、") || "未完成的线索", type: "draft" }))].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const labels = { all: "全部", draft: "草稿", qa: "问答", training: "实训", learning: "学习", report: "上报" };
  $("record-filters").innerHTML = Object.entries(labels).map(([key, title]) => `<button type="button" class="${key === filter ? "active" : ""}" data-filter="${key}">${title} ${key === "all" ? all.length : all.filter(s => s.type === key).length}</button>`).join("");
  const shown = all.filter(r => filter === "all" || r.type === filter);
  const draftHTML = r => `<article class="portal-record"><span class="portal-record-icon">${icon("file")}</span><div class="portal-record-info"><h3>${esc(r.title)}</h3><p>报告草稿 · ${time(r.updatedAt)}${r.attachmentName ? " · 含附件" : ""}</p></div><span class="badge amber">未提交</span><div class="actions"><a class="draft-resume" href="/report?draft=${encodeURIComponent(r.id)}">继续填写 ↗</a><button type="button" class="text-button" data-delete-draft="${esc(r.id)}">删除草稿</button></div></article>`;
  $("record-list").innerHTML = shown.map(r => r.type === "draft" ? draftHTML(r) : `<article class="portal-record"><span class="portal-record-icon">${icon(r.type === "qa" ? "spark" : r.type === "training" ? "review" : r.type === "learning" ? "book" : "file")}</span><div class="portal-record-info"><h3>${esc(r.title)}</h3><p>${labels[r.type]} · ${time(r.updatedAt)}${r.model ? " · " + esc(modelName(r.model)) : ""}</p></div><span class="badge ${r.score && !r.score.passed ? "amber" : "subtle"}">${r.type === "report" ? esc(r.status) : r.type === "learning" ? "已完成" : r.score ? r.score.total + "分 · " + (r.score.passed ? "达标" : "未达标") : r.type === "training" ? "进行中" : r.messageCount + "条消息"}</span><div class="actions">${r.type === "qa" || r.type === "training" ? `<button type="button" data-open-record="${r.id}">查看</button>${r.type === "training" || r.state !== "completed" ? `<a href="/${r.type === "qa" ? "ask" : "training"}?session=${r.id}">${r.state === "completed" ? "复盘" : "继续"} ↗</a>` : ""}<button type="button" class="text-button" data-delete-session="${r.id}">删除</button>` : r.type === "learning" ? `<a href="/learning">查看材料 ↗</a><button type="button" class="text-button" data-delete-learning="${r.id}">删除记录</button>` : `<a href="/report">报告表单 ↗</a>`}</div></article>`).join("") || `<div class="empty">${icon("inbox")}<h3>这里还没有记录</h3><p class="muted">开始一次问答、实训或学习后，记录会自动保存。</p></div>`;
}
function worksheetReview(s) {
  if (!s.worksheet) return "";
  const c = data.cases.find(c => c.id === s.caseId), w = s.worksheet;
  return `<details class="summary" style="margin:18px 0"><summary>查看实训作答</summary><p><b>风险信号：</b>${esc(w.risk.map(i => c.riskOptions[i]).join("；") || "未选择")}</p><p><b>安全措施：</b>${esc(w.safety || "未填写")}</p><p><b>沟通做法：</b>${esc(w.communication.map(i => c.communicationOptions[i]).join("；") || "未选择")}</p><p><b>报告判断：</b>${esc(({ report: "立即报告", wait: "等待调查", none: "无需报告" })[w.decision] || "未选择")}；${esc(w.reason)}</p><p><b>证据梳理：</b>${esc(w.evidence.map(i => c.evidenceOptions[i]).join("；"))}；保留原始材料 ${w.preserveOriginal ? "是" : "否"}；保护隐私 ${w.protectPrivacy ? "是" : "否"}</p><p><b>模拟上报：</b>${esc(w.report.location)} · ${esc(w.report.type)}<br>${esc(w.report.description)}</p></details>`;
}
async function openRecord(id) {
  const s = await sessionGet(id); $("record-detail-title").textContent = s.title;
  $("record-detail-body").innerHTML = (s.score ? scoreHTML(s) + feedbackHTML(s) : "") + worksheetReview(s) + `<h3>完整对话</h3><div class="chat-messages">${messagesHTML(s)}</div>` + (s.lastError ? `<p class="portal-error">${esc(s.lastError)}</p>` : "");
  $("record-detail-body").querySelector("[data-feedback]")?.remove(); openDialog($("record-detail"));
}
async function ledgerPage(unitId = query.get("unit") || data.who.unitId || data.units[0].id) {
  const ledger = await api("/api/units/" + encodeURIComponent(unitId));
  main.innerHTML = intro("单位培训台账", "按演示单位查看学习与实训完成情况，导出履职培训摘要。", `<label class="field ledger-select"><span class="visually-hidden">演示单位</span><select id="unit-choice">${data.units.map(u => `<option value="${u.id}" ${u.id === unitId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label><a class="export-link" href="/api/units/${encodeURIComponent(unitId)}/export.csv">导出台账 ↓</a>`) + `<div class="stats ledger-stats">${[["演示学员", ledger.totals.learners], ["已完成实训", ledger.totals.completed], ["达标实训", ledger.totals.passed], ["学习完成", ledger.totals.learning]].map(([title, n]) => `<div class="stat"><div class="stat-label">${title}</div><strong>${n}</strong><p>${esc(ledger.unit.name)}</p></div>`).join("")}</div><p class="ledger-note">当前为免登录演示，身份与单位均可切换。导出包含完成情况和五项分数摘要。</p><section class="ledger-panel"><div class="table-wrap"><table class="case-table"><thead><tr>${["学员 / 岗位", "类型", "案例 / 课程", "完成情况", "总分 / 达标", "时间"].map(x => `<th>${x}</th>`).join("")}</tr></thead><tbody>${ledger.rows.map(r => { const who = data.profiles.find(p => p.id === r.learnerId); return `<tr><td>${esc(who.name)}<div class="muted">${esc(who.role)}</div></td><td>${r.kind}</td><td>${esc(r.title)}</td><td><span class="badge subtle">${r.state}</span></td><td>${r.score ? r.score.total + " / " + (r.score.passed ? "达标" : "未达标") : "—"}</td><td>${time(r.time)}</td></tr>`; }).join("") || '<tr><td colspan="6" class="empty">本单位还没有培训记录。完成学习或实训后将在这里显示。</td></tr>'}</tbody></table></div></section>` + footer();
  $("unit-choice").onchange = async e => { history.replaceState(null, "", "/ledger?unit=" + e.target.value); try { await ledgerPage(e.target.value); } catch (e) { toast(e.message); } };
}
main.onclick = async e => {
  const button = e.target.closest("button"); if (!button || button.disabled) return;
  try {
    if (button.dataset.question) { $("chat-input").value = button.dataset.question; resizeComposer(); $("chat-input").focus(); }
    else if (button.hasAttribute("data-open-memory")) await openMemory();
    else if (button.dataset.openReport) { if (generating) return toast("请先停止或等待当前回复"); const s = current?.id === button.dataset.openReport ? current : await sessionGet(button.dataset.openReport); if (!s.reportDraft) return toast("尚未准备好报告草稿"); await openReportDraft(s.reportDraft); }
    else if (button.hasAttribute("data-build-report")) {
      if (generating) return toast("请先停止或等待当前回复");
      if (!current?.messages.some(m => m.role === "user")) return toast("请先在对话中描述需要报告的情况");
      generating = true; streamingKind = "draft"; button.disabled = true; button.textContent = "正在整理草稿…"; updateChat();
      try { const value = await post(`/api/sessions/${current.id}/report-draft`, { learnerId: learnerId(), model: model() }); await openReportDraft(value); }
      finally { generating = false; streamingKind = "message"; if (button.isConnected) { button.disabled = false; button.textContent = "从对话整理报告 ↗"; updateChat(); } }
    }
    else if (button.dataset.session) { if (generating) return toast("请等待回复完成"); openQA(await sessionGet(button.dataset.session)); }
    else if (button.hasAttribute("data-retry")) await sendMessage(true);
    else if (button.hasAttribute("data-become-teacher")) chooseLearner("teacher-1");
    else if (button.dataset.start) { button.disabled = true; await startTraining(button.dataset.start); }
    else if (button.hasAttribute("data-back-training")) { if (generating) return toast("请等待生成完成"); history.replaceState(null, "", "/training"); trainingListing(); }
    else if (button.hasAttribute("data-feedback")) {
      if (generating) return;
      clearStream(); streamingKind = "feedback"; generating = true; button.disabled = true; button.textContent = "正在生成…";
      try { current = await streamSession(`/api/sessions/${current.id}/feedback`, { learnerId: learnerId(), model: model() }, "feedback"); }
      catch (error) { toast(error.message); try { current = await sessionGet(current.id); } catch {} }
      finally { generating = false; if (current.busy) resumeGeneration(current); else renderTraining(); }
    }
    else if (button.dataset.learn) { button.disabled = true; await post("/api/learning", { learnerId: learnerId(), materialId: button.dataset.learn }); await learningPage(); toast("学习完成已记录"); }
    else if (button.dataset.filter) { filter = button.dataset.filter; renderRecords(); }
    else if (button.hasAttribute("data-refresh-records")) { button.disabled = true; await recordsPage(); }
    else if (button.dataset.openRecord) await openRecord(button.dataset.openRecord);
    else if (button.dataset.deleteDraft) { pendingDelete = { kind: "draft", id: button.dataset.deleteDraft }; openDialog($("delete-dialog")); }
    else if (button.dataset.deleteSession || button.dataset.deleteLearning) { pendingDelete = { kind: button.dataset.deleteSession ? "sessions" : "learning", id: button.dataset.deleteSession || button.dataset.deleteLearning }; openDialog($("delete-dialog")); }
  } catch (e) { toast(e.message); if (button.isConnected) button.disabled = false; }
};
bindDialog($("record-detail")); bindDialog($("delete-dialog"));
bindDialog($("memory-dialog"));
$("memory-close").onclick = () => $("memory-dialog").close();
$("memory-save").onclick = async () => { $("memory-save").disabled = true; try { await post("/api/memory", { learnerId: learnerId(), longTerm: $("memory-long-term").value }); $("memory-dialog").close(); toast("长期记忆已保存，会在此身份的新对话中使用"); } catch (e) { toast(e.message); } finally { $("memory-save").disabled = false; } };
$("memory-clear").onclick = async () => { $("memory-clear").disabled = true; try { await api(personUrl("/api/memory"), { method: "DELETE" }); await openMemory(); toast("长期与短期记忆已清空，对话记录仍保留"); } catch (e) { toast(e.message); } finally { $("memory-clear").disabled = false; } };
$("close-record").onclick = () => $("record-detail").close(); $("delete-cancel").onclick = () => $("delete-dialog").close();
$("delete-confirm").onclick = async () => { if (!pendingDelete) return; $("delete-confirm").disabled = true; try { if (pendingDelete.kind === "draft") await removeDraft(learnerId(), pendingDelete.id); else await api(personUrl(`/api/${pendingDelete.kind}/${pendingDelete.id}`), { method: "DELETE" }); $("delete-dialog").close(); pendingDelete = null; await recordsPage(); toast("记录已删除"); } catch (e) { toast(e.message); } finally { $("delete-confirm").disabled = false; } };
try {
  [data, config] = await Promise.all([mountShell(page), api("/api/ai/config")]);
  document.title = ({ ask: "智能问答", training: "情景实训", learning: "普法学习", records: "我的记录", ledger: "单位台账" })[page] + " · 强制报告智能体";
  await ({ ask: qaPage, training: trainingPage, learning: learningPage, records: recordsPage, ledger: () => ledgerPage() })[page]();
  if (!config.configured && ["ask", "training"].includes(page)) main.insertAdjacentHTML("afterbegin", `<div class="portal-error">服务端未读取到 FREE_API_KEY，请配置后重启；真实AI功能暂不可用。</div>`);
} catch (e) { main.innerHTML = `<div class="portal-error">${esc(e.message)}</div><a class="text-link" href="/${page}">重新载入 ↻</a>`; }
