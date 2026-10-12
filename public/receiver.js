import { esc, time, api, post, toast, icon, openDialog, bindDialog } from "/common.js";
import { reportTags } from "/report-tags.js";

function riskTags(r) { const tags = reportTags(r.types); return tags.length ? `<div class="risk-situation-tags" aria-label="报告情形标签">${tags.map(t => `<span class="badge situation-tag">${esc(t)}</span>`).join("")}</div>` : ""; }

const $ = id => document.getElementById(id);
let role = "公安", list = [], selected = null, loading = false, opening = false, acting = false;
const labels = { A: "强制报告监管", B: "帮扶风险", C: "待人工核实" };
const departments = {
  公安: { icon: "shield", subtitle: "线索总览与处置", eyebrow: "POLICE WORKSPACE", title: "线索接收工作台", description: "从接收、研判到处置，让每一条线索有迹可循。" },
  民政: { icon: "home", subtitle: "保障与帮扶接收", eyebrow: "CIVIL AFFAIRS", title: "民政帮扶工作台", description: "接收脱敏帮扶线索，记录保障与干预过程。" },
  教育: { icon: "book", subtitle: "校园保护与帮扶", eyebrow: "EDUCATION WORKSPACE", title: "教育帮扶工作台", description: "协同开展校园保护，跟进学生的帮扶需求。" },
  妇联: { icon: "heart", subtitle: "家庭支持与帮扶", eyebrow: "FAMILY SUPPORT", title: "妇联帮扶工作台", description: "关注家庭支持与关爱服务，及时回传帮扶进展。" },
  检察院: { icon: "scale", subtitle: "监督摘要与跟进", eyebrow: "PROCURATORATE", title: "检察监督工作台", description: "查看超期、不予立案与应报未报的监督摘要。" }
};
const transitions = { 待受理: ["已受理"], 已受理: ["初查"], 初查: ["已立案", "不予立案", "已归档"], 已立案: ["已归档"], 不予立案: ["已归档"], 分流帮扶: ["已归档"], 已归档: [] };
const completeStatuses = ["已立案", "不予立案", "分流帮扶", "已归档"];
const dialog = $("case-dialog");
bindDialog(dialog);
$("close-detail").onclick = () => dialog.close();
dialog.addEventListener("close", () => { selected = null; });

function navigation() {
  $("roles").innerHTML = Object.entries(departments).map(([r, meta]) => `<button type="button" class="${r === role ? "active" : ""}" data-role="${r}" aria-pressed="${r === role}">${icon(meta.icon)}<span><strong>${r}</strong><small>${meta.subtitle}</small></span><span class="nav-arrow" aria-hidden="true">→</span></button>`).join("");
  $("current-role").textContent = role;
  $("workspace-eyebrow").textContent = departments[role].eyebrow;
  $("workspace-title").textContent = departments[role].title;
  $("workspace-description").textContent = departments[role].description;
}
$("roles").onclick = async e => {
  const button = e.target.closest("[data-role]");
  if (!button || button.dataset.role === role) return;
  role = button.dataset.role; selected = null; list = [];
  if (dialog.open) dialog.close();
  ["search", "status-filter", "tag-filter", "anonymous-filter"].forEach(id => $(id).value = "");
  $("logs").textContent = "点击“加载日志”查看最近的操作记录。";
  navigation(); render(); await refresh();
};

function remaining(r) {
  if (completeStatuses.includes(r.status)) return "阶段处置完成";
  const n = Date.parse(r.deadline) - Date.now();
  return n <= 0 ? "已超期" : `${Math.floor(n / 3600000)}h ${Math.floor(n % 3600000 / 60000)}m`;
}
function statusBadge(status) { return `<span class="badge status ${completeStatuses.includes(status) ? "done" : ""}">${esc(status)}</span>`; }

