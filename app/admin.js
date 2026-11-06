// Пульт владельца: заявки, публикация в два канала, воронка.
// Доступ решает сервер по подписанным данным запуска MAX/Telegram; здесь только интерфейс.
import { P, haptic, hapticOk, setMain } from './platform.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ST = { new: 'Новая', work: 'В работе', offer: 'Предложение', contract: 'Договор', done: 'Закрыта', lost: 'Отказ' };
const dt = s => s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
let tab = 'leads', filter = '';
/* Подтверждение: нативное окно Telegram/MAX, иначе браузерное */
const ask = msg => new Promise(res => { try { if (P.sdk?.showConfirm) return P.sdk.showConfirm(msg, ok => res(!!ok)); } catch {} res(window.confirm(msg)); });

export async function api(path, opt = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Platform': P.kind, 'X-Init-Data': P.sdk?.initData || '' };
  const r = await fetch('/api/' + path, { ...opt, headers: { ...headers, ...(opt.headers || {}) } });
  let body = {}; try { body = await r.json(); } catch {}
  return { status: r.status, ...body };
}

let ownerCache = null;
export async function isOwner() {
  if (P.kind === 'web') return false;
  if (ownerCache !== null) return ownerCache;
  try { ownerCache = !!(await api('admin/whoami')).owner; } catch { ownerCache = false; }
  return ownerCache;
}

function shell(inner) {
  const t = (id, label) => `<button class="chip" type="button" data-adm-tab="${id}"${tab === id ? ' aria-pressed="true"' : ''}>${label}</button>`;
  $('#view').innerHTML = `<p class="eyebrow">Пульт студии</p><h1>Управление</h1>
    <div class="chips" role="tablist">${t('leads', 'Заявки')}${t('inv', 'Счета')}${t('post', 'Публикация')}${t('funnel', 'Воронка')}</div>
    <div id="adm">${inner}</div>`;
  setMain(null);
}

export async function admin(sub) {
  if (sub) tab = sub;
  shell('<p class="note">Загрузка…</p>');
  const me = await api('admin/whoami');
  if (!me.ok) return shell(`<div class="card"><p>Пульт открывается только внутри бота студии в MAX или Telegram.</p></div>`);
  if (!me.owner) return shell(`<div class="card"><p>Доступ только у владельца.</p><p class="meta">Ваш ID на этой площадке (${esc(me.platform)}): <b>${esc(me.id)}</b>. Если это вы, внесите его в настройки сервера как OWNER_${me.platform === 'max' ? 'MAX' : 'TG'}_ID.</p></div>`);
  if (tab === 'leads') return leads();
  if (tab === 'post') return post();
  if (tab === 'inv') return invoices();
  return funnel();
}

/* ---------- Заявки ---------- */
async function leads() {
  const d = await api('admin/leads' + (filter ? `?status=${filter}` : ''));
  const c = d.counts || {};
  const f = (id, label) => `<button class="chip" type="button" data-adm-filter="${id}"${filter === id ? ' aria-pressed="true"' : ''}>${label}${id && c[id] ? ` · ${c[id]}` : ''}</button>`;
  const off = d.enabled ? '' : `<div class="card"><p><b>Приём заявок на сервер выключен.</b></p><p class="meta">Сейчас клиенты отправляют заявку сами в чат. Включается после уведомления РКН и обновления политики (LEADS_ENABLED=1).</p></div>`;
  const list = (d.leads || []).map(l => `<button class="card adm-lead" type="button" data-adm-lead="${l.id}">
      <span class="meta">#${l.id} · ${dt(l.created_at)} · ${esc(l.platform)}${l.src ? ' · ' + esc(l.src) : ''}</span>
      <b>${esc(l.name || (l.username ? '@' + l.username : '') || l.contact || 'Без имени')}</b>
      <span>${esc((l.task || '').slice(0, 140))}</span>
      <span class="tag">${ST[l.status] || l.status}</span></button>`).join('') || '<p class="note">Заявок нет.</p>';
  shell(`${off}<div class="chips">${f('', 'Активные')}${Object.entries(ST).map(([k, v]) => f(k, v)).join('')}</div>${list}`);
}

