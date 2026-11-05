import { CONFIG as C } from './config.js';

/* ---------- Платформа: Telegram, MAX или обычный браузер ---------- */
const $ = s => document.querySelector(s);
const view = $('#view');
let P = { kind: 'web', sdk: null };
function detect() {
  const tg = window.Telegram?.WebApp;
  if (tg && tg.initData) return { kind: 'telegram', sdk: tg };
  const mx = window.WebApp;
  if (mx && (mx.initData || mx.platform)) return { kind: 'max', sdk: mx };
  return { kind: 'web', sdk: null };
}
const wait = () => new Promise(res => { let n = 0; (function t() { const d = detect(); if (d.kind !== 'web' || n++ > 20) res(d); else setTimeout(t, 50); })(); });
const haptic = () => { try { P.sdk?.HapticFeedback?.impactOccurred?.('light'); } catch {} };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function openLink(url) {
  if (!url) return;
  try {
    if (P.kind === 'telegram' && /^https:\/\/t\.me\//.test(url)) return P.sdk.openTelegramLink(url);
    if (P.kind === 'max' && /^https:\/\/max\.ru\//.test(url) && P.sdk.openMaxLink) return P.sdk.openMaxLink(url);
    if (P.sdk?.openLink) return P.sdk.openLink(url);
  } catch {}
  window.open(url, '_blank', 'noopener');
}
let toastT;
function toast(t, ms = 5000) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, ms); }
async function copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }
const src = (() => { const q = new URLSearchParams(location.search); return (q.get('src') || q.get('startapp') || q.get('start') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32); })();

/* ---------- Данные ---------- */
const PACKS = [
  { id: 'start', name: 'Старт', price: 'от 30 000 ₽', time: '5–7 дней', items: ['Бот в Telegram или MAX: ответы на частые вопросы, приём заявки', 'Оформление: имя, описание, аватар, кнопки', 'Заявки приходят вам в личные сообщения', '30 дней исправления ошибок бесплатно'] },
  { id: 'catalog', name: 'Каталог', price: 'от 80 000 ₽', time: '2–4 недели', hit: true, items: ['Бот + мини-приложение: каталог, поиск, фильтры, подбор, избранное', 'Сразу в Telegram и MAX', 'Метки источников: видно, откуда пришёл клиент', 'Оформление канала и чатов, закрепы, QR-коды', 'Пример — каталог мотосалона ТРИУМФ'] },
  { id: 'custom', name: 'Под задачу', price: 'от 150 000 ₽', time: 'по брифу', items: ['Интеграция с CRM (amoCRM, Битрикс24)', 'ИИ-консультант по вашей базе знаний', 'Рассылки, запись, лояльность'] },
  { id: 'smm', name: 'Продвижение', price: 'от 15 000 ₽/мес', time: 'ежемесячно', items: ['Контент-план, посты, сторис', 'Ведение канала в Telegram и MAX', 'Отчёт по заявкам из бота и канала', 'Сопровождение бота'] },
];
const STEPS = ['Созвон и бриф — 30 минут, бесплатно', 'Предложение: состав, срок, цена', 'Договор, предоплата 50%', 'Разработка и показ промежуточной версии', 'Запуск, оплата остатка, 30 дней поддержки'];