async function refresh() {
  if (loading) return;
  loading = true;
  const requestRole = role;
  $("refresh").disabled = true;
  try {
    const data = await api("/api/reports", {}, requestRole);
    if (requestRole !== role) return;
    list = data; render();
    $("connection").classList.remove("offline");
    $("connection").textContent = `已同步 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })} · ${requestRole === "公安" ? "公安接收起 24h 计时" : requestRole === "检察院" ? "监督摘要自动同步" : "部门帮扶线索自动同步"}`;
  } catch (e) {
    if (requestRole === role) { $("connection").textContent = "连接失败：" + e.message; $("connection").classList.add("offline"); }
  } finally {
    loading = false; $("refresh").disabled = false;
    if (requestRole !== role) refresh();
  }
}

function distribution(title, key) {
  const counts = {};
  list.forEach(r => { const values = Array.isArray(r[key]) ? r[key] : [r[key] || "未分类"]; values.forEach(v => counts[v] = (counts[v] || 0) + 1); });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return `<div class="distribution"><h3>${title}</h3>${entries.length ? entries.map(([label, n]) => `<div class="bar-row"><span>${esc(label)}</span><div class="bar-track"><div class="bar-fill" style="width:${n / max * 100}%"></div></div><strong>${n}</strong></div>`).join("") : `<p class="muted">暂无数据，接收线索后显示分布。</p>`}</div>`;
}