async function leadCard(id) {
  const d = await api(`admin/leads/${id}`);
  if (!d.ok) return leads();
  const l = d.lead;
  const kv = (k, v) => v ? `<p class="meta"><b>${k}:</b> ${esc(v)}</p>` : '';
  const msgs = (d.messages || []).map(m => `<p class="meta">${dt(m.created_at)} · ${m.ok ? 'отправлено' : 'ошибка: ' + esc(m.error || '')}<br>${esc(m.text)}</p>`).join('');
  shell(`<button class="back" type="button" data-adm-tab="leads">‹ Все заявки</button>
    <div class="card"><p class="eyebrow">Заявка #${l.id} · ${dt(l.created_at)}</p>
      ${kv('Кто', [l.name, l.username && '@' + l.username].filter(Boolean).join(' '))}${kv('Контакт', l.contact)}${kv('Площадка', l.platform)}${kv('Источник', l.src)}
      ${kv('Бизнес', l.biz)}${kv('Услуга', l.svc)}${kv('Задача', l.task)}${kv('Бюджет', l.budget)}${kv('Срок', l.when_text)}${kv('Расчёт', l.calc)}
      <p class="meta">Согласие: ${dt(l.consent_at)}, версия ${esc(l.consent_version)}</p></div>
    <div class="field"><label for="a-st">Статус</label><select id="a-st">${Object.entries(ST).map(([k, v]) => `<option value="${k}"${k === l.status ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label for="a-note">Заметка (видите только вы)</label><textarea id="a-note">${esc(l.note || '')}</textarea></div>
    <button class="btn btn-wide" type="button" data-adm-save="${l.id}">Сохранить статус и заметку</button>
    ${l.platform === 'web' ? '<p class="note">Веб-заявка: ответить можно только по контакту.</p>'
      : (l.platform === 'telegram' && !d.tg_api) ? (l.username ? `<a class="btn btn-accent btn-wide" href="https://t.me/${esc(l.username)}" target="_blank" rel="noopener">Ответить в Telegram @${esc(l.username)}</a><p class="note">Telegram недоступен серверу в РФ, ответ отправляется из вашего Telegram.</p>` : '<p class="note">У клиента нет username в Telegram: напишите ему из бота студии или попросите контакт.</p>') : `
    <div class="field"><label for="a-reply">Ответ клиенту в ${l.platform === 'max' ? 'MAX' : 'Telegram'}</label><textarea id="a-reply" placeholder="Здравствуйте! Спасибо за заявку…"></textarea></div>
    <button class="btn btn-accent btn-wide" type="button" data-adm-reply="${l.id}">Отправить ответ</button>`}
    ${msgs ? `<div class="card"><p class="eyebrow">Отправленные ответы</p>${msgs}</div>` : ''}
    <button class="btn btn-wide" type="button" data-adm-invfor="${l.id}">Выставить счёт по заявке</button>
    <button class="btn btn-wide" type="button" data-adm-del="${l.id}">Удалить по запросу клиента</button>`);
}

/* ---------- Счета (ЮKassa) ---------- */
const IS = { awaiting_payment: 'ждёт оплаты', paid: 'оплачен', canceled: 'отменён' };
async function invoices(leadId = '') {
  const d = await api('admin/invoices');
  const list = (d.invoices || []).map(i => `<div class="card"><p class="meta">#${i.id} · ${dt(i.created_at)} · ${IS[i.status] || i.status}${i.lead_id ? ' · заявка #' + i.lead_id : ''}</p>
      <p><b>${esc(i.title)}</b> — ${new Intl.NumberFormat('ru-RU').format(i.amount_rub)} ₽</p>
      ${i.status === 'awaiting_payment' ? `<p class="meta">Ссылка для клиента: <span style="user-select:all">${esc(i.link)}</span></p>
        <div class="chips"><button class="chip" type="button" data-adm-copy="${esc(i.link)}">Скопировать ссылку</button><button class="chip" type="button" data-adm-inv="${i.id}:check">Проверить оплату</button><button class="chip" type="button" data-adm-inv="${i.id}:cancel">Отменить</button></div>` : ''}
      ${i.status === 'paid' ? (i.receipt_done ? '<p class="meta">Чек в «Мой налог» пробит</p>' : `<button class="btn btn-accent" type="button" data-adm-inv="${i.id}:receipt">Чек в «Мой налог» пробит</button>`) : ''}</div>`).join('');
  shell(`${d.online ? '' : '<div class="card"><p class="meta">ЮKassa не подключена: ссылки создаются, но оплатить по ним пока нельзя (нужны YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY на сервере).</p></div>'}
    <form class="form" data-adm-inv-new>
      <div class="field"><label for="i-title">За что *</label><input id="i-title" name="title" placeholder="Предоплата: чат-бот для кофейни" required></div>
      <div class="field"><label for="i-sum">Сумма, ₽ *</label><input id="i-sum" name="amount_rub" type="number" min="1" step="1" inputmode="numeric" required></div>
      <div class="field"><label for="i-lead">Номер заявки (необязательно)</label><input id="i-lead" name="lead_id" inputmode="numeric" value="${esc(leadId)}"></div>
      <button class="btn btn-accent btn-wide" type="submit">Создать счёт и ссылку</button></form>
    ${list ? `<p class="eyebrow" style="margin-top:24px">Счета</p>${list}` : ''}`);
}

/* ---------- Публикация ---------- */
async function post() {
  const d = await api('admin/posts');
  const ch = d.channels || {};
  const warn = (!ch.telegram || !ch.max) ? `<div class="card"><p class="meta">Сейчас недоступно: ${[!ch.telegram && 'канал Telegram (Telegram API заблокирован для серверов в РФ — пост в Telegram публикуйте с телефона)', !ch.max && 'канал MAX (не заданы токен бота или ID канала)'].filter(Boolean).join('; ')}.</p></div>` : '';
  const RS = { scheduled: 'запланирован', sending: 'отправляется', sent: 'опубликован', partial: 'частично', failed: 'ошибка', canceled: 'отменён' };
  const list = (d.posts || []).map(p => `<div class="card"><p class="meta">#${p.id} · ${dt(p.send_at)} · ${RS[p.status] || p.status}</p>
      <p>${esc(p.text.slice(0, 160))}</p>${p.result ? `<p class="meta">${Object.entries(p.result).map(([k, v]) => `${k}: ${v.ok ? 'ок' : 'ошибка ' + esc(v.error || '')}`).join(' · ')}</p>` : ''}
      ${p.status === 'scheduled' ? `<button class="btn" type="button" data-adm-cancel="${p.id}">Отменить</button>` : ''}</div>`).join('');
  shell(`${warn}<form class="form" data-adm-post>
    <div class="field"><label for="p-text">Текст поста *</label><textarea id="p-text" name="text" rows="7" required></textarea></div>
    <div class="field"><label for="p-photo">Фото (ссылка https://, необязательно)</label><input id="p-photo" name="photo_url" inputmode="url"></div>
    <label class="consent"><input type="checkbox" name="button" checked><span>Кнопка «Открыть студию» под постом</span></label>
    <label class="consent"><input type="checkbox" name="t_tg"${ch.telegram ? ' checked' : ''}><span>Telegram</span></label>
    <label class="consent"><input type="checkbox" name="t_max" checked><span>MAX</span></label>
    <div class="field"><label for="p-at">Когда (МСК). Пусто — сразу</label><input id="p-at" name="send_at" type="datetime-local"></div>
    <button class="btn btn-accent btn-wide" type="submit">Опубликовать</button></form>
    ${list ? `<p class="eyebrow" style="margin-top:24px">Последние</p>${list}` : ''}`);
}

/* ---------- Воронка ---------- */
async function funnel(days = 30) {
  const d = await api(`admin/funnel?days=${days}`);
  const t = d.total || {};
  const pct = (a, b) => b ? Math.round(a * 100 / b) + '%' : '—';
  const rows = (d.sources || []).map(([src, v]) => `<tr><td>${esc(src)}</td><td>${v.open}</td><td>${v.calc}</td><td>${v.brief}</td><td>${v.lead}</td><td>${pct(v.lead, v.open)}</td></tr>`).join('');
  shell(`<div class="chips">${[7, 30, 90].map(n => `<button class="chip" type="button" data-adm-days="${n}"${n === days ? ' aria-pressed="true"' : ''}>${n} дней</button>`).join('')}</div>
    <div class="card"><p class="eyebrow">За ${days} дней</p>
      <p>Открыли приложение: <b>${t.open || 0}</b></p><p>Досчитали калькулятор: <b>${t.calc || 0}</b> (${pct(t.calc, t.open)})</p>
      <p>Открыли заявку: <b>${t.brief || 0}</b></p><p>Отправили заявку: <b>${t.lead || 0}</b> (${pct(t.lead, t.open)})</p></div>
    ${rows ? `<div class="card adm-table"><table><thead><tr><th>Источник</th><th>Откр.</th><th>Кальк.</th><th>Форма</th><th>Заявки</th><th>Конв.</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="note">Данных пока нет.</p>'}
    <p class="note">Счётчики обезличены: без имён и ID.</p>`);
}

/* ---------- События ---------- */
function toastMsg(t) { const el = $('#toast'); if (!el) return; el.textContent = t; el.hidden = false; setTimeout(() => { el.hidden = true; }, 4000); }

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-adm-copy],[data-adm-inv],[data-adm-invfor],[data-adm-tab],[data-adm-filter],[data-adm-lead],[data-adm-save],[data-adm-reply],[data-adm-del],[data-adm-cancel],[data-adm-days]');
  if (!t) return;
  const d = t.dataset; haptic();
  if (d.admCopy) { try { await navigator.clipboard.writeText(d.admCopy); toastMsg('Ссылка скопирована'); } catch { toastMsg('Выделите ссылку и скопируйте'); } return; }
  if (d.admInvfor) { tab = 'inv'; return invoices(d.admInvfor); }
  if (d.admInv) { const [id, act] = d.admInv.split(':'); if (act === 'cancel' && !(await ask('Отменить счёт?'))) return; const r = await api(`admin/invoices/${id}/${act}`, { method: 'POST' }); toastMsg(r.ok ? 'Готово' : 'Не получилось'); return invoices(); }
  if (d.admTab) { tab = d.admTab; return admin(); }
  if ('admFilter' in d) { filter = d.admFilter; return leads(); }
  if (d.admLead) return leadCard(d.admLead);
  if (d.admDays) return funnel(+d.admDays);
  if (d.admSave) {
    const r = await api(`admin/leads/${d.admSave}`, { method: 'PATCH', body: JSON.stringify({ status: $('#a-st').value, note: $('#a-note').value }) });
    toastMsg(r.ok ? 'Сохранено' : 'Не сохранилось'); if (r.ok) hapticOk(); return;
  }
  if (d.admReply) {
    const text = $('#a-reply').value.trim(); if (!text) return toastMsg('Напишите ответ');
    t.disabled = true;
    const r = await api(`admin/leads/${d.admReply}/reply`, { method: 'POST', body: JSON.stringify({ text }) });
    t.disabled = false; toastMsg(r.ok ? 'Ответ отправлен' : 'Не отправлено: ' + (r.error || 'ошибка'));
    return leadCard(d.admReply);
  }
  if (d.admDel) {
    if (!(await ask('Удалить заявку и всю переписку безвозвратно? Делайте это по запросу клиента.'))) return;
    const r = await api(`admin/leads/${d.admDel}`, { method: 'DELETE' });
    toastMsg(r.ok ? 'Удалено' : 'Не удалось удалить'); return leads();
  }
  if (d.admCancel) { await api(`admin/posts/${d.admCancel}/cancel`, { method: 'POST' }); return post(); }
});

