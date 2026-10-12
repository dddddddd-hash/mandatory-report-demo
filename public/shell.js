import { api, esc, icon } from "/common.js";
let cached;
export const catalog = () => cached ||= api("/api/portal/catalog");
export const learnerId = () => localStorage.getItem("demoLearner") || "public";
export function chooseLearner(id) { localStorage.setItem("demoLearner", id); location.reload(); }
export async function mountShell(active) {
  const data = await catalog();
  if (!data.profiles.some(p => p.id === learnerId())) localStorage.setItem("demoLearner", "public");
  const who = data.profiles.find(p => p.id === learnerId());
  const nav = [
    ["ask", "智能问答", "spark", "/ask"], ["training", "情景实训", "review", "/training"],
    ["learning", "普法学习", "book", "/learning"], ["report", "报告表单", "file", "/report"],
    ["records", "我的记录", "clock", "/records"], ["ledger", "单位台账", "inbox", "/ledger"]
  ];
  document.getElementById("public-sidebar").innerHTML = `<a class="brand" href="/ask"><span class="brand-mark">${icon("shield")}</span><span>强制报告智能体<span class="brand-caption">保护，从看见开始</span></span></a><div class="public-nav-label">公众服务</div><nav class="public-nav" aria-label="公众页面">${nav.map(([id, label, symbol, url]) => `<a href="${url}" ${id === active ? 'class="active" aria-current="page"' : ""}>${icon(symbol)}<span>${label}</span><span class="nav-next">↗</span></a>`).join("")}</nav><div class="public-sidebar-space"></div><a class="receiver-entry" href="/receiver">${icon("inbox")}<span>接收工作台</span><span>↗</span></a><div class="profile-card"><span class="profile-avatar">${esc(who.role.slice(0, 1))}</span><div><label for="demo-profile">演示身份</label><select id="demo-profile">${data.profiles.map(p => `<option value="${p.id}" ${p.id === who.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select><p>${esc(who.unit)}</p></div></div>`;
  document.getElementById("demo-profile").onchange = e => chooseLearner(e.target.value);
  const navElement = document.querySelector(".public-nav"), activeElement = navElement.querySelector(".active");
  if (activeElement && navElement.scrollWidth > navElement.clientWidth) navElement.scrollLeft = Math.max(0, activeElement.offsetLeft - navElement.offsetLeft - (navElement.clientWidth - activeElement.offsetWidth) / 2);
  const label = nav.find(n => n[0] === active)?.[1] || "公众服务";
  document.getElementById("public-topbar").innerHTML = `<div class="public-breadcrumb">公众服务 <span>/</span> <strong>${label}</strong></div><div class="public-topbar-right"><span class="badge subtle">${esc(who.role)}</span><span class="demo-indicator"><i></i>虚构演示</span></div>`;
  return { ...data, who };
}