function render() {
  const police = role === "公安", prosecutor = role === "检察院";
  $("logs-panel").hidden = !police;
  $("tag-filter-wrap").hidden = $("anonymous-filter-wrap").hidden = !police;
  $("search").placeholder = prosecutor ? "搜索线索编号" : "搜索编号、地点或描述";
  $("queue-description").textContent = police ? "AI 建议仅供参考，定性需由公安人工复核。" : prosecutor ? "仅展示监督摘要，完整案卷按法定流程调取。" : "仅展示公安共享的脱敏信息，可记录帮扶或升级回公安。";
  $("table-scope").textContent = police ? "公安可查看完整报告" : prosecutor ? "检察端仅查看监督摘要" : "本部门仅查看已分流的脱敏线索";
  const stats = police ? [
    ["收到线索", list.length, "inbox", "当前接收的全部线索"],
    ["待人工复核", list.filter(r => !r.confirmedTag).length, "review", "AI 建议等待人工确认"],
    ["A 类监管", list.filter(r => r.confirmedTag === "A").length, "shield", "已人工确认的监管线索"],
    ["监督线索", list.filter(r => r.supervision.length).length, "scale", "已推送至检察监督"]
  ] : prosecutor ? [
    ["监督摘要", list.length, "inbox", "当前收到的监督线索"],
    ["超期未处置", list.filter(r => r.supervision.some(s => s.reason === "超期未处置")).length, "clock", "超过 24h 处置时限"],
    ["不予立案", list.filter(r => r.supervision.some(s => s.reason === "不予立案")).length, "file", "A 类不予立案线索"],
    ["应报未报", list.filter(r => r.supervision.some(s => s.reason.startsWith("应报未报"))).length, "review", "公安移送监督摘要"]
  ] : [
    ["本部门线索", list.length, "inbox", "公安分流至本部门"],
    ["待帮扶", list.filter(r => !r.helpRecords.length).length, "heart", "尚未登记帮扶记录"],
    ["已有帮扶记录", list.filter(r => r.helpRecords.length).length, "review", "已开展帮扶的线索"],
    ["已归档", list.filter(r => r.status === "已归档").length, "file", "已完成阶段处置"]
  ];
  $("stats").innerHTML = stats.map(([title, n, symbol, hint]) => `<div class="stat"><div class="stat-label"><span>${title}</span>${icon(symbol)}</div><strong>${n}</strong><p>${hint}</p></div>`).join("");
  const q = $("search").value.trim().toLowerCase();
  const shown = list.filter(r => [r.id, r.region, r.address, r.description].join(" ").toLowerCase().includes(q)
    && (!$("status-filter").value || r.status === $("status-filter").value)
    && (!police || !$("tag-filter").value || ($("tag-filter").value === "pending" ? !r.confirmedTag : r.confirmedTag === $("tag-filter").value))
    && (!police || !$("anonymous-filter").value || r.anonymous === ($("anonymous-filter").value === "yes")));
  $("queue-count").textContent = list.length;
  $("result-count").textContent = `显示 ${shown.length} 条 / 共 ${list.length} 条线索`;
  const headings = police ? ["线索与地点", "年龄 / 上报方式", "研判与复核", "处置状态", "剩余时限", "操作"] : prosecutor ? ["线索编号", "公安接收时间", "处置状态", "监督原因", "操作"] : ["线索与区域", "年龄 / 发生时间", "处置状态", "帮扶记录", "操作"];
  $("head").innerHTML = `<tr>${headings.map(t => `<th scope="col">${t}</th>`).join("")}</tr>`;
  const content = shown.length ? shown.map(r => {
    const location = police ? [r.region, r.address].filter(Boolean).join(" ") : r.region;
    const lead = `<span class="case-number">${esc(r.id)}</span>${!prosecutor ? `<strong class="case-location" title="${esc(location)}">${esc(police ? r.address || r.region : r.region)}</strong><div class="muted">${time(r.receivedAt)}</div>` : ""}`;
    const cells = police ? `<td>${esc(r.age)}<div class="muted">${esc(r.identity)}</div><span class="badge subtle">${r.anonymous ? "匿名" : "已提供身份信息"}</span></td><td class="tag-cell"><span class="badge ${r.ai.risk === "高" ? "red" : r.ai.risk === "中" ? "amber" : "subtle"}">AI 建议 ${esc(r.ai.tag)} · ${esc(r.ai.risk)}风险</span>${riskTags(r)}<p>${r.confirmedTag ? `人工 ${r.confirmedTag} · ${labels[r.confirmedTag]}` : "○ 待人工复核"}</p></td><td>${statusBadge(r.status)}${r.department ? `<div class="muted">→ ${esc(r.department)}</div>` : ""}</td><td class="deadline-cell"><span class="badge ${remaining(r) === "已超期" ? "red" : "subtle"}">${remaining(r)}</span></td>`
      : prosecutor ? `<td>${time(r.receivedAt)}</td><td>${statusBadge(r.status)}</td><td>${r.supervision.map(s => `<div class="muted">${esc(s.reason)}</div>`).join("")}</td>`
      : `<td>${esc(r.age)}<div class="muted">${time(r.occurredAt)}</div></td><td>${statusBadge(r.status)}</td><td>${r.helpRecords.length} 条</td>`;
    return `<tr><td>${lead}</td>${cells}<td><button type="button" data-id="${esc(r.id)}" aria-label="查看线索 ${esc(r.id)}">查看 <span aria-hidden="true">↗</span></button></td></tr>`;
  }).join("") : `<tr><td colspan="${headings.length}" class="empty"><span class="empty-icon">${icon("inbox")}</span><h3>${list.length ? "没有符合筛选条件的线索" : prosecutor ? "暂无监督摘要" : police ? "等待第一条线索" : "暂无分流到本部门的线索"}</h3><p>${list.length ? "试试更换关键词或重置筛选条件。" : police ? '在公众报告端提交虚构案例，即可演示完整流程。' : prosecutor ? "公安确认 A 类后，超期或不予立案会自动进入监督。" : "公安确认 B 类并分流后，线索会出现在这里。"}</p></td></tr>`;
  if ($("rows").innerHTML !== content) $("rows").innerHTML = content;
  $("analytics").innerHTML = `<div class="analytics-heading"><div><h2>线索分布</h2><p class="muted">${esc(role)}部门可见范围内的实时概览</p></div><span class="badge subtle">${list.length} 条线索</span></div><div class="analytics-grid">${distribution("处置状态", "status")}${prosecutor ? `<div class="distribution"><h3>监督原因</h3>${stats.slice(1).map(([title, n]) => `<div class="bar-row"><span>${title}</span><div class="bar-track"><div class="bar-fill" style="width:${list.length ? n / list.length * 100 : 0}%"></div></div><strong>${n}</strong></div>`).join("")}</div>` : distribution("事件类型", "types")}${police ? distribution("线索来源 / 上报身份", "identity") : ""}</div><div class="analytics-foot">${police ? `<span>上报方式</span><span class="badge subtle">匿名 ${list.filter(r => r.anonymous).length}</span><span class="badge subtle">已提供身份信息 ${list.filter(r => !r.anonymous).length}</span>` : `<span>部门协同 · ${esc(departments[role].subtitle)}</span>`}<span>${prosecutor ? "一条线索可包含多个监督原因" : "多选事件类型分别计数"}</span></div>`;
}

