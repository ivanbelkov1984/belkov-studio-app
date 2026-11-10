import { CONFIG as C } from './config.js';
import { P, initPlatform, haptic, hapticOk, openLink, setBack, bindBack, setMain, bindMain, save, load, share } from './platform.js';
import { admin, isOwner } from './admin.js';
import { payScreen } from './pay.js';

const $ = s => document.querySelector(s);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rub = n => new Intl.NumberFormat('ru-RU').format(n) + ' ₽';
let toastT;
function toast(t, ms = 5000) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, ms); }
async function copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }

/* Иконки в стиле Lucide (ISC) */
const ICON = {
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 13h.01M15 13h.01M9.5 17h5"/>',
  app: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  smm: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/>',
  site: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 8h18M8 21h8"/>',
  support: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  out: '<path d="M7 17 17 7M8 7h9v9"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  doc: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
};
const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;
const checks = items => `<ul class="checks">${items.map(i => `<li>${ic('check')}<span>${esc(i)}</span></li>`).join('')}</ul>`;
const tags = list => `<div class="tags">${list.map(p => `<span class="tag">${esc(p)}</span>`).join('')}</div>`;

let D = {}, S = {}, PR = {}, L = {};
const state = { dir: 'all', plat: 'all', calc: { step: 0, type: null, plat: null, feats: [], urg: null }, brief: {} };
let src = '';
const srv = { leads: false, owner: false };
let CFG = { blocks: {}, state: 'open' };   // управляемый из пульта конфиг (запасной вариант — вшитые данные)

/* Применяет опубликованные в пульте блоки поверх вшитых данных. Вшитые данные остаются запасным вариантом. */
function applyConfig(blocks = {}) {
  const pr = blocks.prices || {};
  S.services = S.services.filter(x => !(pr[x.id] && pr[x.id].hidden));
  S.services.forEach(x => { if (pr[x.id] && Number.isInteger(pr[x.id].priceFrom)) x.priceFrom = pr[x.id].priceFrom; });
  const calcCfg = blocks.calc || {};
  (PR.types || []).forEach(t => { const o = (calcCfg.types || {})[t.id]; if (o && Number.isInteger(o.base)) t.base = o.base; });
  if (typeof calcCfg.spread === 'number') PR.spread = calcCfg.spread;
  if (Array.isArray(blocks.faq) && blocks.faq.length) D.faq = blocks.faq;
}
async function loadConfig() {
  let cfg = null;
  try {
    const r = await fetch('/api/config', { cache: 'no-cache', signal: AbortSignal.timeout(5000) });
    if (r.ok) { cfg = await r.json(); try { localStorage.setItem('cfg', JSON.stringify(cfg)); } catch {} }
  } catch {}
  if (!cfg) { try { cfg = JSON.parse(localStorage.getItem('cfg') || 'null'); } catch {} }
  if (cfg && cfg.blocks) CFG = cfg;
}
/* Флаги функций из пульта: площадка, источник, доля пользователей; без настройки функция включена */
const anonId = (() => { try { let v = localStorage.getItem('aid'); if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('aid', v); } return v; } catch { return 'x'; } })();
const bucket = str => { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 100; };
function flag(name) {
  const f = (CFG.blocks.flags || {})[name];
  if (!f) return true;
  if (!f.on) return false;
  if (f.platforms && f.platforms.length && !f.platforms.includes(P.kind)) return false;
  if (f.sources && f.sources.length && !f.sources.includes(src)) return false;
  if (typeof f.percent === 'number' && f.percent < 100 && bucket(anonId + name) >= f.percent) return false;
  return true;
}
const today = () => new Date().toISOString().slice(0, 10);
function activeBanner() {
  const b = CFG.blocks.banner;
  if (!b || !b.enabled || !b.text) return null;
  const t = today();
  if ((b.from && t < b.from) || (b.to && t > b.to)) return null;
  return b;
}
function bannerHtml() {
  const b = activeBanner(); if (!b) return '';
  const link = b.button_link || '';
  const btn = b.button_text && link ? (link.startsWith('#/') ? `<a class="btn" href="${esc(link)}">${esc(b.button_text)}</a>` : `<button class="btn" type="button" data-link="${esc(link)}">${esc(b.button_text)}</button>`) : '';
  return `<div class="card promo"><p style="margin:0 0 ${btn ? 10 : 0}px"><b>${esc(b.text)}</b></p>${btn}</div>`;
}
function greetingHtml() {
  const all = CFG.blocks.sources || {};
  const g = all[src] || all['src_' + src];
  return g && g.greeting ? `<div class="card"><p style="margin:0">${esc(g.greeting)}</p></div>` : '';
}
function modeHtml() {
  const m = CFG.blocks.mode || {};
  if (CFG.state === 'closed') return `<div class="card"><p style="margin:0"><b>${esc(m.closed_text || 'Приём заявок временно закрыт.')}</b></p></div>`;
  if (CFG.state === 'after_hours' && m.after_hours_text) return `<div class="card"><p style="margin:0">${esc(m.after_hours_text)}</p></div>`;
  return '';
}
/* Обезличенная воронка: только тип события, метка источника и площадка */
function track(type) { try { fetch('/api/event', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, src, plat: P.kind }) }).catch(() => {}); } catch {} }

