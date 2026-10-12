import { api, setRecordOwner } from "/common.js";
let loading;
export let accountState;
export function loadAccount() { return loading ||= api("/api/auth/me").then(value => { setRecordOwner(value.ownerId); return accountState = value; }).catch(error => { loading = null; throw error; }); }
export const storageOwner = () => accountState.ownerId;
window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
document.addEventListener("visibilitychange", async () => { if (document.hidden || !accountState) return; try { const state = await api("/api/auth/me"); if (state.ownerId !== accountState.ownerId) location.reload(); } catch {} });
