import { CONFIG as C } from './config.js';
import { P, initPlatform, haptic, hapticOk, openLink, setBack, bindBack, setMain, bindMain, save, load, share } from './platform.js';

const $ = s => document.querySelector(s);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rub = n => new Intl.NumberFormat('ru-RU').format(n) + ' ₽';
let toastT;
function toast(t, ms = 5000) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, ms); }
async function copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }

let D = {}, S = {}, PR = {};
const state = { dir: 'all', plat: 'all', calc: { step: 0, type: null, plat: null, feats: [], urg: null }, brief: {} };
let src = '';

/* ---------- Источник и глубокие ссылки ---------- */
function readStart() {
  const q = new URLSearchParams(location.search);
  const raw = (P.startParam || q.get('startapp') || q.get('src') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
  // svc_bot · case_triumf · calc · brief · src_channel; можно склеить через "__": svc_app__src_channel
  for (const part of raw.split('__')) {
    if (part.startsWith('src_')) src = part.slice(4);
    else if (part.startsWith('svc_')) location.hash = `#/services/${part.slice(4)}`;
    else if (part.startsWith('case_')) location.hash = `#/cases/${part.slice(5)}`;
    else if (part === 'calc') location.hash = '#/calc';
    else if (part === 'brief') location.hash = '#/brief';
    else if (part && !src && !q.get('startapp')) src = part;
  }
  if (!src && q.get('src')) src = q.get('src').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

/* ---------- Экраны ---------- */
const svcById = id => S.services.find(s => s.id === id);
const caseById = id => D.cases.find(c => c.id === id);
const backBtn = () => P.kind === 'web' ? '<button class="back" type="button" data-back>← Назад</button>' : '';

function home() {
  const c = D.cases[0];
  view.innerHTML = `<h1>SMM, боты и мини-приложения под ключ</h1>
    <p class="lead">Запускаем продажи в Telegram и MAX: бот, каталог в мессенджере, ИИ-ассистент и продвижение — в одних руках.</p>
    <div class="grid">
      ${[['bot', 'Боты', 'Отвечают клиентам 24/7 и присылают вам заявки'], ['app', 'Мини-приложения', 'Каталог, запись, подбор — прямо в мессенджере'], ['smm', 'Продвижение', 'Канал, контент, реклама и учёт, откуда клиент']].map(([d, h, t]) =>
        `<a class="card link" href="#/services" data-dir="${d}"><h3>${h}</h3><p class="meta">${t}</p></a>`).join('')}
    </div>
    <h2 class="sec">Почему с нами</h2>
    <div class="trust">${D.trust.map(t => `<div>${esc(t)}</div>`).join('')}</div>
    <h2 class="sec">Кейс</h2>
    <a class="card link" href="#/cases/${c.id}"><div class="row"><h3>${esc(c.title)}</h3><span class="meta">${c.platforms.join(', ')}</span></div><p class="meta">${esc(c.task)}</p></a>
    <h2 class="sec">Как работаем</h2>
    <ol class="steps">${D.process.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
    <div class="actions"><a class="btn btn-wide" href="#/calc">Рассчитать стоимость</a><a class="btn btn-wide" href="#/faq">Частые вопросы</a></div>
    <h2 class="sec">Канал студии</h2><p class="meta">Кейсы, разборы и цены — подписывайтесь.</p>
    <div class="actions">${C.channelTelegram ? `<button class="btn btn-wide" type="button" data-link="${esc(C.channelTelegram)}">Канал в Telegram</button>` : ''}${C.channelMax ? `<button class="btn btn-wide" type="button" data-link="${esc(C.channelMax)}">Канал в MAX</button>` : ''}</div>`;
  setMain('Обсудить проект', () => go('#/brief'));
}

function services() {
  const list = S.services.filter(s => (state.dir === 'all' || s.dir === state.dir) && (state.plat === 'all' || s.platforms.includes(state.plat)));
  view.innerHTML = `<h1>Услуги</h1><p class="lead">Цены — ориентир «от». Точную стоимость называем после брифа.</p>
    <div class="chips scroll" role="group" aria-label="Направление">${[{ id: 'all', name: 'Все' }, ...S.directions].map(d => `<button class="chip" type="button" data-f-dir="${d.id}" aria-pressed="${state.dir === d.id}">${esc(d.name)}</button>`).join('')}</div>
    <div class="chips scroll" role="group" aria-label="Площадка">${['all', ...S.platforms].map(p => `<button class="chip" type="button" data-f-plat="${p}" aria-pressed="${state.plat === p}">${p === 'all' ? 'Все площадки' : p}</button>`).join('')}</div>
    <div class="grid" style="margin-top:12px">${list.map(s => `<a class="card link" href="#/services/${s.id}">
      <div class="row"><h3>${esc(s.name)}</h3><span class="price">от ${rub(s.priceFrom)}${s.monthly ? '/мес' : ''}</span></div>
      <p class="meta">${esc(s.for)}${s.monthly ? '' : ` · от ${s.daysFrom} раб. дн.`}</p>
      <ul class="list">${s.summary.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
      <div class="badges">${s.platforms.map(p => `<span class="badge">${p}</span>`).join('')}</div></a>`).join('') || '<p class="meta">По выбранным фильтрам ничего нет.</p>'}</div>
    <h2 class="sec">Дополнительно</h2><div class="card"><ul class="list">${S.addons.map(([n, p]) => `<li>${esc(n)} — <b>${esc(p)}</b></li>`).join('')}</ul></div>
    <h2 class="sec">Условия</h2><div class="card"><ul class="list">${S.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>`;
  setMain('Рассчитать стоимость', () => go('#/calc'));
}

function service(id) {
  const s = svcById(id); if (!s) return go('#/services');
  const cs = s.case && caseById(s.case);
  view.innerHTML = `${backBtn()}<h1>${esc(s.name)}</h1><p class="lead">${esc(s.for)}</p>
    <div class="badges">${s.platforms.map(p => `<span class="badge">${p}</span>`).join('')}</div>
    <h2 class="sec">Что входит</h2><ul class="list">${s.includes.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
    <h2 class="sec">Тарифы</h2><div class="tiers">${s.tiers.map(t => `<div class="tier"><div class="row"><h3>${esc(t.name)}</h3><span class="price">от ${rub(t.price)}${t.days >= 30 ? '/мес' : ''}</span></div><p class="meta">${t.days >= 30 ? 'Ежемесячно' : `Срок: от ${t.days} раб. дн.`}</p><ul class="list">${t.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}</div>
    ${s.integrations.length ? `<h2 class="sec">Интеграции</h2><div class="badges">${s.integrations.map(i => `<span class="badge">${esc(i)}</span>`).join('')}</div>` : ''}
    <h2 class="sec">Не входит</h2><ul class="list">${s.excludes.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
    ${cs ? `<h2 class="sec">Пример</h2><a class="card link" href="#/cases/${cs.id}"><h3>${esc(cs.title)}</h3><p class="meta">${esc(cs.task)}</p></a>` : ''}
    <div class="actions"><button class="btn btn-wide" type="button" data-share="svc_${s.id}" data-share-text="${esc(s.name)} — ${esc(C.studio)}">Поделиться</button></div>`;
  setMain('Хочу эту услугу', () => { state.brief.svc = s.id; go('#/brief'); });
}

function solutions() {
  view.innerHTML = `<h1>Решения</h1><p class="lead">Готовые сценарии под задачи бизнеса.</p>
    <div class="grid">${D.solutions.map(x => `<article class="card"><h3>${esc(x.name)}</h3><p class="meta">${esc(x.lead)}</p>
      <ul class="list">${x.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
      <div class="actions"><a class="btn btn-wide" href="#/services/${x.service}">Подходящая услуга</a>${x.case ? `<a class="btn btn-wide" href="#/cases/${x.case}">Посмотреть кейс</a>` : ''}</div></article>`).join('')}</div>`;
  setMain('Обсудить задачу', () => go('#/brief'));
}

function cases() {
  view.innerHTML = `<h1>Кейсы</h1><div class="grid">${D.cases.map(c => `<a class="card link" href="#/cases/${c.id}"><img src="${esc(c.cover)}" alt="${esc(c.coverAlt)}" width="640" height="640" loading="lazy" style="width:100%;height:auto;border-radius:12px"><h3 style="margin-top:10px">${esc(c.title)}</h3><p class="meta">${esc(c.task)}</p></a>`).join('')}</div>`;
  setMain('Хочу так же', () => go('#/brief'));
}

function caseScreen(id) {
  const c = caseById(id); if (!c) return go('#/cases');
  view.innerHTML = `${backBtn()}<h1>${esc(c.title)}</h1><div class="badges">${c.platforms.map(p => `<span class="badge">${p}</span>`).join('')}</div>
    <img src="${esc(c.cover)}" alt="${esc(c.coverAlt)}" width="640" height="640" style="width:100%;height:auto;border-radius:12px;margin-top:12px">
    <h2 class="sec">Задача</h2><p>${esc(c.task)}</p>
    <h2 class="sec">Что сделали</h2><div class="grid">${c.blocks.map(b => `<div class="card"><h3>${esc(b.h)}</h3><p class="meta">${esc(b.t)}</p></div>`).join('')}</div>
    <h2 class="sec">Стек</h2><div class="badges">${c.stack.map(s => `<span class="badge">${esc(s)}</span>`).join('')}</div>
    <h2 class="sec">Результат</h2><p class="meta">${esc(c.result)}</p>
    <div class="actions">${c.demo ? `<button class="btn btn-wide" type="button" data-link="${esc(c.demo)}">Открыть демо</button>` : ''}
      <button class="btn btn-wide" type="button" data-share="case_${c.id}" data-share-text="Кейс: ${esc(c.title)}">Поделиться</button></div>`;
  setMain('Хочу так же', () => { state.brief.svc = 'app'; go('#/brief'); });
}

function calcTotal() {
  const k = state.calc, t = PR.types.find(x => x.id === k.type);
  if (!t) return null;
  const pk = PR.platforms.find(x => x.id === k.plat)?.k || 1, uk = PR.urgency.find(x => x.id === k.urg)?.k || 1;
  const feats = PR.features.filter(f => k.feats.includes(f.id));
  const from = Math.round(((t.base + feats.reduce((a, f) => a + f.add, 0)) * pk * uk) / 1000) * 1000;
  const days = t.days + feats.reduce((a, f) => a + f.days, 0);
  return { from, to: Math.round(from * PR.spread / 1000) * 1000, days: uk > 1 ? Math.ceil(days * 0.75) : days, t, feats };
}
function calc() {
  const k = state.calc, steps = 4;
  const bar = `<div class="progress" aria-hidden="true"><i style="width:${Math.min(k.step, steps) / steps * 100}%"></i></div>`;
  const opt = (field, list, multi) => `<div class="opts">${list.map(o => {
    const on = multi ? k[field].includes(o.id) : k[field] === o.id;
    return `<button class="opt" type="button" data-calc="${field}:${o.id}" aria-pressed="${on}"><span>${esc(o.name)}</span>${o.add ? `<span class="meta">+${rub(o.add)}</span>` : ''}</button>`; }).join('')}</div>`;
  let body;
  if (k.step === 0) body = `<h2 class="sec">Что нужно?</h2>${opt('type', PR.types)}`;
  else if (k.step === 1) body = `<h2 class="sec">Где?</h2>${opt('plat', PR.platforms)}`;
  else if (k.step === 2) body = `<h2 class="sec">Какие функции?</h2><p class="meta">Можно несколько или ни одной.</p>${opt('feats', PR.features, true)}`;
  else if (k.step === 3) body = `<h2 class="sec">Срок</h2>${opt('urg', PR.urgency)}`;
  else {
    const r = calcTotal();
    body = `<h2 class="sec">Ориентир</h2><div class="card"><div class="total">${rub(r.from)} – ${rub(r.to)}</div><p class="meta">Срок: около ${r.days} рабочих дней</p>
      <ul class="list"><li>${esc(r.t.name)}</li><li>${esc(PR.platforms.find(x => x.id === k.plat).name)}</li>${r.feats.map(f => `<li>${esc(f.name)}</li>`).join('')}</ul>
      <p class="meta">Это ориентир. Точную цену называем после брифа.</p></div>
      <div class="actions"><button class="btn btn-wide" type="button" data-calc-restart>Посчитать заново</button></div>`;
  }
  view.innerHTML = `${backBtn()}<h1>Калькулятор</h1>${bar}${body}`;
  if (k.step >= steps) setMain('Отправить расчёт', () => { state.brief.calc = calcText(); go('#/brief'); });
  else if (k.step === 2) setMain('Дальше', () => { k.step = 3; route(); });
  else setMain(null);
}
function calcText() {
  const r = calcTotal(); if (!r) return '';
  return `Расчёт: ${r.t.name}, ${PR.platforms.find(x => x.id === state.calc.plat).name}${r.feats.length ? ', ' + r.feats.map(f => f.name).join(', ') : ''}. Ориентир ${rub(r.from)} – ${rub(r.to)}, ~${r.days} дн.`;
}

function faq() {
  view.innerHTML = `${backBtn()}<h1>Частые вопросы</h1><div class="grid">${D.faq.map(f => `<details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</div>`;
  setMain('Задать свой вопрос', () => go('#/brief'));
}

function brief() {
  const b = state.brief;
  view.innerHTML = `<h1>Заявка</h1><p class="lead">Опишите задачу — ответим в течение рабочего дня и предложим решение.</p>
    <form class="form" data-brief novalidate>
      <div class="field"><label for="b-biz">Ваш бизнес</label><input id="b-biz" name="biz" placeholder="Например, мотосалон, кофейня, автосервис" value="${esc(b.biz || '')}"></div>
      <div class="field"><label for="b-svc">Что нужно</label><select id="b-svc" name="svc"><option value="">Пока не знаю — нужна консультация</option>${S.services.map(s => `<option value="${s.id}"${s.id === b.svc ? ' selected' : ''}>${esc(s.name)} (от ${rub(s.priceFrom)})</option>`).join('')}</select></div>
      <div class="field"><label for="b-task">Задача <span aria-hidden="true">*</span></label>
        <textarea id="b-task" name="task" required aria-describedby="b-err" placeholder="Что хотите получить: больше заявок, каталог, запись клиентов…">${esc(b.task || '')}</textarea>
        <span class="err" id="b-err" role="alert" hidden>Опишите задачу хотя бы парой слов.</span></div>
      <div class="field"><label for="b-budget">Бюджет</label><select id="b-budget" name="budget">${['Не знаю', 'до 50 000 ₽', '50–100 тыс. ₽', '100–200 тыс. ₽', 'более 200 тыс. ₽'].map(o => `<option${o === b.budget ? ' selected' : ''}>${o}</option>`).join('')}</select></div>
      <div class="field"><label for="b-when">Когда нужно</label><select id="b-when" name="when">${['Не горит', 'В этом месяце', 'Срочно'].map(o => `<option${o === b.when ? ' selected' : ''}>${o}</option>`).join('')}</select></div>
      ${b.calc ? `<div class="card"><p class="meta">${esc(b.calc)}</p></div>` : ''}
    </form>
    <p class="note">Данные никуда не сохраняются: готовый текст заявки вы отправляете сами в чат студии${P.kind === 'max' ? ' в MAX' : ' в Telegram'}.</p>
    ${C.phone ? `<p class="note">Или позвоните: <a href="tel:${esc(C.phone.replace(/[^+\d]/g, ''))}">${esc(C.phone)}</a></p>` : ''}`;
  setMain('Отправить заявку', sendBrief);
}
async function sendBrief() {
  const form = $('[data-brief]'); if (!form) return;
  const f = Object.fromEntries(new FormData(form)); Object.assign(state.brief, f); save('brief', state.brief);
  const task = form.querySelector('#b-task'), err = form.querySelector('#b-err');
  if (!String(f.task || '').trim()) { task.setAttribute('aria-invalid', 'true'); err.hidden = false; task.focus(); haptic('heavy'); return; }
  task.removeAttribute('aria-invalid'); err.hidden = true;
  const s = svcById(f.svc);
  const lines = [`Здравствуйте! Заявка в ${C.studio}.`];
  if (f.biz.trim()) lines.push(`Бизнес: ${f.biz.trim()}`);
  lines.push(`Нужно: ${s ? s.name : 'консультация'}`, `Задача: ${f.task.trim()}`, `Бюджет: ${f.budget}`, `Срок: ${f.when}`);
  if (state.brief.calc) lines.push(state.brief.calc);
  if (src) lines.push(`Источник: ${src}`);
  lines.push(`Площадка: ${P.kind}`);
  const text = lines.join('\n');
  hapticOk();
  if (P.kind === 'max') { const ok = await copy(text); toast(ok ? 'Текст заявки скопирован — вставьте его в чат студии.' : 'Опишите задачу в чате студии.'); openLink(C.maxContactUrl); }
  else openLink(`https://t.me/${C.telegramUsername}?text=${encodeURIComponent(text)}`);
  view.innerHTML = `<h1>Заявка готова</h1><p class="lead">Отправьте сообщение в открывшемся чате — ответим в течение рабочего дня. Дальше — созвон 30 минут и предложение.</p>
    <div class="actions"><a class="btn btn-wide" href="#/cases">Посмотреть кейсы</a></div>`;
  setMain(null);
}

/* ---------- Навигация ---------- */
function go(h) { if (location.hash === h) route(); else location.hash = h; }
function route() {
  const parts = (location.hash || '#/').slice(2).split('/');
  const [a, b] = parts;
  const tab = ({ services: 'services', solutions: 'solutions', cases: 'cases', brief: 'brief' })[a] || (a === 'calc' || a === 'faq' ? null : 'home');
  document.querySelectorAll('.tabs a').forEach(x => x.dataset.tab === tab ? x.setAttribute('aria-current', 'page') : x.removeAttribute('aria-current'));
  const deep = (a === 'services' && b) || (a === 'cases' && b) || a === 'calc' || a === 'faq';
  setBack(deep ? () => history.length > 1 ? history.back() : go('#/') : null);
  if (a === 'services') b ? service(b) : services();
  else if (a === 'solutions') solutions();
  else if (a === 'cases') b ? caseScreen(b) : cases();
  else if (a === 'calc') calc();
  else if (a === 'faq') faq();
  else if (a === 'brief') brief();
  else home();
  window.scrollTo(0, 0);
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-link],[data-dir],[data-f-dir],[data-f-plat],[data-calc],[data-calc-restart],[data-share],[data-back]'); if (!t) return;
  const d = t.dataset;
  if (d.link) { e.preventDefault(); return openLink(d.link); }
  if (d.dir) { state.dir = d.dir; state.plat = 'all'; return; }
  if (d.fDir) { haptic(); state.dir = d.fDir; return services(); }
  if (d.fPlat) { haptic(); state.plat = d.fPlat; return services(); }
  if ('back' in d) return history.back();
  if ('calcRestart' in d) { Object.assign(state.calc, { step: 0, type: null, plat: null, feats: [], urg: null }); return calc(); }
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
document.addEventListener('input', e => { const f = e.target.closest('[data-brief]'); if (f && e.target.name) { state.brief[e.target.name] = e.target.value; } });
window.addEventListener('hashchange', route);

(async () => {
  await initPlatform();
  [S, D, PR] = await Promise.all(['data/services.json', 'data/content.json', 'data/pricing.json'].map(u => fetch(u).then(r => r.json())));
  Object.assign(state.brief, (await load('brief')) || {});
  bindBack(); bindMain();
  readStart();
  route();
})();