/* ---------- Источник и глубокие ссылки ---------- */
function readStart() {
  const q = new URLSearchParams(location.search);
  const raw = (P.startParam || q.get('startapp') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
  for (const part of raw.split('__')) {
    if (part.startsWith('src_')) src = part.slice(4);
    else if (part.startsWith('svc_')) location.hash = `#/services/${part.slice(4)}`;
    else if (part.startsWith('case_')) location.hash = `#/cases/${part.slice(5)}`;
    else if (part === 'services') location.hash = '#/services';
    else if (part === 'calc') location.hash = '#/calc';
    else if (part === 'brief') location.hash = '#/brief';
    else if (part === 'admin') location.hash = '#/admin';
  }
  const pay = (q.get('pay') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (pay) location.hash = `#/pay/${pay}`;
  if (!src && q.get('src')) src = q.get('src').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

const svcById = id => S.services.find(s => s.id === id);
const caseById = id => D.cases.find(c => c.id === id);
const backBtn = (label = 'Назад') => P.kind === 'web' ? `<button class="back" type="button" data-back>${ic('back')}${esc(label)}</button>` : '';
const footer = () => `<p class="note" style="margin-top:28px">${esc(L.operator || '')}. <a href="#/docs">Документы</a> · <a href="#/terms">Условия работы</a> · <a href="#/privacy">Политика обработки данных</a>. Цены не являются публичной офертой.${srv.owner ? ' · <a href="#/admin">Пульт</a>' : ''}</p>`;
const priceTxt = (n, monthly) => `от ${rub(n)}${monthly ? '/мес' : ''}`;

/* ---------- Экраны ---------- */
function home() {
  const featuredCases = (D.cases || []).slice(0, 2);
  const dirs = [['bot', 'bot', 'Боты'], ['app', 'app', 'Мини-приложения'], ['smm', 'smm', 'Продвижение']];
  const ben = [['doc', 'Договор и чек', 'самозанятого'], ['shield', 'Данные по 152-ФЗ', 'политика открыта'], ['globe', 'Telegram и MAX', 'одно мини-приложение'], ['clock', '30 дней', 'исправление ошибок']];
  view.innerHTML = `<p class="eyebrow">Цифровые решения для бизнеса</p>
    <section class="hero">
      <p class="eyebrow">Belkov / Digital Studio</p>
      <h1>SMM, боты и мини-приложения <em>под ключ.</em></h1>
      <p>Запускаем продажи в Telegram и MAX: бот, каталог, ИИ-ассистент и продвижение в одних руках.</p>
      <div class="tags"><span class="tag">Telegram</span><span class="tag">MAX</span><span class="tag">Веб</span></div>
    </section>
    ${bannerHtml()}${srv.my ? '<a class="card link" href="#/my"><h3>Мои заявки</h3><p class="meta">Статус, ответы студии и счета</p></a>' : ''}${greetingHtml()}${modeHtml()}
    <h2 class="sec">Что создаём <small>01 / 03</small></h2>
    <div class="grid three">${dirs.map(([d, i, t]) => `<a class="tile" href="#/services" data-dir="${d}">${ic(i)}<b>${t}</b></a>`).join('')}</div>
    <p class="eyebrow" style="margin-top:28px">Почему мы</p>
    <h2 class="sec" style="margin-top:0">Всё в одних руках</h2>
    <p class="lead">Не набор подрядчиков, а одна команда решений.</p>
    <div class="grid two">${ben.map(([i, a, b]) => `<div class="tile">${ic(i)}<div><b>${a}</b><br><span>${b}</span></div></div>`).join('')}</div>
    <h2 class="sec">Проекты студии <a class="more" style="margin:0" href="#/cases">Все кейсы ${ic('out')}</a></h2>
    <div class="grid">${featuredCases.map(c => `<a class="card link" href="#/cases/${esc(c.id)}"><div class="cover"><img src="${esc(c.cover)}" alt="${esc(c.coverAlt)}" loading="lazy"><span class="label">${esc(c.coverLabel || c.title)}</span></div><h3>${esc(c.title)}</h3><p class="meta">${esc(c.task)}</p><span class="more">Посмотреть кейс ${ic('out')}</span></a>`).join('')}</div>
    <p class="eyebrow" style="margin-top:28px">Прозрачный процесс</p>
    <h2 class="sec" style="margin-top:0">Как работаем</h2>
    <ol class="steps">${D.process.map((s, i) => { const [h, ...r] = s.split(' — '); return `<li><span class="n">0${i + 1}</span><div><b>${esc(h)}</b>${r.length ? `<span>${esc(r.join(' — '))}</span>` : ''}</div></li>`; }).join('')}</ol>
    <div class="actions">${flag('calc') ? `<a class="btn btn-wide" href="#/calc">Рассчитать стоимость ${ic('arrow')}</a>` : ''}<a class="btn btn-wide" href="#/faq">Частые вопросы ${ic('arrow')}</a></div>
    ${C.channelTelegram || C.channelMax ? `<h2 class="sec">Канал студии</h2><p class="meta">Кейсы, разборы и цены — подписывайтесь.</p>
    <div class="actions">${C.channelTelegram ? `<button class="btn btn-wide" type="button" data-link="${esc(C.channelTelegram)}">Канал в Telegram ${ic('out')}</button>` : ''}${C.channelMax ? `<button class="btn btn-wide" type="button" data-link="${esc(C.channelMax)}">Канал в MAX ${ic('out')}</button>` : ''}</div>` : ''}${footer()}`;
  setMain('Обсудить проект', () => go('#/brief'));
}

const MY_ST = { new: 'Принята', work: 'В работе', offer: 'Предложение отправлено', contract: 'Договор и оплата', done: 'Завершена', lost: 'Закрыта' };
async function myScreen() {
  view.innerHTML = '<p class="eyebrow">Личное</p><h1>Мои заявки</h1><p class="note">Загружаем…</p>';
  let d = {};
  try { d = await (await fetch('/api/my', { headers: { 'X-Platform': P.kind, 'X-Init-Data': P.sdk?.initData || '' } })).json(); } catch {}
  const L2 = d.leads || [];
  if (!L2.length) { view.innerHTML = '<p class="eyebrow">Личное</p><h1>Мои заявки</h1><p class="lead">Заявок пока нет. Опишите задачу, и мы ответим в этом мессенджере.</p>'; return setMain('Обсудить проект', () => go('#/brief')); }
  view.innerHTML = `<p class="eyebrow">Личное</p><h1>Мои заявки</h1>` + L2.map(l => `<div class="card"><p class="eyebrow" style="margin:0 0 6px">№${l.id} · ${esc(new Date(l.created_at).toLocaleDateString('ru-RU'))} · ${esc(MY_ST[l.status] || l.status)}</p>
    <p>${esc(l.task)}</p>
    ${l.replies.map(m => `<p class="meta"><b>Студия:</b> ${esc(m.text)}</p>`).join('')}
    ${l.invoices.map(i => i.status === 'paid' ? `<p class="meta">Счёт «${esc(i.title)}» — ${rub(i.amount_rub)}: оплачен</p>` : `<a class="btn btn-wide" href="#/pay/${esc(i.pub)}">Оплатить «${esc(i.title)}» — ${rub(i.amount_rub)}</a>`).join('')}</div>`).join('');
  view.insertAdjacentHTML('beforeend', `<p class="note" style="margin-top:24px">Можно отозвать согласие и удалить заявки. Заявки по заключённому договору хранятся по закону.</p>
    <div class="actions"><button class="btn btn-wide" type="button" id="my-del">Удалить мои данные</button></div>`);
  $('#my-del').addEventListener('click', async e => {
    const b = e.currentTarget;
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Нажмите ещё раз, чтобы удалить'; return; }
    b.disabled = true;
    let r = {}; try { r = await (await fetch('/api/my/delete', { method: 'POST', headers: { 'X-Platform': P.kind, 'X-Init-Data': P.sdk?.initData || '' } })).json(); } catch {}
    if (r.ok) { srv.my = false; toast(`Удалено заявок: ${r.deleted}.${r.kept ? ' По договору сохранено: ' + r.kept + '.' : ''}`, 7000); myScreen(); } else { b.disabled = false; toast(r.error || 'Не удалось удалить, напишите в чат студии.'); }
  });
  setMain('Новая заявка', () => go('#/brief'));
}
async function checkMy() {
  if (P.kind === 'web') return;
  try { const d = await (await fetch('/api/my', { headers: { 'X-Platform': P.kind, 'X-Init-Data': P.sdk?.initData || '' } })).json(); if ((d.leads || []).length) { srv.my = true; const [a] = (location.hash || '#/').slice(2).split('/'); if (!a) route(); } } catch {}
}

function services() {
  const list = S.services.filter(s => (state.dir === 'all' || s.dir === state.dir) && (state.plat === 'all' || s.platforms.includes(state.plat)));
  view.innerHTML = `<p class="eyebrow">Услуги</p><h1>Что мы делаем</h1><p class="lead">Выберите направление и площадку. Стоимость уточняется после брифа.</p>
    <div class="chips scroll" role="group" aria-label="Направление">${[{ id: 'all', name: 'Все' }, ...S.directions].map(d => `<button class="chip" type="button" data-f-dir="${d.id}" aria-pressed="${state.dir === d.id}">${esc(d.name)}</button>`).join('')}</div>
    <div class="chips scroll" role="group" aria-label="Площадка">${['all', ...S.platforms].map(p => `<button class="chip" type="button" data-f-plat="${p}" aria-pressed="${state.plat === p}">${p === 'all' ? 'Все площадки' : p}</button>`).join('')}</div>
    <div class="grid" style="margin-top:8px">${list.map(s => `<a class="card link" href="#/services/${s.id}">
      <div class="row"><span class="ico">${ic(s.dir)}</span><span class="price">${priceTxt(s.priceFrom, s.monthly)}</span></div>
      <h3 style="margin-top:14px">${esc(s.name)}</h3><p class="meta">${esc(s.for)}</p>
      <p class="meta" style="display:flex;gap:8px;align-items:center">${ic('clock')}${s.monthly ? 'ежемесячно' : `от ${s.daysFrom} раб. дн.`} · ${s.platforms.join(' · ')}</p>
      ${checks(s.summary)}<span class="more">Подробнее ${ic('out')}</span></a>`).join('') || `<div class="card" style="text-align:center"><p class="meta">Ничего не найдено. Измените фильтры.</p></div>`}</div>
    <h2 class="sec">Дополнительно</h2><div class="card"><ul class="lines" style="border-top:0">${S.addons.map(([n, p]) => `<li><span style="flex:1">${esc(n)}</span><b>${esc(p)}</b></li>`).join('')}</ul></div>
    <h2 class="sec">Условия</h2><div class="card">${checks(S.rules)}</div>${footer()}`;
  if (flag('calc')) setMain('Рассчитать стоимость', () => go('#/calc')); else setMain('Обсудить проект', () => go('#/brief'));
}

function service(id) {
  const s = svcById(id); if (!s) return go('#/services');
  const cs = s.case && caseById(s.case);
  const pop = s.tiers.length >= 3 ? 1 : -1;
  view.innerHTML = `${backBtn('Услуги')}<p class="eyebrow">${esc((S.directions.find(d => d.id === s.dir) || {}).name || '')}</p><h1>${esc(s.name)}</h1><p class="lead">${esc(s.for)}</p>${tags(s.platforms)}
    <h2 class="sec">Что входит</h2><ul class="lines">${s.includes.map(i => `<li>${ic('check')}<span>${esc(i)}</span></li>`).join('')}</ul>
    <p class="eyebrow" style="margin-top:28px">Пакеты</p><h2 class="sec" style="margin-top:0">Тарифы</h2><p class="lead">Точный состав и цена зависят от задачи.</p>
    <div class="grid">${s.tiers.map((t, i) => `<div class="card${i === pop ? ' pick' : ''}">${i === pop ? '<span class="badge-pop">Популярный</span>' : ''}
      <div class="row"><h3>${esc(t.name)}</h3><span class="price acc">${priceTxt(t.price, t.days >= 30)}</span></div>
      <p class="meta">${t.days >= 30 ? 'ежемесячно' : `от ${t.days} раб. дн.`}</p>${checks(t.items)}</div>`).join('')}</div>
    ${s.integrations.length ? `<h2 class="sec">Интеграции</h2>${tags(s.integrations)}` : ''}
    <h2 class="sec">Не входит</h2><ul class="list">${s.excludes.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
    ${cs ? `<h2 class="sec">Пример</h2><a class="card link" href="#/cases/${cs.id}"><h3>${esc(cs.title)}</h3><p class="meta">${esc(cs.task)}</p><span class="more">Смотреть кейс ${ic('out')}</span></a>` : ''}
    <div class="actions"><button class="btn btn-wide" type="button" data-share="svc_${s.id}" data-share-text="${esc(s.name)} — ${esc(C.studio)}">${ic('share')} Поделиться</button></div>`;
  setMain('Хочу эту услугу', () => { state.brief.svc = s.id; go('#/brief'); });
}

function solutions() {
  view.innerHTML = `<p class="eyebrow">По задачам бизнеса</p><h1>Выберите сценарий</h1><p class="lead">Сначала задача. Затем подберём инструмент.</p>
    <div class="grid">${D.solutions.map(x => `<article class="card"><span class="ico">${ic(svcById(x.service)?.dir || 'bot')}</span><h3 style="margin-top:12px">${esc(x.name)}</h3><p class="meta">${esc(x.lead)}</p>${checks(x.items)}
      <div class="actions"><a class="btn btn-wide" href="#/services/${x.service}">Подходящая услуга ${ic('arrow')}</a>${x.case ? `<a class="more" href="#/cases/${x.case}">Посмотреть кейс ${ic('out')}</a>` : ''}</div></article>`).join('')}</div>`;
  setMain('Подобрать решение', () => go('#/brief'));
}

function cases() {
  view.innerHTML = `<p class="eyebrow">Реальные проекты</p><h1>Кейсы</h1><p class="lead">Показываем задачи, интерфейс и то, что сделано.</p>
    <div class="grid">${D.cases.map(c => `<a class="card link" href="#/cases/${c.id}"><div class="cover"><img src="${esc(c.cover)}" alt="${esc(c.coverAlt)}" loading="lazy"><span class="label">${esc(c.coverLabel || c.title)}</span></div>${tags(c.platforms)}<h3 style="margin-top:10px">${esc(c.title)}</h3><p class="meta">${esc(c.task)}</p><span class="more">Открыть кейс ${ic('out')}</span></a>`).join('')}
    </div>`;
  setMain('Обсудить проект', () => go('#/brief'));
}

function caseScreen(id) {
  const c = caseById(id); if (!c) return go('#/cases');
  view.innerHTML = `${backBtn('Кейсы')}<p class="eyebrow">${esc(c.category || "Кейс / цифровой продукт")}</p><h1>${esc(c.title)}</h1><p class="lead">${esc(c.lead || c.task)}</p>${tags(c.platforms.concat(['Мини-приложение']))}
    <div class="cover" style="margin-top:14px"><img src="${esc(c.cover)}" alt="${esc(c.coverAlt)}"><span class="label">${esc(c.coverLabel || c.title)}</span></div>
    <h2 class="sec">Задача</h2><p>${esc(c.task)}</p>
    <h2 class="sec">Что сделали</h2><ol class="num-list">${c.blocks.map(b => `<li><div><b>${esc(b.h)}</b><span>${esc(b.t)}</span></div></li>`).join('')}</ol>
    ${c.galleryNote ? `<p class="note">${esc(c.galleryNote)}</p>` : ""}
    ${c.gallery ? `<p class="eyebrow" style="margin-top:28px">Пример интерфейса</p><h2 class="sec" style="margin-top:0">Экран за экраном</h2>
    <div class="chips scroll gallery" role="list">${c.gallery.map(([src, cap], i) => `<button class="shot" type="button" data-zoom="${i}" data-case-id="${esc(c.id)}" role="listitem" aria-label="Увеличить: ${esc(cap)}"><img src="${esc(src)}" alt="${esc(cap)}" width="160" height="346" loading="lazy"><span>${esc(cap)}</span></button>`).join('')}</div>` : ''}
    <h2 class="sec">Стек</h2>${tags(c.stack)}
    <h2 class="sec">Результат</h2><div class="card"><p class="eyebrow" style="margin:0 0 6px">${esc(c.resultLabel || "Данные после запуска")}</p><p class="meta">${esc(c.result)}</p></div><p class="note">${esc(c.rights || '')}</p>
    <div class="actions">${c.demo ? `<button class="btn btn-wide" type="button" data-link="${esc(c.demo)}">Открыть демо ${ic('out')}</button>` : ''}
      ${c.maxDemo ? `<button class="btn btn-wide" type="button" data-link="${esc(c.maxDemo)}">Проверить в MAX ${ic("out")}</button>` : ""}
      <button class="btn btn-wide" type="button" data-share="case_${c.id}" data-share-text="Кейс: ${esc(c.title)}">${ic('share')} Поделиться</button></div>
    ${c.demoNote ? `<p class="note">${esc(c.demoNote)}</p>` : ""}`;
  setMain("Хочу подобный проект", () => { state.brief.svc = "app"; state.brief.fromCase = c.id; if (!state.brief.task) state.brief.task = `Интересует проект по примеру «${c.title}».`; go("#/brief"); });
}

/* ---------- Калькулятор ---------- */
const TYPE_ICON = { bot: 'bot', app: 'app', ai: 'ai', smm: 'smm' };
const TYPE_SUB = { bot: 'Сценарии, ответы, заявки', app: 'Каталог, запись, интерфейс', ai: 'Ответы на частые вопросы', smm: 'Каналы, контент, продвижение' };
const PLAT_SUB = { tg: 'Бот и мини-приложение', max: 'Мини-приложение и сообщения', both: 'Одна продуктовая логика' };
function calcTotal() {
  const k = state.calc, t = PR.types.find(x => x.id === k.type); if (!t) return null;
  const pk = PR.platforms.find(x => x.id === k.plat)?.k || 1, uk = PR.urgency.find(x => x.id === k.urg)?.k || 1;
  const feats = PR.features.filter(f => k.feats.includes(f.id));
  const from = Math.round(((t.base + feats.reduce((a, f) => a + f.add, 0)) * pk * uk) / 1000) * 1000;
  const days = t.days + feats.reduce((a, f) => a + f.days, 0);
  return { from, to: Math.round(from * PR.spread / 1000) * 1000, days: uk > 1 ? Math.ceil(days * 0.75) : days, t, feats };
}
function calc() {
  const k = state.calc, n = Math.min(k.step, 3);
  const bar = `<div class="progress" aria-hidden="true">${[0, 1, 2, 3].map(i => `<i class="${i <= n || k.step >= 4 ? 'on' : ''}"></i>`).join('')}</div>`;
  const opt = (field, list, sub, multi) => `<div class="opts">${list.map(o => {
    const on = multi ? k[field].includes(o.id) : k[field] === o.id;
    return `<button class="opt${multi ? ' multi' : ''}" type="button" data-calc="${field}:${o.id}" aria-pressed="${on}">${field === 'type' ? `<span class="ico">${ic(TYPE_ICON[o.id])}</span>` : ''}<span class="t"><b>${esc(o.name)}</b><span>${o.add ? '+ ' + rub(o.add) : esc(sub?.[o.id] || '')}</span></span><span class="mark"></span></button>`; }).join('')}</div>`;
  let body;
  if (k.step === 0) body = `<h1>Что нужно?</h1><p class="lead">Выберите формат. Можно обсудить детали позже.</p>${opt('type', PR.types, TYPE_SUB)}`;
  else if (k.step === 1) body = `<h1>Где запускаем?</h1><p class="lead">Выберите платформу для запуска.</p>${opt('plat', PR.platforms, PLAT_SUB)}`;
  else if (k.step === 2) body = `<h1>Какие функции?</h1><p class="lead">Отметьте необходимые возможности.</p>${opt('feats', PR.features, null, true)}`;
  else if (k.step === 3) body = `<h1>Какой срок?</h1><p class="lead">Срочная разработка дороже.</p>${opt('urg', PR.urgency)}`;
  else {
    const r = calcTotal();
    body = `<p class="eyebrow">Предварительный расчёт</p><div class="card"><p class="meta" style="margin:0">Пример расчёта</p><div class="total">${rub(r.from)} –<br>${rub(r.to)}</div><p class="meta">около ${r.days} рабочих дней</p></div>
      <div class="card" style="margin-top:12px"><p class="eyebrow" style="margin:0 0 4px">Вы выбрали</p><div class="kv">
        <div><span>Формат</span><b>${esc(r.t.name)}</b></div><div><span>Площадка</span><b>${esc(PR.platforms.find(x => x.id === k.plat).name)}</b></div>
        <div><span>Функции</span><b>${r.feats.length ? esc(r.feats.map(f => f.name).join(', ')) : '—'}</b></div><div><span>Срок</span><b>${esc(PR.urgency.find(x => x.id === k.urg).name)}</b></div></div></div>
      <p class="note">Это ориентир до брифа, а не оферта. Точная стоимость — после уточнения задачи.</p>
      <div class="actions"><button class="btn btn-wide" type="button" data-calc-restart>Посчитать заново</button></div>`;
  }
  view.innerHTML = `${backBtn('Калькулятор')}<p class="step-label">Шаг ${Math.min(k.step + 1, 4)} из 4</p>${bar}${body}`;
  if (k.step >= 4 && !k.tracked) { k.tracked = true; track('calc'); }
  if (k.step >= 4) setMain('Отправить расчёт', () => { state.brief.calc = calcText(); go('#/brief'); });
  else if (k.step === 2) setMain('Дальше', () => { k.step = 3; calc(); });
  else setMain(null);
}
function calcText() {
  const r = calcTotal(); if (!r) return '';
  return `Расчёт: ${r.t.name}, ${PR.platforms.find(x => x.id === state.calc.plat).name}${r.feats.length ? ', ' + r.feats.map(f => f.name).join(', ') : ''}. Ориентир ${rub(r.from)} – ${rub(r.to)}, ~${r.days} раб. дн.`;
}

function faq() {
  view.innerHTML = `${backBtn()}<p class="eyebrow">Вопросы и ответы</p><h1>Частые вопросы</h1><p class="lead">О важном — без длинных объяснений.</p>
    <div class="grid">${D.faq.map(f => `<details class="faq"><summary>${esc(f.q)}${ic('down')}</summary><p>${esc(f.a)}</p></details>`).join('')}</div>`;
  setMain('Обсудить проект', () => go('#/brief'));
}

function legal(kind) {
  const items = L[kind] || [];
  const titles = { privacy: 'Политика обработки персональных данных', terms: 'Условия работы', consent: 'Согласие на обработку персональных данных' };
  view.innerHTML = `${backBtn()}<p class="eyebrow">Документы</p><h1>${titles[kind]}</h1><p class="meta">Редакция от ${esc(L.updated)}</p>
    <div class="grid" style="margin-top:12px">${items.map(([h, t]) => `<div class="card"><h3>${esc(h)}</h3><p class="meta">${esc(t)}</p></div>`).join('')}</div>
    <div class="actions"><a class="btn btn-wide" href="#/${kind === 'privacy' ? 'consent' : 'privacy'}">${kind === 'privacy' ? 'Согласие на обработку' : 'Политика обработки данных'} ${ic('arrow')}</a></div>`;
  setMain(null);
}
function docs() {
  const base = (C.appWeb || location.href.split('#')[0]).replace(/[^/]*$/, '');
  const files = [
    ['Договор оказания услуг', 'Шаблон для самозанятого: предмет, оплата 50/50, приёмка, гарантия 30 дней, права, 152-ФЗ, реклама. С приложением «Задание».', 'docs/dogovor-samozanyatyj.docx'],
    ['Акт сдачи-приёмки', 'Форма акта к договору: перечень услуг, сумма без НДС, номер чека «Мой налог».', 'docs/akt-samozanyatyj.docx']
  ];
  view.innerHTML = `${backBtn()}<p class="eyebrow">Документы</p><h1>Как мы оформляем работу</h1><p class="meta">Работаем по договору. По каждому платежу — чек самозанятого из «Мой налог». Шаблоны можно скачать и показать юристу заранее; итоговый текст согласуем перед подписанием.</p>
    <div class="grid" style="margin-top:12px">${files.map(([h, t, f]) => `<div class="card"><h3>${esc(h)}</h3><p class="meta">${esc(t)}</p><div class="actions"><button class="btn btn-wide" type="button" data-link="${esc(base + f)}">Скачать .docx ${ic('out')}</button></div></div>`).join('')}
    <a class="card" href="#/terms"><h3>Условия работы</h3><p class="meta">Цены, сроки, оплата, что не входит в стоимость.</p></a>
    <a class="card" href="#/consent"><h3>Согласие на обработку персональных данных</h3><p class="meta">Отдельный документ: цель, данные, срок, как отозвать.</p></a>
    <a class="card" href="#/privacy"><h3>Политика обработки персональных данных</h3><p class="meta">Какие данные, зачем и как отозвать согласие (152-ФЗ).</p></a></div>${footer()}`;
  setMain(null);
}
function zoom(i, caseId) {
  const gallery = caseById(caseId)?.gallery;
  if (!Array.isArray(gallery) || !gallery[i]) return;
  const [src, cap] = gallery[i];
  let d = document.getElementById('zoom');
  if (!d) { d = document.createElement('dialog'); d.id = 'zoom'; d.className = 'zoom'; document.body.append(d); d.addEventListener('click', () => d.close()); }
  d.innerHTML = `<img src="${esc(src)}" alt="${esc(cap)}"><p>${esc(cap)} · нажмите, чтобы закрыть</p>`;
  d.showModal();
}

/* ---------- Заявка ---------- */
function brief() {
  const b = state.brief;
  track('brief');
  view.innerHTML = `${modeHtml()}<p class="eyebrow">Заявка</p><h1>Расскажите о проекте</h1><p class="lead">${b.fromCase && caseById(b.fromCase) ? `По примеру «${esc(caseById(b.fromCase).title)}». ` : ""}Мы подготовим сообщение — отправка в чат будет под вашим контролем.</p>
    <form class="form" data-brief novalidate>
      <div class="field"><label for="b-biz">Ваш бизнес</label><input id="b-biz" name="biz" placeholder="Например, кофейня" value="${esc(b.biz || '')}"></div>
      <div class="field"><label for="b-svc">Что нужно</label><select id="b-svc" name="svc"><option value="">Пока не знаю — нужна консультация</option>${S.services.map(s => `<option value="${s.id}"${s.id === b.svc ? ' selected' : ''}>${esc(s.name)} (${priceTxt(s.priceFrom, s.monthly)})</option>`).join('')}</select></div>
      <div class="field"><label for="b-task">Задача *</label>
        <textarea id="b-task" name="task" required aria-describedby="b-err" placeholder="Что должно измениться для клиентов?">${esc(b.task || '')}</textarea>
        <span class="err" id="b-err" role="alert" hidden>Опишите задачу, чтобы мы поняли запрос.</span></div>
      ${srv.leads && P.kind === 'web' ? `<div class="field"><label for="b-contact">Как с вами связаться *</label><input id="b-contact" name="contact" placeholder="Телефон, e-mail или @username" value="${esc(b.contact || '')}"></div>` : ''}
      ${CFG.has_promos && flag('promo') ? `<div class="field"><label for="b-promo">Промокод</label><div class="chips"><input id="b-promo" name="promo" autocapitalize="characters" value="${esc(b.promo || '')}" placeholder="Если есть"><button class="chip" type="button" data-promo-check>Проверить</button></div><span class="meta" id="b-promo-res" role="status"></span></div>` : ''}
      <div class="field"><label for="b-budget">Бюджет</label><select id="b-budget" name="budget">${['Выбрать диапазон', 'до 50 000 ₽', '50–100 тыс. ₽', '100–200 тыс. ₽', 'более 200 тыс. ₽'].map(o => `<option${o === b.budget ? ' selected' : ''}>${o}</option>`).join('')}</select></div>
      <div class="field"><label for="b-when">Когда нужно</label><select id="b-when" name="when">${['Пока без точной даты', 'В этом месяце', 'Срочно'].map(o => `<option${o === b.when ? ' selected' : ''}>${o}</option>`).join('')}</select></div>
      ${b.calc ? `<div class="card"><p class="eyebrow" style="margin:0 0 4px">Расчёт из калькулятора</p><p class="meta">${esc(b.calc)}</p></div>` : ''}
      <label class="consent"><input type="checkbox" id="b-ok" name="ok" aria-describedby="b-ok-err"${b.ok ? ' checked' : ''}><span>Даю <a href="#/consent">согласие на обработку персональных данных</a> для ответа на заявку; с <a href="#/privacy">Политикой</a> ознакомлен(а)</span></label>
      <span class="err" id="b-ok-err" role="alert" hidden>Нужно согласие, чтобы мы могли ответить.</span>
    </form>
    <p class="note">${srv.leads ? 'Заявка сохранится на сервере студии в России и придёт нам сразу.' : 'Приложение не хранит данные на сервере: текст заявки вы отправляете сами в чат студии.'}</p>
    ${C.phone ? `<p class="note">Или позвоните: <a href="tel:${esc(C.phone.replace(/[^+\d]/g, ''))}">${esc(C.phone)}</a></p>` : ''}`;
  setMain('Отправить заявку', sendBrief);
}
let lastText = '';
async function sendBrief() {
  const form = $('[data-brief]'); if (!form) return;
  if (CFG.state === 'closed') { toast((CFG.blocks.mode || {}).closed_text || 'Приём заявок временно закрыт.'); haptic('heavy'); return; }
  const f = Object.fromEntries(new FormData(form)); Object.assign(state.brief, f); save('brief', state.brief);
  const task = form.querySelector('#b-task'), err = form.querySelector('#b-err');
  if (!String(f.task || '').trim()) { task.setAttribute('aria-invalid', 'true'); err.hidden = false; task.focus(); haptic('heavy'); return; }
  task.removeAttribute('aria-invalid'); err.hidden = true;
  const ok = form.querySelector('#b-ok'), okErr = form.querySelector('#b-ok-err');
  if (!ok.checked) { okErr.hidden = false; ok.focus(); haptic('heavy'); return; }
  okErr.hidden = true;
  const s = svcById(f.svc);
  const fromCase = state.brief.fromCase && caseById(state.brief.fromCase) ? `case_${state.brief.fromCase}` : "";
  const briefSource = [src, fromCase].filter(Boolean).join("__").slice(0, 64);
  const lines = [`Здравствуйте! Заявка в ${C.studio}.`];
  if (f.biz.trim()) lines.push(`Бизнес: ${f.biz.trim()}`);
  lines.push(`Нужно: ${s ? s.name : 'консультация'}`, `Задача: ${f.task.trim()}`);
  if (!/^Выбрать/.test(f.budget)) lines.push(`Бюджет: ${f.budget}`);
  lines.push(`Срок: ${f.when}`);
  if (state.brief.calc) lines.push(state.brief.calc);
  if (f.promo && f.promo.trim()) lines.push(`Промокод: ${f.promo.trim().toUpperCase()}`);
  if (briefSource) lines.push(`Источник: ${briefSource}`);
  lines.push(`Площадка: ${P.kind}`);
  lastText = lines.join('\n');
  if (srv.leads) {
    if (P.kind === 'web' && !String(f.contact || '').trim()) { toast('Укажите, как с вами связаться'); form.querySelector('#b-contact')?.focus(); return; }
    try {
      const r = await fetch('/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Platform': P.kind, 'X-Init-Data': P.sdk?.initData || '' },
        body: JSON.stringify({ biz: f.biz, svc: f.svc, task: f.task, budget: /^Выбрать/.test(f.budget) ? '' : f.budget, when: f.when, calc: state.brief.calc || '', contact: f.contact || '', promo: (f.promo || '').trim(), src: briefSource, consent: true }) });
      const j = await r.json().catch(() => ({}));
      if (j.stored) { track('lead'); hapticOk(); return ready(true); }
      if (r.status !== 202) toast(j.error || 'Не удалось отправить, отправьте текст в чат.');
    } catch { toast('Нет связи с сервером, отправьте текст в чат.'); }
  }
  track('lead');
  hapticOk();
  ready();
}
function openChat() {
  if (P.kind === 'max') { copy(lastText).then(ok => toast(ok ? 'Текст скопирован — вставьте его в чат студии.' : 'Опишите задачу в чате студии.')); openLink(C.maxContactUrl); }
  else openLink(`https://t.me/${C.telegramUsername}?text=${encodeURIComponent(lastText)}`);
}
function ready(stored = false) {
  if (stored) {
    view.innerHTML = `<div class="done">${ic('check')}</div><h1>Заявка отправлена</h1><p class="lead">Мы получили заявку и ответим ${P.kind === 'web' ? 'по указанному контакту' : 'в этом мессенджере'}, обычно в течение рабочего дня.</p>
      <div class="actions"><a class="btn btn-wide" href="#/my">Мои заявки ${ic('arrow')}</a><a class="btn btn-wide" href="#/cases">Посмотреть кейсы ${ic('arrow')}</a></div>`;
    return setMain('На главную', () => go('#/'));
  }
  view.innerHTML = `<div class="done">${ic('check')}</div><h1>Заявка готова</h1><p class="lead">Мы собрали текст. Осталось подтвердить отправку в чате студии.</p>${modeHtml()}
    <div class="card"><p class="eyebrow" style="margin:0 0 6px">Следующие шаги</p><ol class="steps">
      <li><span class="n">01</span><div><b>Откройте чат</b><span>Проверьте текст и отправьте сообщение</span></div></li>
      <li><span class="n">02</span><div><b>Ответ в рабочее время</b><span>Обычно отвечаем в течение рабочего дня</span></div></li>
      <li><span class="n">03</span><div><b>Созвон 30 минут</b><span>Обсудим задачу, сроки и бюджет</span></div></li></ol></div>
    <div class="actions"><a class="btn btn-wide" href="#/cases">Посмотреть кейсы ${ic('arrow')}</a></div>`;
  setMain('Открыть чат студии', openChat);
}

/* Вкладка «Пульт» в нижнем меню — только у владельца */
function addPultTab() {
  const nav = document.querySelector('.tabs'); if (!nav || nav.querySelector('[data-tab="admin"]')) return;
  nav.insertAdjacentHTML('beforeend', `<a href="#/admin" data-tab="admin"><span class="pill">${ic('shield')}</span>Пульт</a>`);
  nav.style.setProperty('--tabs-n', '6');
}

/* ---------- Навигация ---------- */
function go(h) { if (location.hash === h) route(); else location.hash = h; }
function resetCaseSourceOnNavigation(routeName) {
  if (routeName !== 'brief') delete state.brief.fromCase;
}
function route() {
  const [a, b] = (location.hash || '#/').slice(2).split('/');
  resetCaseSourceOnNavigation(a);
  const tab = ({ services: 'services', solutions: 'solutions', cases: 'cases', brief: 'brief', admin: 'admin', calc: 'services' })[a] || (a === 'faq' ? 'home' : 'home');
  document.querySelectorAll('.tabs a').forEach(x => x.dataset.tab === tab ? x.setAttribute('aria-current', 'page') : x.removeAttribute('aria-current'));
  const deep = (a === 'services' && b) || (a === 'cases' && b) || ['calc', 'faq', 'my', 'pay', 'privacy', 'terms', 'consent', 'docs', 'admin'].includes(a);
  setBack(deep ? () => back() : null);
  if (a === 'services') b ? service(b) : services();
  else if (a === 'solutions') solutions();
  else if (a === 'cases') b ? caseScreen(b) : cases();
  else if (a === 'calc') (flag('calc') ? calc() : go('#/brief'));
  else if (a === 'faq') faq();
  else if (a === 'privacy' || a === 'terms' || a === 'consent') legal(a);
  else if (a === 'docs') docs();
  else if (a === 'my') myScreen();
  else if (a === 'brief') brief();
  else if (a === 'admin') admin(b);
  else if (a === 'pay' && b) payScreen(b);
  else home();
  window.scrollTo(0, 0);
}
function back() {
  const [a] = (location.hash || '#/').slice(2).split('/');
  if (a === 'calc' && state.calc.step > 0 && state.calc.step < 4) { state.calc.step--; return calc(); }
  history.length > 1 ? history.back() : go('#/');
}

document.addEventListener('click', async e => {
  const z = e.target.closest('[data-zoom]'); if (z) return zoom(+z.dataset.zoom, z.dataset.caseId);
  const pc = e.target.closest('[data-promo-check]');
  if (pc) {
    const code = ($('#b-promo').value || '').trim(); const out = $('#b-promo-res'); if (!code) { out.textContent = ''; return; }
    out.textContent = 'Проверяем…';
    try { const r = await (await fetch('/api/promo/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })).json(); out.textContent = r.text || ''; haptic(); } catch { out.textContent = 'Не удалось проверить'; }
    return;
  }
  const t = e.target.closest('[data-link],[data-dir],[data-f-dir],[data-f-plat],[data-calc],[data-calc-restart],[data-share],[data-back]'); if (!t) return;
  const d = t.dataset;
  if (d.link) { e.preventDefault(); return openLink(d.link); }
  if (d.dir) { state.dir = d.dir; state.plat = 'all'; return; }
  if (d.fDir) { haptic(); state.dir = d.fDir; return services(); }
  if (d.fPlat) { haptic(); state.plat = d.fPlat; return services(); }
  if ('back' in d) return back();
  if ('calcRestart' in d) { Object.assign(state.calc, { step: 0, type: null, plat: null, feats: [], urg: null, tracked: false }); return calc(); }
  if (d.calc) {
    haptic(); const [field, val] = d.calc.split(':'), k = state.calc;
    if (field === 'feats') { k.feats = k.feats.includes(val) ? k.feats.filter(x => x !== val) : [...k.feats, val]; return calc(); }
    k[field] = val; k.step = ({ type: 1, plat: 2, urg: 4 })[field]; return calc();
  }
  if (d.share) {
    const sp = `${d.share}__src_share`;
    const url = P.kind === 'max' ? `${C.appMax}?startapp=${sp}` : P.kind === 'telegram' ? `${C.appTelegram}?startapp=${sp}` : `${C.appWeb}?startapp=${sp}`;
    return share(url, d.shareText || C.studio);
  }
});
document.addEventListener('input', e => { const f = e.target.closest('[data-brief]'); if (f && e.target.name) state.brief[e.target.name] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; });
window.addEventListener('hashchange', route);

(async () => {
  window.__step = 'platform';
  await initPlatform();
  window.__step = 'data';
  [S, D, PR, L] = await Promise.all(['data/services.json', 'data/content.json', 'data/pricing.json', 'data/legal.json'].map(u => fetch(u).then(r => r.json())));
  window.__step = 'draft';
  Object.assign(state.brief, (await load('brief')) || {});
  delete state.brief.fromCase; // case attribution must come from a fresh explicit case CTA
  window.__step = 'status';
  bindBack(); bindMain();
  window.addEventListener('offline', () => toast('Нет связи с интернетом. Черновик заявки сохранён на устройстве.', 8000));
  window.addEventListener('online', () => { $('#toast').hidden = true; });
  readStart();
  try { srv.leads = !!(await (await fetch('/api/status', { signal: AbortSignal.timeout(5000) })).json()).leads; } catch {}
  window.__step = 'config';
  await loadConfig();
  applyConfig(CFG.blocks);
  window.__step = 'route';
  route();
  window.__booted = true;
  track('open');
  checkMy();
  isOwner().then(ok => { if (ok) { srv.owner = true; addPultTab(); const [a] = (location.hash || '#/').slice(2).split('/'); if (a !== 'admin') route(); } });
})();