/* ---------- Экраны ---------- */
function home() {
  view.innerHTML = `<h1>SMM, боты и мини-приложения под ключ</h1>
    <p class="lead">Запускаем продажи в Telegram и MAX: бот, каталог в мессенджере, оформление каналов и продвижение — в одних руках.</p>
    <div class="chips"><span class="chip">Telegram</span><span class="chip">MAX</span><span class="chip">Mini Apps</span><span class="chip">SMM</span></div>
    <div class="actions">
      <a class="btn btn-accent btn-wide" href="#/brief">Обсудить проект</a>
      <a class="btn btn-wide" href="#/cases">Посмотреть кейс</a>
    </div>
    <h2 class="sec">Что делаем</h2>
    <div class="grid">
      <div class="card"><h3>Боты</h3><p class="meta">Отвечают клиентам 24/7, принимают заявки, присылают их вам.</p></div>
      <div class="card"><h3>Мини-приложения</h3><p class="meta">Каталог, запись, подбор — прямо в мессенджере, без установки и сайта.</p></div>
      <div class="card"><h3>Продвижение</h3><p class="meta">Канал, контент, оформление, реклама — и учёт, откуда пришёл каждый клиент.</p></div>
    </div>
    <h2 class="sec">Как работаем</h2>
    <ol class="steps">${STEPS.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`;
}
function services() {
  view.innerHTML = `<h1>Услуги</h1><p class="lead">Цены — ориентир. Точную стоимость называем после брифа.</p>
    <div class="grid">${PACKS.map(p => `<article class="card"${p.hit ? ' style="border-color:var(--accent)"' : ''}>
      <h3>${esc(p.name)}${p.hit ? ' · популярный' : ''}</h3>
      <div class="price">${esc(p.price)}</div><div class="meta">Срок: ${esc(p.time)}</div>
      <ul class="list">${p.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
      <div class="actions"><button class="btn btn-wide" type="button" data-pack="${p.id}">Хочу «${esc(p.name)}»</button></div>
    </article>`).join('')}</div>`;
}
function cases() {
  view.innerHTML = `<h1>Кейсы</h1>
    <article class="card case">
      <img src="img/case-triumf.jpg" alt="Мотосалон ТРИУМФ — визуализация салона" width="640" height="640" loading="lazy">
      <h3 style="margin-top:12px">Мотосалон ТРИУМФ</h3>
      <p class="meta">Telegram: бот + мини-приложение + канал, чат, сервисный чат</p>
      <p><b>Задача.</b> Показать каталог техники в мессенджере и получать заявки без сайта.</p>
      <p><b>Сделали.</b> Каталог 100 моделей с поиском и подбором за 4 вопроса, избранное, вкладка сервиса с формой заявки, метки источников, оформление бота и каналов, QR-коды.</p>
      <p class="meta">Результаты по заявкам опубликуем после первого месяца работы и с согласия клиента.</p>
      ${C.triumfDemo ? `<div class="actions"><button class="btn btn-accent btn-wide" type="button" data-link="${esc(C.triumfDemo)}">Открыть каталог ТРИУМФ</button></div>` : ''}
    </article>`;
}
function music() {
  const links = [['Telegram', C.musicTelegram], ['MAX', C.musicMax]].filter(([, u]) => u);
  view.innerHTML = `<h1>Музыка</h1><p class="lead">Авторские песни Ивана Белькова. Подписывайтесь — новые релизы выходят здесь первыми.</p>
    ${links.length ? `<div class="actions">${links.map(([n, u]) => `<button class="btn btn-wide" type="button" data-link="${esc(u)}">Канал в ${n}</button>`).join('')}</div>` : '<p class="meta">Ссылки на музыкальные каналы появятся здесь скоро.</p>'}`;
}
function brief(pack = '') {
  view.innerHTML = `<h1>Заявка</h1><p class="lead">Опишите задачу — ответим и предложим решение. Данные никуда не сохраняются: заявку вы отправляете сами.</p>
    <form class="form" data-brief novalidate>
      <div class="field"><label for="b-biz">Ваш бизнес</label><input id="b-biz" name="biz" placeholder="Например, мотосалон, кофейня, автосервис"></div>
      <div class="field"><label for="b-pack">Что нужно</label><select id="b-pack" name="pack">
        <option value="">Пока не знаю — нужна консультация</option>${PACKS.map(p => `<option value="${p.id}"${p.id === pack ? ' selected' : ''}>${esc(p.name)} (${esc(p.price)})</option>`).join('')}</select></div>
      <div class="field"><label for="b-task">Задача <span aria-hidden="true">*</span></label>
        <textarea id="b-task" name="task" required aria-describedby="b-err" placeholder="Что хотите получить: больше заявок, каталог, запись клиентов…"></textarea>
        <span class="err" id="b-err" role="alert" hidden>Опишите задачу хотя бы парой слов.</span></div>
      <div class="actions"><button class="btn btn-accent btn-wide" type="submit">Отправить заявку</button></div>
    </form>
    ${C.phone ? `<p class="note">Или позвоните: <a href="tel:${esc(C.phone.replace(/[^+\d]/g, ''))}">${esc(C.phone)}</a></p>` : ''}`;
}
async function sendBrief(form) {
  const f = Object.fromEntries(new FormData(form));
  const task = form.querySelector('#b-task'), err = form.querySelector('#b-err');
  if (!String(f.task || '').trim()) { task.setAttribute('aria-invalid', 'true'); err.hidden = false; task.focus(); return; }
  task.removeAttribute('aria-invalid'); err.hidden = true;
  const pack = PACKS.find(p => p.id === f.pack);
  const lines = [`Здравствуйте! Заявка в ${C.studio}.`];
  if (f.biz.trim()) lines.push(`Бизнес: ${f.biz.trim()}`);
  lines.push(`Пакет: ${pack ? pack.name : 'нужна консультация'}`, `Задача: ${f.task.trim()}`);
  if (src) lines.push(`Источник: ${src}`);
  const text = lines.join('\n');
  haptic();
  if (P.kind !== 'max' && C.telegramUsername) return openLink(`https://t.me/${C.telegramUsername}?text=${encodeURIComponent(text)}`);
  const ok = await copy(text);
  const dest = P.kind === 'max' ? (C.maxContactUrl || (C.telegramUsername && `https://t.me/${C.telegramUsername}`)) : (C.maxContactUrl);
  if (dest) { toast(ok ? 'Текст заявки скопирован — вставьте его в открывшийся чат.' : 'Откроется чат — опишите задачу.'); openLink(dest); }
  else toast(ok ? 'Текст заявки скопирован. Контакт для отправки скоро появится.' : 'Контакт для отправки скоро появится.');
}

/* ---------- Навигация ---------- */
function route() {
  const h = location.hash || '#/';
  const m = h.match(/^#\/(\w+)/); const tab = m ? m[1] : 'home';
  document.querySelectorAll('.tabs a').forEach(a => a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  ({ services, cases, music, brief }[tab] || home)();
  window.scrollTo(0, 0);
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-link],[data-pack]'); if (!t) return;
  if (t.dataset.link) return openLink(t.dataset.link);
  if (t.dataset.pack) { location.hash = '#/brief'; setTimeout(() => brief(t.dataset.pack), 0); }
});
document.addEventListener('submit', e => { if (e.target.matches('[data-brief]')) { e.preventDefault(); sendBrief(e.target); } });
window.addEventListener('hashchange', route);

(async () => {
  P = await wait();
  try { P.sdk?.ready?.(); P.sdk?.expand?.(); } catch {}
  if (P.kind === 'telegram') { try { document.documentElement.dataset.theme = P.sdk.colorScheme; } catch {} }
  document.documentElement.dataset.platform = P.kind;
  route();
})();