document.addEventListener('submit', async e => {
  const fi = e.target.closest('[data-adm-inv-new]');
  if (fi) {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(fi));
    const r = await api('admin/invoices', { method: 'POST', body: JSON.stringify({ title: v.title, amount_rub: +v.amount_rub, lead_id: v.lead_id || null }) });
    if (!r.ok) return toastMsg(r.error || 'Ошибка');
    hapticOk(); try { await navigator.clipboard.writeText(r.link); toastMsg('Счёт создан, ссылка скопирована'); } catch { toastMsg('Счёт создан'); }
    return invoices();
  }
  const f = e.target.closest('[data-adm-post]'); if (!f) return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(f));
  if (!String(v.text || '').trim()) return toastMsg('Нужен текст');
  const targets = [v.t_tg && 'telegram', v.t_max && 'max'].filter(Boolean);
  if (!(await ask(`Опубликовать ${v.send_at ? 'по расписанию' : 'сейчас'} в: ${targets.join(', ')}?`))) return;
  const r = await api('admin/posts', { method: 'POST', body: JSON.stringify({ text: v.text, photo_url: v.photo_url, button: !!v.button, targets, send_at: v.send_at || null }) });
  toastMsg(r.ok ? (v.send_at ? 'Запланировано' : 'Отправляется…') : 'Ошибка: ' + (r.error || ''));
  if (r.ok) { hapticOk(); setTimeout(post, 1500); }
});
