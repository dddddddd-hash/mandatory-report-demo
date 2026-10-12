import { api, esc, icon } from "/common.js";
import { loadAccount } from "/account.js";
import { flushDrafts } from "/report-drafts.js";
const account = await loadAccount();
let cached;
export const catalog = () => cached ||= api("/api/portal/catalog");
export const learnerId = () => account.profile.id;
export async function mountShell(active) {
  const data = await catalog();
  const who = account.profile;
  const nav = [
    ["ask", "智能问答", "spark", "/ask"], ["training", "情景实训", "review", "/training"],
    ["learning", "普法学习", "book", "/learning"], ["report", "报告表单", "file", "/report"],
    ["records", "我的记录", "clock", "/records"], ["ledger", "培训台账", "inbox", "/ledger"]
  ];
  document.getElementById("public-sidebar").innerHTML = `<a class="brand" href="/ask"><span class="brand-mark">${icon("shield")}</span><span>强制报告智能体<span class="brand-caption">保护，从看见开始</span></span></a><div class="public-nav-label">公众服务</div><nav class="public-nav" aria-label="公众页面">${nav.map(([id, label, symbol, url]) => `<a href="${url}" ${id === active ? 'class="active" aria-current="page"' : ""}>${icon(symbol)}<span>${label}</span><span class="nav-next">↗</span></a>`).join("")}</nav><div class="public-sidebar-space"></div><div class="profile-card"><span class="profile-avatar">${esc(who.role.slice(0, 1))}</span><div><strong class="account-name">${esc(who.name)}</strong><p>${esc(account.user?.identity || "访客使用")}</p>${account.authenticated ? `<button type="button" id="account-logout" class="text-button">退出登录 ↗</button>` : `<a class="account-login" href="/login?next=${encodeURIComponent(location.pathname)}">登录 / 注册 ↗</a>`}</div></div>`;
  document.getElementById("account-logout")?.addEventListener("click", async e => { const button = e.currentTarget; button.disabled = true; try { window.dispatchEvent(new Event("account-leaving")); await flushDrafts(learnerId()); await api("/api/auth/logout", { method: "POST", body: "{}" }); location.href = "/login"; } catch (error) { button.disabled = false; document.getElementById("toast").textContent = error.message; document.getElementById("toast").hidden = false; } });
  const navElement = document.querySelector(".public-nav"), activeElement = navElement.querySelector(".active");
  if (activeElement && navElement.scrollWidth > navElement.clientWidth) navElement.scrollLeft = Math.max(0, activeElement.offsetLeft - navElement.offsetLeft - (navElement.clientWidth - activeElement.offsetWidth) / 2);
  const label = nav.find(n => n[0] === active)?.[1] || "公众服务";
  document.getElementById("public-topbar").innerHTML = `<div class="public-breadcrumb">公众服务 <span>/</span> <strong>${label}</strong></div><div class="public-topbar-right"><span class="badge subtle">${esc(account.user?.identity || "访客")}</span><span class="account-state"><i></i>${account.authenticated ? "已登录" : "无需登录即可使用"}</span></div>`;
  return { ...data, who };
}
