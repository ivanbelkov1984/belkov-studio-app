import { CONFIG as C } from './config.js';
import { P, initPlatform, haptic, hapticOk, openLink, setBack, bindBack, setMain, bindMain, save, load, share } from './platform.js';

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

/* ---------- Источник и глубокие ссылки ---------- */
function readStart() {
  const q = new URLSearchParams(location.search);
  const raw = (P.startParam || q.get('startapp') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
  for (const part of raw.split('__')) {
    if (part.startsWith('src_')) src = part.slice(4);
    else if (part.startsWith('svc_')) location.hash = `#/services/${part.slice(4)}`;
    else if (part.startsWith('case_')) location.hash = `#/cases/${part.slice(5)}`;
    else if (part === 'calc') location.hash = '#/calc';
    else if (part === 'brief') location.hash = '#/brief';
  }
  if (!src && q.get('src')) src = q.get('src').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

const svcById = id => S.services.find(s => s.id === id);
const caseById = id => D.cases.find(c => c.id === id);
const backBtn = (label = 'Назад') => P.kind === 'web' ? `<button class="back" type="button" data-back>${ic('back')}${esc(label)}</button>` : '';
const footer = () => `<p class="note" style="margin-top:28px">${esc(L.operator || '')}. <a href="#/terms">Условия работы</a> · <a href="#/privacy">Политика обработки данных</a>. Цены не являются публичной офертой.</p>`;
const priceTxt = (n, monthly) => `от ${rub(n)}${monthly ? '/мес' : ''}`;

/* ---------- Экраны ---------- */
function home() {
  const c = D.cases[0];
  const dirs = [['bot', 'bot', 'Боты'], ['app', 'app', 'Мини-приложения'], ['smm', 'smm', 'Продвижение']];
  const ben = [['doc', 'Договор и чек', 'самозанятого'], ['shield', 'Данные по 152-ФЗ', 'политика открыта'], ['globe', 'Telegram и MAX', 'одно мини-приложение'], ['clock', '30 дней', 'исправление ошибок']];
  view.innerHTML = `<p class="eyebrow">Цифровые решения для бизнеса</p>
    <section class="hero">
      <p class="eyebrow">Belkov / Digital Studio</p>
      <h1>SMM, боты и мини-приложения <em>под ключ.</em></h1>
      <p>Запускаем продажи в Telegram и MAX: бот, каталог, ИИ-ассистент и продвижение в одних руках.</p>
      <div class="tags"><span class="tag">Telegram</span><span class="tag">MAX</span><span class="tag">Веб</span></div>
    </section>
    <h2 class="sec">Что создаём <small>01 / 03</small></h2>
    <div class="grid three">${dirs.map(([d, i, t]) => `<a class="tile" href="#/services" data-dir="${d}">${ic(i)}<b>${t}</b></a>`).join('')}</div>
    <p class="eyebrow" style="margin-top:28px">Почему мы</p>
    <h2 class="sec" style="margin-top:0">Всё в одних руках</h2>
    <p class="lead">Не набор подрядчиков, а одна команда решений.</p>
    <div class="grid two">${ben.map(([i, a, b]) => `<div class="tile">${ic(i)}<div><b>${a}</b><br><span>${b}</span></div></div>`).join('')}</div>
    <h2 class="sec">Кейс студии <a class="more" style="margin:0" href="#/cases">Все кейсы ${ic('out')}</a></h2>
    <a class="card link" href="#/cases/${c.id}"><div class="cover"><img src="${esc(c.cover)}" alt="${esc(c.coverAlt)}" loading="lazy"><span class="label">Triumph / каталог</span></div><h3>${esc(c.title)}</h3><p class="meta">${esc(c.task)}</p></a>
    <p class="eyebrow" style="margin-top:28px">Прозрачный процесс</p>
    <h2 class="sec" style="margin-top:0">Как работаем</h2>
    <ol class="steps">${D.process.map((s, i) => { const [h, ...r] = s.split(' — '); return `<li><span class="n">0${i + 1}</span><div><b>${esc(h)}</b>${r.length ? `<span>${esc(r.join(' — '))}</span>` : ''}</div></li>`; }).join('')}</ol>
    <div class="actions"><a class="btn btn-wide" href="#/calc">Рассчитать стоимость ${ic('arrow')}</a><a class="btn btn-wide" href="#/faq">Частые вопросы ${ic('arrow')}</a></div>
    ${C.channelTelegram || C.channelMax ? `<h2 class="sec">Канал студии</h2><p class="meta">Кейсы, разборы и цены — подписывайтесь.</p>
    <div class="actions">${C.channelTelegram ? `<button class="btn btn-wide" type="button" data-link="${esc(C.channelTelegram)}">Канал в Telegram ${ic('out')}</button>` : ''}${C.channelMax ? `<button class="btn btn-wide" type="button" data-link="${esc(C.channelMax)}">Канал в MAX ${ic('out')}</button>` : ''}</div>` : ''}${footer()}`;
  setMain('Обсудить проект', () => go('#/brief'));
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
  setMain('Рассчитать стоимость', () => go('#/calc'));
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
    <div class="grid">${D.cases.map(c => `<a class="card link" href="#/cases/${c.id}"><div class="cover"><img src="${esc(c.cover)}" alt="${esc(c.coverAlt)}" loading="lazy"><span class="label">Triumph / Mini App</span></div>${tags(c.platforms)}<h3 style="margin-top:10px">${esc(c.title)}</h3><p class="meta">${esc(c.task)}</p><span class="more">Открыть кейс ${ic('out')}</span></a>`).join('')}
      <div class="card"><span class="badge-pop">Скоро</span><h3>Новый проект</h3><p class="meta">Кейс появится после разрешения клиента на публикацию.</p></div></div>`;
  setMain('Обсудить проект', () => go('#/brief'));
}

function caseScreen(id) {
  const c = caseById(id); if (!c) return go('#/cases');
  view.innerHTML = `${backBtn('Кейсы')}<p class="eyebrow">Кейс / мототехника</p><h1>${esc(c.title)}</h1><p class="lead">Мини-приложение-каталог и сервисный контур для мотосалона.</p>${tags(c.platforms.concat(['Мини-приложение']))}
    <div class="cover" style="margin-top:14px"><img src="${esc(c.cover)}" alt="${esc(c.coverAlt)}"><span class="label">Triumph / 100 моделей</span></div>
    <h2 class="sec">Задача</h2><p>${esc(c.task)}</p>
    <h2 class="sec">Что сделали</h2><ol class="num-list">${c.blocks.map(b => `<li><div><b>${esc(b.h)}</b><span>${esc(b.t)}</span></div></li>`).join('')}</ol>
    ${c.gallery ? `<p class="eyebrow" style="margin-top:28px">Пример интерфейса</p><h2 class="sec" style="margin-top:0">Экран за экраном</h2>
    <div class="chips scroll gallery" role="list">${c.gallery.map(([src, cap], i) => `<button class="shot" type="button" data-zoom="${i}" role="listitem" aria-label="Увеличить: ${esc(cap)}"><img src="${esc(src)}" alt="${esc(cap)}" width="160" height="346" loading="lazy"><span>${esc(cap)}</span></button>`).join('')}</div>` : ''}
    <h2 class="sec">Стек</h2>${tags(c.stack)}
    <h2 class="sec">Результат</h2><div class="card"><p class="eyebrow" style="margin:0 0 6px">Данные после запуска</p><p class="meta">${esc(c.result)}</p></div><p class="note">${esc(c.rights || '')}</p>
    <div class="actions">${c.demo ? `<button class="btn btn-wide" type="button" data-link="${esc(c.demo)}">Открыть демо ${ic('out')}</button>` : ''}
      <button class="btn btn-wide" type="button" data-share="case_${c.id}" data-share-text="Кейс: ${esc(c.title)}">${ic('share')} Поделиться</button></div>`;
  setMain('Хочу так же', () => { state.brief.svc = 'app'; go('#/brief'); });
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
  view.innerHTML = `${backBtn()}<p class="eyebrow">Документы</p><h1>${kind === 'privacy' ? 'Политика обработки персональных данных' : 'Условия работы'}</h1><p class="meta">Редакция от ${esc(L.updated)}</p>
    <div class="grid" style="margin-top:12px">${items.map(([h, t]) => `<div class="card"><h3>${esc(h)}</h3><p class="meta">${esc(t)}</p></div>`).join('')}</div>
    <div class="actions"><a class="btn btn-wide" href="#/${kind === 'privacy' ? 'terms' : 'privacy'}">${kind === 'privacy' ? 'Условия работы' : 'Политика обработки данных'} ${ic('arrow')}</a></div>`;
  setMain(null);
}
function zoom(i) {
  const [src, cap] = D.cases[0].gallery[i];
  let d = document.getElementById('zoom');
  if (!d) { d = document.createElement('dialog'); d.id = 'zoom'; d.className = 'zoom'; document.body.append(d); d.addEventListener('click', () => d.close()); }
  d.innerHTML = `<img src="${esc(src)}" alt="${esc(cap)}"><p>${esc(cap)} · нажмите, чтобы закрыть</p>`;
  d.showModal();
}

/* ---------- Заявка ---------- */
function brief() {
  const b = state.brief;
  view.innerHTML = `<p class="eyebrow">Заявка</p><h1>Расскажите о проекте</h1><p class="lead">Мы подготовим сообщение — отправка в чат будет под вашим контролем.</p>
    <form class="form" data-brief novalidate>
      <div class="field"><label for="b-biz">Ваш бизнес</label><input id="b-biz" name="biz" placeholder="Например, кофейня" value="${esc(b.biz || '')}"></div>
      <div class="field"><label for="b-svc">Что нужно</label><select id="b-svc" name="svc"><option value="">Пока не знаю — нужна консультация</option>${S.services.map(s => `<option value="${s.id}"${s.id === b.svc ? ' selected' : ''}>${esc(s.name)} (${priceTxt(s.priceFrom, s.monthly)})</option>`).join('')}</select></div>
      <div class="field"><label for="b-task">Задача *</label>
        <textarea id="b-task" name="task" required aria-describedby="b-err" placeholder="Что должно измениться для клиентов?">${esc(b.task || '')}</textarea>
        <span class="err" id="b-err" role="alert" hidden>Опишите задачу, чтобы мы поняли запрос.</span></div>
      <div class="field"><label for="b-budget">Бюджет</label><select id="b-budget" name="budget">${['Выбрать диапазон', 'до 50 000 ₽', '50–100 тыс. ₽', '100–200 тыс. ₽', 'более 200 тыс. ₽'].map(o => `<option${o === b.budget ? ' selected' : ''}>${o}</option>`).join('')}</select></div>
      <div class="field"><label for="b-when">Когда нужно</label><select id="b-when" name="when">${['Пока без точной даты', 'В этом месяце', 'Срочно'].map(o => `<option${o === b.when ? ' selected' : ''}>${o}</option>`).join('')}</select></div>
      ${b.calc ? `<div class="card"><p class="eyebrow" style="margin:0 0 4px">Расчёт из калькулятора</p><p class="meta">${esc(b.calc)}</p></div>` : ''}
      <label class="consent"><input type="checkbox" id="b-ok" name="ok" aria-describedby="b-ok-err"${b.ok ? ' checked' : ''}><span>Согласен на обработку персональных данных по <a href="#/privacy">Политике</a> для ответа на заявку</span></label>
      <span class="err" id="b-ok-err" role="alert" hidden>Нужно согласие, чтобы мы могли ответить.</span>
    </form>
    <p class="note">Приложение не хранит данные на сервере: текст заявки вы отправляете сами в чат студии.</p>
    ${C.phone ? `<p class="note">Или позвоните: <a href="tel:${esc(C.phone.replace(/[^+\d]/g, ''))}">${esc(C.phone)}</a></p>` : ''}`;
  setMain('Отправить заявку', sendBrief);
}
let lastText = '';
async function sendBrief() {
  const form = $('[data-brief]'); if (!form) return;
  const f = Object.fromEntries(new FormData(form)); Object.assign(state.brief, f); save('brief', state.brief);
  const task = form.querySelector('#b-task'), err = form.querySelector('#b-err');
  if (!String(f.task || '').trim()) { task.setAttribute('aria-invalid', 'true'); err.hidden = false; task.focus(); haptic('heavy'); return; }
  task.removeAttribute('aria-invalid'); err.hidden = true;
  const ok = form.querySelector('#b-ok'), okErr = form.querySelector('#b-ok-err');
  if (!ok.checked) { okErr.hidden = false; ok.focus(); haptic('heavy'); return; }
  okErr.hidden = true;
  const s = svcById(f.svc);
  const lines = [`Здравствуйте! Заявка в ${C.studio}.`];
  if (f.biz.trim()) lines.push(`Бизнес: ${f.biz.trim()}`);
  lines.push(`Нужно: ${s ? s.name : 'консультация'}`, `Задача: ${f.task.trim()}`);
  if (!/^Выбрать/.test(f.budget)) lines.push(`Бюджет: ${f.budget}`);
  lines.push(`Срок: ${f.when}`);
  if (state.brief.calc) lines.push(state.brief.calc);
  if (src) lines.push(`Источник: ${src}`);
  lines.push(`Площадка: ${P.kind}`);
  lastText = lines.join('\n');
  hapticOk();
  ready();
}
function openChat() {
  if (P.kind === 'max') { copy(lastText).then(ok => toast(ok ? 'Текст скопирован — вставьте его в чат студии.' : 'Опишите задачу в чате студии.')); openLink(C.maxContactUrl); }
  else openLink(`https://t.me/${C.telegramUsername}?text=${encodeURIComponent(lastText)}`);
}
function ready() {
  view.innerHTML = `<div class="done">${ic('check')}</div><h1>Заявка готова</h1><p class="lead">Мы собрали текст. Осталось подтвердить отправку в чате студии.</p>
    <div class="card"><p class="eyebrow" style="margin:0 0 6px">Следующие шаги</p><ol class="steps">
      <li><span class="n">01</span><div><b>Откройте чат</b><span>Проверьте текст и отправьте сообщение</span></div></li>
      <li><span class="n">02</span><div><b>Ответ в рабочее время</b><span>Обычно отвечаем в течение рабочего дня</span></div></li>
      <li><span class="n">03</span><div><b>Созвон 30 минут</b><span>Обсудим задачу, сроки и бюджет</span></div></li></ol></div>
    <div class="actions"><a class="btn btn-wide" href="#/cases">Посмотреть кейсы ${ic('arrow')}</a></div>`;
  setMain('Открыть чат студии', openChat);
}

/* ---------- Навигация ---------- */
function go(h) { if (location.hash === h) route(); else location.hash = h; }
function route() {
  const [a, b] = (location.hash || '#/').slice(2).split('/');
  const tab = ({ services: 'services', solutions: 'solutions', cases: 'cases', brief: 'brief', calc: 'services' })[a] || (a === 'faq' ? 'home' : 'home');
  document.querySelectorAll('.tabs a').forEach(x => x.dataset.tab === tab ? x.setAttribute('aria-current', 'page') : x.removeAttribute('aria-current'));
  const deep = (a === 'services' && b) || (a === 'cases' && b) || ['calc', 'faq', 'privacy', 'terms'].includes(a);
  setBack(deep ? () => back() : null);
  if (a === 'services') b ? service(b) : services();
  else if (a === 'solutions') solutions();
  else if (a === 'cases') b ? caseScreen(b) : cases();
  else if (a === 'calc') calc();
  else if (a === 'faq') faq();
  else if (a === 'privacy' || a === 'terms') legal(a);
  else if (a === 'brief') brief();
  else home();
  window.scrollTo(0, 0);
}
function back() {
  const [a] = (location.hash || '#/').slice(2).split('/');
  if (a === 'calc' && state.calc.step > 0 && state.calc.step < 4) { state.calc.step--; return calc(); }
  history.length > 1 ? history.back() : go('#/');
}

document.addEventListener('click', e => {
  const z = e.target.closest('[data-zoom]'); if (z) return zoom(+z.dataset.zoom);
  const t = e.target.closest('[data-link],[data-dir],[data-f-dir],[data-f-plat],[data-calc],[data-calc-restart],[data-share],[data-back]'); if (!t) return;
  const d = t.dataset;
  if (d.link) { e.preventDefault(); return openLink(d.link); }
  if (d.dir) { state.dir = d.dir; state.plat = 'all'; return; }
  if (d.fDir) { haptic(); state.dir = d.fDir; return services(); }
  if (d.fPlat) { haptic(); state.plat = d.fPlat; return services(); }
  if ('back' in d) return back();
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
document.addEventListener('input', e => { const f = e.target.closest('[data-brief]'); if (f && e.target.name) state.brief[e.target.name] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; });
window.addEventListener('hashchange', route);

(async () => {
  await initPlatform();
  [S, D, PR, L] = await Promise.all(['data/services.json', 'data/content.json', 'data/pricing.json', 'data/legal.json'].map(u => fetch(u).then(r => r.json())));
  Object.assign(state.brief, (await load('brief')) || {});
  bindBack(); bindMain();
  readStart();
  route();
})();
