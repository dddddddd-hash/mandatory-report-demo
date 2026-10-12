import { esc, time, post, toast, icon, openDialog, bindDialog } from "/common.js";
import { mountShell, learnerId } from "/shell.js";
import { activeDraft, getDraft, saveDraft, removeDraft, clearActiveDraft, storeAttachment, loadAttachment } from "/report-drafts.js";

const $ = id => document.getElementById(id);
const form = $("report-form");
const identities = ["未成年本人", "家长/监护人", "教师/教育工作者", "医护人员", "社区工作人员", "其他"];
const types = ["身体虐待", "性侵害", "情感/精神虐待", "忽视/疏于照料", "家庭暴力", "暴力伤害", "拐卖", "遗弃", "组织乞讨", "自杀/自残", "其他"];
const owner = learnerId();
let draft = null, ready = false, restoring = false, attachmentWork = Promise.resolve(), attachmentFailed = false, scrollTimer;
$("identities").innerHTML = identities.map(x => `<label><input type="radio" name="identity" value="${x}" required><span>${x}</span></label>`).join("");
$("types").innerHTML = types.map(x => `<label><input type="checkbox" name="types" value="${x}"><span>${x}</span></label>`).join("");
bindDialog($("confirm"));

function payload() {
  const f = new FormData(form);
  return {
    identity: f.get("identity"), types: f.getAll("types"), region: f.get("region"), address: f.get("address"),
    occurredAt: f.get("occurredAt"), age: f.get("age"), description: f.get("description"),
    identityOther: $("identity-other").value, typeOther: $("type-other").value,
    reporter: { name: f.get("reporterName"), organization: f.get("organization"), phone: f.get("phone") }
  };
}

function persistDraft(contentChanged = true) {
  if (!ready || restoring) return;
  const fields = payload(), file = $("attachment").files[0];
  const hasContent = fields.identity || fields.types.length || [fields.region, fields.address, fields.occurredAt, fields.age, fields.description, fields.identityOther, fields.typeOther, ...Object.values(fields.reporter)].some(v => v?.trim()) || file;
  if (!draft && !hasContent) return;
  draft = { ...draft, id: draft?.id || crypto.randomUUID(), fields, attachmentName: file?.name || "", scrollY: window.scrollY, updatedAt: contentChanged || !draft ? new Date().toISOString() : draft.updatedAt };
  try { saveDraft(owner, draft); $("draft-status").textContent = attachmentFailed ? "文字已保存；附件未保存，请重新选择" : "草稿已自动保存 · 可从“我的记录”继续填写"; }
  catch { $("draft-status").textContent = "草稿保存失败，请检查浏览器存储空间后重试"; }
}
function saveAttachment() {
  persistDraft();
  if (!draft) return;
  const id = draft.id, file = $("attachment").files[0] || null;
  attachmentWork = attachmentWork.then(() => storeAttachment(owner, id, file)).then(() => { attachmentFailed = false; persistDraft(false); }).catch(() => { attachmentFailed = true; $("draft-status").textContent = "文字已保存；附件未保存，请重新选择"; });
}
async function restoreDraft() {
  const query = new URLSearchParams(location.search);
  try {
    draft = query.has("new") ? null : query.has("draft") ? getDraft(owner, query.get("draft")) : activeDraft(owner);
    if (query.has("new")) { clearActiveDraft(owner); history.replaceState(null, "", "/report"); }
    if (!draft) { if (query.has("draft")) toast("草稿已删除或不属于当前身份"); return; }
    const b = draft.fields;
    form.elements.identity.value = b.identity || "";
    // Keep older combined event types editable when restoring existing drafts.
    for (const type of b.types || []) if (!types.includes(type)) $("types").insertAdjacentHTML("beforeend", `<label><input type="checkbox" name="types" value="${esc(type)}"><span>${esc(type)}</span></label>`);
    for (const c of form.querySelectorAll('[name="types"]')) c.checked = (b.types || []).includes(c.value);
    for (const key of ["region", "address", "occurredAt", "age", "description"]) form.elements[key].value = b[key] || "";
    $("identity-other").value = b.identityOther || ""; $("type-other").value = b.typeOther || "";
    for (const [name, key] of [["reporterName", "name"], ["organization", "organization"], ["phone", "phone"]]) form.elements[name].value = b.reporter?.[key] || "";
    saveDraft(owner, draft);
    $("draft-status").textContent = draft.origin === "chat" ? "已从智能问答预填 · 请核对已有内容并补充空白信息，再确认提交" : "已恢复草稿，继续填写时会自动保存";
    if (draft.attachmentName) {
      try { const file = await loadAttachment(owner, draft.id); if (!file) throw Error(); const transfer = new DataTransfer(); transfer.items.add(file); $("attachment").files = transfer.files; }
      catch { attachmentFailed = true; $("draft-status").textContent = `文字已恢复；附件“${draft.attachmentName}”需重新选择`; }
    }
    updateForm(); updateAttachment();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.scrollTo({ top: draft.scrollY || 0, behavior: "instant" });
  } catch { $("draft-status").textContent = "无法恢复草稿，请检查浏览器存储设置"; }
}
form.addEventListener("input", () => persistDraft());
form.addEventListener("change", () => persistDraft());
window.addEventListener("scroll", () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(() => persistDraft(false), 150); }, { passive: true });
window.addEventListener("pagehide", () => persistDraft(false));
document.addEventListener("visibilitychange", () => { if (document.hidden) persistDraft(false); });
// Save position before navigation or identity switching changes the active learner.
document.addEventListener("click", e => { if (e.target.closest("a[href]")) persistDraft(false); }, true);
$("new-report").onclick = async () => { persistDraft(false); await attachmentWork; location.href = "/report?new=1"; };

