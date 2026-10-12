import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const owner = "account:test", id = "test-draft";
const draft = description => ({ id, fields: { description }, scrollY: 900 });
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
function client(api) {
  const values = new Map();
  const context = vm.createContext({ api, accountState: { authenticated: true, ownerId: owner }, window: { addEventListener() {}, dispatchEvent() {} }, CustomEvent: class {}, localStorage: { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }, setTimeout: () => 1, clearTimeout() {} });
  const source = fs.readFileSync(new URL("../public/report-drafts.js", import.meta.url), "utf8").replace(/^import .+;$/gm, "").replace(/\bexport (?=(?:async )?function)/g, "");
  vm.runInContext(source, context);
  return { context, values };
}

test("同步 GET 期间的编辑继续保留并上传，连续保存按最新版本串行", async () => {
  const get = deferred(), first = deferred(), requests = [];
  let revision = 0;
  const { context } = client(async (_url, options) => {
    if (!options) return get.promise;
    const value = JSON.parse(options.body); requests.push(value);
    if (requests.length === 1) await first.promise;
    assert.equal(value.revision, revision);
    return { ...value, revision: ++revision };
  });
  const syncing = context.syncDrafts(owner); await tick();
  context.saveDraft(owner, draft("GET 期间的新内容"));
  get.resolve([]); await syncing;
  assert.equal(context.listDrafts(owner)[0].fields.description, "GET 期间的新内容");
  const writing = context.flushDrafts(owner); await tick();
  context.saveDraft(owner, draft("首轮保存未返回时的新内容"));
  const next = context.flushDrafts(owner); first.resolve(); await Promise.all([writing, next]);
  assert.deepEqual(requests.map(v => v.revision), [0, 1]);
  assert.equal(context.listDrafts(owner)[0].fields.description, "首轮保存未返回时的新内容");
  assert.equal(context.listDrafts(owner)[0]._dirty, false);
});

test("版本冲突保留本机编辑并阻止旧页面继续覆盖", async () => {
  let puts = 0;
  const { context } = client(async (_url, options) => {
    if (!options) return [{ ...draft("另一页面的新内容"), revision: 2 }];
    puts++; throw Object.assign(Error("草稿已更新"), { status: 409 });
  });
  await context.syncDrafts(owner);
  context.saveDraft(owner, draft("本页编辑"));
  await assert.rejects(context.flushDrafts(owner), /草稿已更新/);
  context.saveDraft(owner, draft("本页继续编辑"));
  await assert.rejects(context.flushDrafts(owner), /草稿已更新/);
  assert.equal(puts, 1);
  assert.equal(context.listDrafts(owner)[0].fields.description, "本页继续编辑");
});