$("search").oninput = render;
["status-filter", "tag-filter", "anonymous-filter"].forEach(id => $(id).onchange = render);
$("reset-filters").onclick = () => { ["search", "status-filter", "tag-filter", "anonymous-filter"].forEach(id => $(id).value = ""); render(); };
$("refresh").onclick = refresh;
$("rows").onclick = e => { const button = e.target.closest("[data-id]"); if (button) openCase(button.dataset.id); };

function meta(title, value, full = false) { return `<div class="${full ? "full" : ""}"><dt>${title}</dt><dd>${value}</dd></div>`; }
function describeAction(action) {
  const names = { review: "人工复核", status: "更新处置", divert: "分流帮扶", help: "登记帮扶", upgrade: "升级回公安", simulate: "模拟超期", failure: "移送监督摘要" };
  return action.replace(/^(review|status|divert|help|upgrade|simulate|failure)\b/, key => names[key]);
}
function helpHistory(r) { return r.helpRecords.map(h => `<div class="timeline-record"><p class="detail-text">${esc(h.note)}</p><div class="muted">${esc(h.department)} · ${time(h.time)}</div></div>`).join("") || `<p class="muted">暂无帮扶记录</p>`; }
function supervision(r) { return r.supervision.map(s => `<div class="timeline-record"><span class="badge red">${esc(s.reason)}</span><div class="muted">推送于 ${time(s.time)}</div></div>`).join(""); }

