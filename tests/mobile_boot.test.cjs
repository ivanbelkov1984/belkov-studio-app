'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const current = fs.readFileSync(path.join(repo, 'app', 'app.js'), 'utf8');
const baseline = execFileSync('git', ['show', 'HEAD:app/app.js'], { cwd: repo, encoding: 'utf8' });

function bootCode(source) {
  const marker = '(async () => {';
  const index = source.lastIndexOf(marker);
  assert(index >= 0, 'bootstrap entry point missing');
  const helpers = source.includes('// Public content is never allowed')
    ? source.slice(source.indexOf('// Public content is never allowed'))
    : source.slice(index);
  return helpers;
}

async function runBoot(source, options = {}) {
  const cache = new Map();
  if (options.cached) {
    for (const file of ['services', 'content', 'pricing', 'legal'])
      cache.set('studio.static:data/' + file + '.json', JSON.stringify({ services: [], types: [], faq: [] }));
  }
  const state = { brief: {} };
  const view = { innerHTML: '' };
  const ctx = {
    window: { addEventListener() {}, __booted: false },
    document: { getElementById() { return { addEventListener() {} }; } },
    location: { hash: '#/' },
    localStorage: { getItem(k) { return cache.get(k) ?? null; }, setItem(k, v) { cache.set(k, v); } },
    setTimeout, clearTimeout, AbortController, AbortSignal,
    S: {}, D: {}, PR: {}, L: {}, CFG: { blocks: {}, state: 'open' }, state,
    srv: { leads: false, owner: false }, view,
    $() { return { hidden: true }; },
    async initPlatform() {},
    load() { return Promise.resolve({}); },
    bindBack() {}, bindMain() {}, readStart() {}, track() {}, checkMy() {}, addPultTab() {},
    isOwner() { return Promise.resolve(false); },
    applyConfig() {},
    loadConfig() { return new Promise(() => {}); },
    route() { ctx.routes++; },
    routes: 0,
    fetch(url) {
      if (url.startsWith('data/')) {
        if (options.offline) return Promise.reject(new Error('simulated offline'));
        return Promise.resolve({ ok: true, json: async () => ({ services: [], types: [], faq: [] }) });
      }
      // CRM endpoints hang forever. First screen must not depend on them.
      return new Promise(() => {});
    }
  };
  vm.runInNewContext(bootCode(source), ctx, { timeout: 1000 });
  await new Promise(resolve => setTimeout(resolve, 60));
  return { routes: ctx.routes, booted: ctx.window.__booted, html: view.innerHTML };
}

(async () => {
  const old = await runBoot(baseline);
  assert.equal(old.booted, false, 'red baseline: old app should wait for CRM');
  assert.equal(old.routes, 0, 'red baseline: first screen blocked by CRM');

  const fixed = await runBoot(current);
  assert.equal(fixed.booted, true, 'new first paint must not await CRM');
  assert.ok(fixed.routes > 0, 'new public screen must appear without CRM');

  const offline = await runBoot(current, { offline: true, cached: true });
  assert.equal(offline.booted, true, 'cached public data must allow offline boot');

  const noCache = await runBoot(current, { offline: true });
  assert.equal(noCache.booted, false, 'no data should not imply successful boot');
  assert.ok(noCache.html.includes('studio-retry'), 'visitor must get a retry button');

  console.log('PASS: baseline red, first-paint independent of stalled CRM, offline cached fallback, no-cache retry');
})().catch(e => { console.error(e); process.exitCode = 1; });