function updateForm() {
  const b = payload();
  $("identity-other").hidden = b.identity !== "其他";
  $("identity-other").required = b.identity === "其他";
  $("type-other").hidden = !b.types.includes("其他");
  $("type-other").required = b.types.includes("其他");
  const complete = [b.identity && (b.identity !== "其他" || b.identityOther.trim()), b.types.length && (!b.types.includes("其他") || b.typeOther.trim()), b.region.trim(), b.address.trim(), b.occurredAt, b.age, b.description.trim()].filter(Boolean).length;
  $("progress-bar").style.width = `${complete / 7 * 100}%`;
  $("progress-text").textContent = `已完成 ${complete} / 7 项必填信息`;
  $("report-mode").textContent = b.reporter.name.trim() || b.reporter.phone.trim() ? "已提供联系信息" : "匿名报告";
}
form.addEventListener("input", updateForm);
form.addEventListener("change", updateForm);

function updateAttachment() {
  const file = $("attachment").files[0];
  $("attachment-label").textContent = file ? file.name : "点击选择证据文件";
  $("attachment-hint").textContent = file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · 点击可更换文件` : "照片、视频或文字材料 · 最多 1 个文件，10MB 以内";
  $("remove-attachment").hidden = !file;
}
$("attachment").addEventListener("change", () => {
  if ($("attachment").files[0]?.size > 10 * 1024 * 1024) { $("attachment").value = ""; toast("文件超过10MB，请选择较小的文件"); }
  updateAttachment();
  saveAttachment();
});
$("remove-attachment").onclick = () => { $("attachment").value = ""; updateAttachment(); saveAttachment(); };

form.addEventListener("submit", e => {
  e.preventDefault();
  const b = payload();
  if (!b.types.length) { $("types").querySelector("input").focus(); return toast("请至少选择一种事件类型"); }
  if ((b.identity === "其他" && !b.identityOther.trim()) || (b.types.includes("其他") && !b.typeOther.trim())) return toast("请补充其他选项说明");
  if ($("attachment").files[0]?.size > 10 * 1024 * 1024) return toast("文件超过10MB，请更换");
  $("consent").checked = false;
  openDialog($("confirm"));
});
$("cancel").onclick = () => $("confirm").close();
$("send").onclick = async () => {
  if (!$("consent").checked) { $("consent").focus(); return toast("请先勾选阅读并知晓提示"); }
  $("send").disabled = true;
  $("send").textContent = "正在提交…";
  try {
    await attachmentWork;
    const b = payload(); b.consent = true;
    const file = $("attachment").files[0];
    if (file) {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject; reader.readAsDataURL(file);
      });
      const fallbackMime = { txt: "text/plain", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4" };
      b.attachment = { name: file.name, mime: file.type || fallbackMime[file.name.split(".").pop().toLowerCase()] || "", data };
    }
    const r = await post("/api/reports", b);
    let stored = true;
    try { const history = JSON.parse(localStorage.getItem("reportReceipts") || "[]"); history.unshift(r); localStorage.setItem("reportReceipts", JSON.stringify(history)); } catch { stored = false; }
    $("confirm").close();
    $("receipt").hidden = false;
    $("receipt").innerHTML = `<div class="receipt-top"><span class="receipt-check" aria-hidden="true">✓</span><h2>报告已送达，保护开始行动</h2></div><p>线索编号 <strong>${esc(r.id)}</strong> <span class="badge">${esc(r.status)}</span></p><p>公安接收时间：${time(r.receivedAt)}</p><div class="soft-callout reporter-privacy"><strong>报告者个人信息保密</strong><p>您提供的姓名、工作单位、联系电话等个人信息仅供内部核实与联系使用，不对外公开。</p></div><p class="muted">${stored ? "查询凭证已保存在本浏览器。接收工作台现可查看这条线索。" : "浏览器无法保存记录，请另行保存查询凭证：" + esc(r.receipt)}</p><a class="text-link" href="/receiver">在接收端查看 <span aria-hidden="true">↗</span></a>`;
    if (draft) { try { await removeDraft(owner, draft.id); } catch { toast("报告已提交，草稿清理未完成，请在我的记录中删除"); } }
    draft = null; attachmentFailed = false;
    history.replaceState(null, "", "/report");
    $("draft-status").textContent = "草稿自动保存 · 未完成线索可在“我的记录”继续填写";
    form.reset(); updateForm(); updateAttachment();
    $("receipt").scrollIntoView({ behavior: "smooth", block: "start" });
    await records();
  } catch (e) { toast(e.message); }
  finally { $("send").disabled = false; $("send").innerHTML = '确认提交 <span aria-hidden="true">→</span>'; }
};

async function records() {
  let history;
  try { history = JSON.parse(localStorage.getItem("reportReceipts") || "[]"); } catch { history = []; }
  if (!history.length) {
    $("records").innerHTML = `<div class="empty"><span class="empty-icon">${icon("inbox")}</span><h3>还没有上报记录</h3><p class="muted">提交线索后，您可以在这里查看处理进度。</p></div>`;
    return;
  }
  const results = await Promise.all(history.map(async r => {
    try { return await post("/api/receipt", { id: r.id, receipt: r.receipt }); } catch { return { ...r, status: "暂无法查询" }; }
  }));
  $("records").innerHTML = results.map(r => `<div class="record record-row"><div><strong>${esc(r.id)}</strong><div class="muted">提交于 ${time(r.receivedAt)}</div></div><span class="badge">${esc(r.status)}</span></div>`).join("");
}
$("refresh-records").onclick = async () => {
  $("refresh-records").disabled = true;
  try { await records(); } finally { $("refresh-records").disabled = false; }
};

$("fill-demo").onclick = () => {
  form.elements.identity.value = "教师/教育工作者";
  for (const c of form.querySelectorAll('input[name="types"]')) c.checked = c.value === "身体虐待";
  form.elements.region.value = "湖南省 长沙市 岳麓区"; form.elements.address.value = "示例学校（虚构）";
  const d = new Date(Date.now() - 3600000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  form.elements.occurredAt.value = d.toISOString().slice(0, 16); form.elements.age.value = "7-13岁";
  form.elements.description.value = "【虚构演示】学生小明连续两天出现手臂淤青，并称受到监护人殴打。目前在学校安全区域，由教师陪同。建议核实并开展保护。";
  form.elements.reporterName.value = "演示教师"; form.elements.organization.value = "示例学校"; form.elements.phone.value = "";
  updateForm(); persistDraft(); toast("已填入虚构案例，可修改后提交");
};
restoring = true;
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
try { await mountShell("report"); await restoreDraft(); } catch (e) { toast(e.message); }
finally { restoring = false; ready = true; }
updateForm(); records();