function policeDetail(r) {
  const next = transitions[r.status] || [];
  return `<div class="case-detail-header"><span class="case-number">${esc(r.id)}</span>${statusBadge(r.status)}<span class="badge ${remaining(r) === "已超期" ? "red" : "subtle"}">${remaining(r)}</span></div>
    <div class="case-grid"><section class="case-card"><h3>报告信息</h3><dl class="metadata">
      ${meta("公安接收时间", time(r.receivedAt))}${meta("24h 处置截止", time(r.deadline))}
      ${meta("上报身份", esc(r.identity) + (r.identityOther ? " · " + esc(r.identityOther) : ""))}${meta("受害人年龄", esc(r.age))}
      ${meta("事件类型", r.types.map(esc).join("、") + (r.typeOther ? " · " + esc(r.typeOther) : ""), true)}
      ${meta("事件发生时间", time(r.occurredAt), true)}${meta("地点", esc(r.region) + " " + esc(r.address), true)}
    </dl><h4>事件描述</h4><p class="detail-text">${esc(r.description)}</p><h4>上报人信息 <span class="badge subtle">${r.anonymous ? "匿名报告" : "已提供身份信息"}</span></h4><dl class="metadata">${meta("姓名", esc(r.reporter.name || "未提供"))}${meta("工作单位", esc(r.reporter.organization || "未提供"))}${meta("联系电话", esc(r.reporter.phone || "未提供，无法联系补充信息"), true)}</dl><h4>证据材料</h4>${r.attachment ? `<a class="attachment-link" href="/api/reports/${encodeURIComponent(r.id)}/attachment">${icon("file")}<span>${esc(r.attachment.name)}</span><span aria-hidden="true">↓</span></a>` : '<p class="muted">未上传附件</p>'}<h4>义务主体提示</h4><p class="muted">${r.obligated ? "疑似报告义务主体，需结合具体身份核实。" : "需结合具体身份核实是否属于报告义务主体。"}</p>${r.helpRecords.length ? `<h4>帮扶回传记录</h4>${helpHistory(r)}` : ""}${r.supervision.length ? `<div class="supervision-note"><h4>已推送检察监督</h4>${supervision(r)}</div>` : ""}</section>
    <section class="case-card"><h3>研判与处置</h3><div class="summary"><span class="badge">规则建议</span><span class="badge ${r.ai.risk === "高" ? "red" : r.ai.risk === "中" ? "amber" : "subtle"}">${esc(r.ai.risk)}风险</span>${riskTags(r)}<strong>建议 ${esc(r.ai.tag)} 类 · ${labels[r.ai.tag]}</strong><p>${esc(r.ai.reason)}</p><p><b>报告信号：</b>${esc(r.ai.threshold || "需人工核实是否存在疑似侵害或危险")}</p><p><b>疑似侵害：</b>${esc(r.ai.infringement || r.types.join("、"))}</p><p><b>证据建议：</b><br>${r.ai.evidence.map(esc).join("<br>")}</p><p class="muted">规则建议仅供演示，需人工复核；不构成法律意见。</p></div>
      <div class="review-state"><span class="muted">人工确认</span><span class="badge ${r.confirmedTag ? "" : "subtle"}">${r.confirmedTag ? `${r.confirmedTag} · ${labels[r.confirmedTag]}` : "尚未复核"}</span></div>
      <label class="field"><span>复核依据 / 处置记录 <b class="required">*</b></span><textarea id="note" placeholder="填写本次操作依据；分流时填写可共享的脱敏帮扶摘要"></textarea></label>
      <div class="action-row"><label class="field"><span>人工标签</span><select id="review-tag">${Object.entries(labels).map(([tag, title]) => `<option value="${tag}" ${tag === (r.confirmedTag || "C") ? "selected" : ""}>${tag} · ${title}</option>`).join("")}</select></label><button type="button" data-action="review" class="primary">确认标签</button></div>
      <div class="action-section"><h4>推进处置</h4><div class="action-row"><label class="field"><span>下一处置状态</span><select id="next-status" ${!next.length ? "disabled" : ""}>${next.length ? next.map(s => `<option>${s}</option>`).join("") : '<option value="">已完成归档</option>'}</select></label><button type="button" data-action="status" ${!r.confirmedTag || !next.length ? "disabled" : ""}>保存处置</button></div>${!r.confirmedTag ? '<p class="muted">先完成人工标签确认，再推进处置状态。</p>' : ""}</div>
      <div class="action-section"><h4>协同帮扶</h4><div class="action-row"><label class="field"><span>接收部门</span><select id="department"><option>民政</option><option>教育</option><option>妇联</option></select></label><button type="button" data-action="divert" ${r.confirmedTag !== "B" ? "disabled" : ""}>分流帮扶</button></div><p class="muted">人工确认 B 类后，可共享脱敏摘要至帮扶部门。</p></div>
      <details class="demo-tools"><summary>监督移送与演示工具</summary><div class="actions"><button type="button" data-action="simulate" class="danger">模拟超期</button><button type="button" data-action="failure">移送应报未报摘要</button></div><p class="muted">模拟超期将截止时间设为过去。已确认 A 类且未完成阶段处置时，自动进入检察监督。</p></details>
    </section></div><details class="case-card case-history"><summary>本线索近期办理记录</summary><button type="button" class="secondary mini" data-load-case-logs>加载办理记录</button><div id="case-log-rows" class="muted">查看本线索近期的复核依据、处置记录与流转历史。</div></details>`;
}

async function openCase(id, updated = null) {
  if (opening && !updated) return;
  opening = true;
  const requestRole = role;
  try {
    const r = updated || await api("/api/reports/" + encodeURIComponent(id), {}, requestRole);
    if (requestRole !== role) return;
    selected = id;
    $("case-title").textContent = role === "检察院" ? "监督摘要" : role === "公安" ? "线索详情" : "帮扶线索详情";
    $("case-eyebrow").textContent = role === "检察院" ? "SUPERVISION SUMMARY" : role === "公安" ? "CASE DETAIL" : "SUPPORT CASE";
    if (role === "检察院") {
      $("detail").innerHTML = `<section class="case-card support-detail"><div class="case-detail-header"><span class="case-number">${esc(r.id)}</span>${statusBadge(r.status)}</div><dl class="metadata">${meta("公安接收时间", time(r.receivedAt))}${meta("公安处置状态", esc(r.status))}</dl><h4>监督原因与推送时间</h4>${supervision(r)}<div class="soft-callout supervision-note">当前仅接收监督摘要，完整案卷材料按法定外部调卷流程获取。</div></section>`;
    } else if (role !== "公安") {
      $("detail").innerHTML = `<section class="case-card support-detail"><div class="case-detail-header"><span class="case-number">${esc(r.id)}</span>${statusBadge(r.status)}</div><dl class="metadata">${meta("受害人年龄", esc(r.age))}${meta("公安接收时间", time(r.receivedAt))}${meta("所在区域", esc(r.region), true)}</dl><h4>公安提供的脱敏帮扶摘要</h4><p class="detail-text">${esc(r.description)}</p><label class="field"><span>帮扶记录 / 升级原因 <b class="required">*</b></span><textarea id="note" placeholder="记录干预过程；发现侵害信号时，说明升级回公安的原因"></textarea></label><div class="actions"><button type="button" data-action="help" class="primary">保存帮扶记录</button><button type="button" data-action="upgrade">升级回公安 <span aria-hidden="true">↗</span></button></div><h4>历史帮扶记录</h4>${helpHistory(r)}</section>`;
    } else $("detail").innerHTML = policeDetail(r);
    openDialog(dialog);
    if (!updated) dialog.scrollTop = 0;
  } catch (e) { toast(e.message); }
  finally { opening = false; }
}

$("detail").onclick = async e => {
  const historyButton = e.target.closest("[data-load-case-logs]");
  if (historyButton && selected) {
    const caseId = selected; historyButton.disabled = true;
    try {
      const logs = await api("/api/logs", {}, role);
      if (selected === caseId && $("case-log-rows")) {
        const history = logs.filter(l => l.reportId === caseId);
        $("case-log-rows").innerHTML = history.map(l => `<div class="record"><strong>${esc(l.role)}</strong> ${esc(describeAction(l.action))}<div class="muted">${time(l.time)}</div></div>`).join("") || "最近记录中暂无本线索操作。";
      }
    } catch (err) { toast(err.message); } finally { historyButton.disabled = false; }
    return;
  }
  const button = e.target.closest("[data-action]");
  if (!button || button.disabled || !selected || acting) return;
  const action = button.dataset.action;
  const b = { action, note: $("note")?.value || "" };
  if (action !== "simulate" && !b.note.trim()) { $("note")?.focus(); return toast("请先填写本次操作的依据或记录"); }
  if (action === "review") b.tag = $("review-tag").value;
  if (action === "status") b.status = $("next-status").value;
  if (action === "divert") b.department = $("department").value;
  const caseId = selected, actionRole = role;
  const controls = [...$("detail").querySelectorAll("[data-action]")].map(control => [control, control.disabled]);
  acting = true; controls.forEach(([control]) => { control.disabled = true; });
  try {
    const toolsOpen = $("detail").querySelector(".demo-tools")?.open;
    const position = dialog.scrollTop;
    const r = await post("/api/reports/" + encodeURIComponent(caseId) + "/action", b, actionRole);
    toast("操作已保存，协同记录已更新");
    if (actionRole === role && selected === caseId && dialog.open) {
      if (action === "upgrade") dialog.close();
      else {
      await openCase(caseId, r);
      if (toolsOpen && $("detail").querySelector(".demo-tools")) $("detail").querySelector(".demo-tools").open = true;
      dialog.scrollTop = position;
      }
    }
    await refresh();
  } catch (err) { toast(err.message); }
  finally { acting = false; controls.forEach(([control, disabled]) => { if (control.isConnected) control.disabled = disabled; }); }
};
$("load-logs").onclick = async () => {
  $("load-logs").disabled = true;
  try {
    const logs = await api("/api/logs", {}, role);
    $("logs").innerHTML = logs.length ? logs.map(l => `<div class="record"><strong>${esc(l.role)}</strong> ${esc(describeAction(l.action))}<div class="muted">${time(l.time)} · ${esc(l.reportId || "列表访问")}</div></div>`).join("") : "暂无操作日志";
  } catch (e) { toast(e.message); }
  finally { $("load-logs").disabled = false; }
};
navigation(); render(); refresh(); setInterval(refresh, 5000);
