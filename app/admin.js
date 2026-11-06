// Пульт владельца: заявки, публикация в два канала, воронка.
// Доступ решает сервер по подписанным данным запуска MAX/Telegram; здесь только интерфейс.
import { P, haptic, hapticOk, setMain } from './platform.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ST = { new: 'Новая', work: 'В работе', offer: 'Предложение', contract: 'Договор', done: 'Закрыта', lost: 'Отказ' };
const dt = s => s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
let tab = 'today', filter = '';
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

const LOST = ['цена', 'выбрали другого', 'пропал', 'нет бюджета', 'не подходит', 'слишком рано', 'сроки', 'отказ студии'];
const pad = n => String(n).padStart(2, '0');
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + (3 * 60 + new Date().getTimezoneOffset()) * 60000); // в МСК
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const ago = iso => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 60 ? `${m} мин` : m < 2880 ? `${Math.round(m / 60)} ч` : `${Math.round(m / 1440)} дн`; };

function shell(inner) {
  const t = (id, label) => `<button class="chip" type="button" data-adm-tab="${id}"${tab === id ? ' aria-pressed="true"' : ''}>${label}</button>`;
  $('#view').innerHTML = `<p class="eyebrow">Пульт студии</p><h1>Управление</h1>
    <div class="chips" role="tablist">${t('today', 'Сегодня')}${t('leads', 'Заявки')}${t('inv', 'Счета')}${t('content', 'Контент')}${t('post', 'Публикация')}${t('funnel', 'Метрики')}</div>
    <div id="adm">${inner}</div>`;
  setMain(null);
}

export async function admin(sub) {
  if (sub) tab = sub;
  shell('<p class="note">Загрузка…</p>');
  const me = await api('admin/whoami');
  if (!me.ok) return shell(`<div class="card"><p>Пульт открывается только внутри бота студии в MAX или Telegram.</p></div>`);
  if (!me.owner) return shell(`<div class="card"><p>Доступ только у владельца.</p><p class="meta">Ваш ID на этой площадке (${esc(me.platform)}): <b>${esc(me.id)}</b>. Если это вы, внесите его в настройки сервера как OWNER_${me.platform === 'max' ? 'MAX' : 'TG'}_ID.</p></div>`);
  if (tab === 'today') return todayScreen();
  if (tab === 'content') return contentScreen();
  if (tab === 'leads') return leads();
  if (tab === 'post') return post();
  if (tab === 'inv') return invoices();
  return funnel();
}

/* ---------- Сегодня ---------- */
async function todayScreen() {
  const d = await api('admin/today');
  if (!d.ok) return shell('<p class="note">Не удалось загрузить.</p>');
  const who = l => esc(l.name || (l.username ? '@' + l.username : '') || l.contact || 'Без имени');
  const block = (title, items, render, cls = '') => items.length ? `<p class="eyebrow ${cls}" style="margin-top:20px">${title} · ${items.length}</p>${items.slice(0, 7).map(render).join('')}` : '';
  const leadCard = (l, line) => `<button class="card adm-lead" type="button" data-adm-lead="${l.id}"><b>${who(l)}</b><span class="meta">${line}</span></button>`;
  const n = d.npd;
  const npdLine = `<div class="card"><p class="eyebrow" style="margin:0 0 4px">Лимит НПД за год</p><p style="margin:0"><b>${new Intl.NumberFormat('ru-RU').format(n.year_sum)} ₽</b> из 2 400 000 ₽ (${n.percent}%)${n.level !== 'ok' ? ` — <b>${n.level === 'yellow' ? 'внимание: 70%+' : n.level === 'orange' ? 'близко: 85%+' : 'критично: 95%+'}</b>` : ''}</p></div>`;
  const parts = [
    block('Новые без ответа', d.new_unanswered, l => leadCard(l, `ждёт ${ago(l.created_at)} · ${esc(l.platform)} · ${esc((l.task || '').slice(0, 80))}`), ''),
    block('Пора действовать', d.due, l => leadCard(l, `${esc(l.next_action || '')} · срок был ${dt(l.next_action_at)}`)),
    block('Предложения без движения 3+ дня', d.stale_offers, l => leadCard(l, `без движения ${ago(l.updated_at)}`)),
    block('Нет следующего действия', d.no_action, l => leadCard(l, `добавьте действие и дату · ${ST[l.status] || l.status}`)),
    block('Неоплаченные счета 3+ дня', d.unpaid, i => `<button class="card adm-lead" type="button" data-adm-tab="inv"><b>${esc(i.title)}</b><span class="meta">${new Intl.NumberFormat('ru-RU').format(i.amount_rub)} ₽ · выставлен ${ago(i.created_at)} назад</span></button>`),
    block('Чек «Мой налог» не пробит', d.receipts, i => `<button class="card adm-lead" type="button" data-adm-tab="inv"><b>${esc(i.title)}</b><span class="meta">${new Intl.NumberFormat('ru-RU').format(i.amount_rub)} ₽ · оплачен ${ago(i.paid_at)} назад. Чек — до 9-го числа следующего месяца</span></button>`),
  ].join('');
  shell(`${parts || '<div class="card"><p style="margin:0"><b>Всё чисто.</b> Срочного нет.</p></div>'}<div style="margin-top:20px">${npdLine}</div>`);
}

/* ---------- Контент: управление логикой приложения ---------- */
const BLOCK_HELP = {
  templates: 'Готовые ответы клиентам: подставляются в карточке заявки одним нажатием.',
  promos: 'Промокоды со скидкой, сроком и лимитом. Скидка фиксируется в заявке.',
  flags: 'Включить или выключить функцию для площадки, источника или доли пользователей.',
  mode: 'Закрыть приём заявок, рабочие часы и сообщение вне часов.',
  banner: 'Заметный баннер на главной (акция, новость) с датами показа.',
  prices: 'Цены «от» и скрытие услуг. Пустое поле цены — как в прайсе.',
  calc: 'Базовые цены типов проектов и разброс «от — до» в калькуляторе.',
  sources: 'Своё приветствие для гостей из конкретной ссылки или поста.',
  faq: 'Вопросы и ответы. Если список пуст, показываются встроенные.',
};
let CONTENT = null;

async function contentScreen() {
  const [cfg, sv, pr] = await Promise.all([api('admin/config'), fetch('data/services.json').then(r => r.json()).catch(() => ({ services: [] })), fetch('data/pricing.json').then(r => r.json()).catch(() => ({ types: [] }))]);
  if (!cfg.ok) return shell('<p class="note">Не удалось загрузить.</p>');
  CONTENT = { cfg, sv, pr };
  const b = cfg.blocks, v = k => b[k].value, ver = k => b[k].version ? `v${b[k].version}` : 'не менялось';
  const sec = (k, form) => `<details class="card"><summary><b>${esc(cfg.titles[k])}</b> <span class="meta">${ver(k)}</span></summary><p class="meta">${BLOCK_HELP[k]}</p>
    <form class="form" data-cfg="${k}">${form}<button class="btn btn-accent btn-wide" type="submit">Опубликовать</button></form>
    <button class="btn btn-wide" type="button" data-cfg-hist="${k}">История и откат</button><div id="hist-${k}"></div></details>`;
  const tpl = v('templates') || [], promos = v('promos') || {}, flg = v('flags') || {};
  const m = v('mode') || {}, bn = v('banner') || {}, pri = v('prices') || {}, cal = v('calc') || {}, src = v('sources') || {}, faq = v('faq') || [];
  const mode = `<label class="consent"><input type="checkbox" name="closed"${m.closed ? ' checked' : ''}><span>Приём заявок закрыт</span></label>
    <div class="field"><label>Текст, когда закрыто</label><textarea name="closed_text" maxlength="300">${esc(m.closed_text || '')}</textarea></div>
    <div class="field"><label>Рабочие часы, МСК (пусто = всегда открыто)</label><div class="chips"><input name="h_from" type="time" value="${esc((m.hours || {}).from || '')}"><input name="h_to" type="time" value="${esc((m.hours || {}).to || '')}"></div></div>
    <div class="field"><label>Текст вне рабочих часов</label><textarea name="after_hours_text" maxlength="300">${esc(m.after_hours_text || '')}</textarea></div>
    <div class="field"><label>Автоответ клиенту сразу после заявки (в MAX)</label><textarea name="ack_text" maxlength="300" placeholder="Заявка получена, ответим в течение рабочего дня.">${esc(m.ack_text || '')}</textarea></div>`;
  const banner = `<label class="consent"><input type="checkbox" name="enabled"${bn.enabled ? ' checked' : ''}><span>Показывать баннер</span></label>
    <div class="field"><label>Текст</label><input name="text" maxlength="200" value="${esc(bn.text || '')}"></div>
    <div class="field"><label>Текст кнопки</label><input name="button_text" maxlength="40" value="${esc(bn.button_text || '')}"></div>
    <div class="field"><label>Ссылка кнопки (https://… или #/brief, #/calc)</label><input name="button_link" value="${esc(bn.button_link || '')}"></div>
    <div class="field"><label>Показывать с / по</label><div class="chips"><input name="from" type="date" value="${esc(bn.from || '')}"><input name="to" type="date" value="${esc(bn.to || '')}"></div></div>`;
  const prices = (sv.services || []).map(x => `<div class="field"><label>${esc(x.name)} (в прайсе ${new Intl.NumberFormat('ru-RU').format(x.priceFrom)} ₽)</label>
    <div class="chips"><input name="p_${esc(x.id)}" type="number" min="0" inputmode="numeric" placeholder="${x.priceFrom}" value="${pri[x.id] && Number.isInteger(pri[x.id].priceFrom) ? pri[x.id].priceFrom : ''}">
    <label class="consent" style="margin:0"><input type="checkbox" name="h_${esc(x.id)}"${pri[x.id] && pri[x.id].hidden ? ' checked' : ''}><span>скрыть</span></label></div></div>`).join('');
  const calc = (pr.types || []).map(x => `<div class="field"><label>${esc(x.name)} (в прайсе ${new Intl.NumberFormat('ru-RU').format(x.base)} ₽)</label><input name="c_${esc(x.id)}" type="number" min="0" inputmode="numeric" placeholder="${x.base}" value="${(cal.types || {})[x.id] ? (cal.types[x.id].base) : ''}"></div>`).join('')
    + `<div class="field"><label>Разброс «от — до» (в прайсе ${pr.spread ?? 1.5})</label><input name="spread" type="number" step="0.1" min="1" max="3" placeholder="${pr.spread ?? 1.5}" value="${cal.spread ?? ''}"></div>`;
  const sources = `<div class="field"><label>По одной строке: код | название | приветствие</label><textarea name="lines" rows="6" placeholder="src_channel | Канал | Привет из канала!">${esc(Object.entries(src).map(([k, x]) => `${k} | ${x.title} | ${x.greeting || ''}`).join('\n'))}</textarea></div>
    <p class="meta">Код — латиница, цифры, _ и -, без «src_». Например, строка <code>channel | Канал | Привет!</code> работает для ссылки <code>…?startapp=src_channel</code>.</p>`;
  const faqf = `<div class="field"><label>Вопрос на первой строке, ответ ниже; вопросы разделяются строкой ---</label><textarea name="faq" rows="10">${esc(faq.map(x => `${x.q}\n${x.a}`).join('\n---\n'))}</textarea></div>`;
  const templates = `<div class="field"><label>Название на первой строке, текст ниже; шаблоны разделяются строкой ---</label><textarea name="tpl" rows="10">${esc(tpl.map(x => `${x.title}\n${x.text}`).join('\n---\n'))}</textarea></div>`;
  const promosForm = `<div class="field"><label>По одной строке: КОД | процент или сумма в ₽ (например 10% или 500) | с (ГГГГ-ММ-ДД) | по | лимит | выкл</label><textarea name="lines" rows="6" placeholder="START10 | 10% | 2026-11-01 | 2026-11-30 | 20">${esc(Object.entries(promos).map(([k, x]) => [k, x.percent ? x.percent + '%' : x.amount, x.from || '', x.to || '', x.limit || '', x.enabled === false ? 'выкл' : ''].join(' | ').replace(/( \| )+$/, '')).join('\n'))}</textarea></div>
    <p class="meta">Клиент видит поле «Промокод» в форме заявки, только если есть хотя бы один действующий код. Лимит 0 или пусто — без ограничения.</p>`;
  const flagsForm = `<div class="field"><label>По одной строке: функция | вкл/выкл | площадки через запятую | источники через запятую | процент пользователей</label><textarea name="lines" rows="5" placeholder="calc | вкл | max,telegram | | 100">${esc(Object.entries(flg).map(([k, x]) => [k, x.on ? 'вкл' : 'выкл', (x.platforms || []).join(','), (x.sources || []).join(','), x.percent ?? 100].join(' | ')).join('\n'))}</textarea></div>
    <p class="meta">Функции: <b>calc</b> — калькулятор стоимости, <b>promo</b> — поле промокода. Если функции здесь нет, она включена всем.</p>`;
  shell(`<p class="note">Изменения видны всем пользователям примерно через минуту. Любую версию можно вернуть.</p>${sec('mode', mode)}${sec('templates', templates)}${sec('promos', promosForm)}${sec('flags', flagsForm)}${sec('banner', banner)}${sec('prices', prices)}${sec('calc', calc)}${sec('sources', sources)}${sec('faq', faqf)}`);
}

function formValue(key, f) {
  const g = n => f.elements[n];
  if (key === 'templates') return g('tpl').value.split(/\n---\n?/).map(x => x.trim()).filter(Boolean).map(x => { const [title, ...text] = x.split('\n'); return { title: title.trim(), text: text.join('\n').trim() }; });
  if (key === 'promos') { const o = {}; g('lines').value.split('\n').map(x => x.trim()).filter(Boolean).forEach(line => { const [code, val = '', from = '', to = '', limit = '', off = ''] = line.split('|').map(x => x.trim()); const isPct = /%$/.test(val); const n = parseInt(val, 10); if (code) o[code.toUpperCase()] = { ...(isPct ? { percent: n } : { amount: n }), from, to, limit: parseInt(limit, 10) || 0, enabled: !/^(выкл|off|0)$/i.test(off) }; }); return o; }
  if (key === 'flags') { const o = {}; g('lines').value.split('\n').map(x => x.trim()).filter(Boolean).forEach(line => { const [name, on = 'вкл', pl = '', so = '', pc = ''] = line.split('|').map(x => x.trim()); if (name) o[name] = { on: !/^(выкл|off|0|нет)$/i.test(on), platforms: pl.split(',').map(x => x.trim()).filter(Boolean), sources: so.split(',').map(x => x.trim()).filter(Boolean), percent: pc === '' ? 100 : parseInt(pc, 10) }; }); return o; }
  if (key === 'mode') return { closed: g('closed').checked, closed_text: g('closed_text').value, after_hours_text: g('after_hours_text').value, ack_text: g('ack_text').value, hours: { from: g('h_from').value, to: g('h_to').value } };
  if (key === 'banner') return { enabled: g('enabled').checked, text: g('text').value, button_text: g('button_text').value, button_link: g('button_link').value, from: g('from').value, to: g('to').value };
  if (key === 'prices') { const o = {}; (CONTENT.sv.services || []).forEach(x => { const val = g('p_' + x.id).value, hid = g('h_' + x.id).checked; if (val !== '' || hid) o[x.id] = { ...(val !== '' ? { priceFrom: parseInt(val, 10) } : {}), hidden: hid }; }); return o; }
  if (key === 'calc') { const types = {}; (CONTENT.pr.types || []).forEach(x => { const val = g('c_' + x.id).value; if (val !== '') types[x.id] = { base: parseInt(val, 10) }; }); const sp = g('spread').value; return { types, ...(sp !== '' ? { spread: parseFloat(sp) } : {}) }; }
  if (key === 'sources') { const o = {}; g('lines').value.split('\n').map(x => x.trim()).filter(Boolean).forEach(line => { const [code, title, ...rest] = line.split('|').map(x => x.trim()); if (code) o[code] = { title: title || code, greeting: rest.join('|').trim() }; }); return o; }
  if (key === 'faq') return g('faq').value.split(/\n---\n?/).map(x => x.trim()).filter(Boolean).map(x => { const [q, ...a] = x.split('\n'); return { q: q.trim(), a: a.join('\n').trim() }; });
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
  shell(`${off}<div class="chips">${f('', 'Активные')}${Object.entries(ST).map(([k, v]) => f(k, v)).join('')}</div>${list}<button class="btn btn-wide" type="button" data-adm-csv style="margin-top:16px">Скопировать все заявки (CSV)</button>`);
}

let TPL = null;
async function templates() { if (TPL) return TPL; const c = await api('admin/config'); TPL = (c.blocks && c.blocks.templates && c.blocks.templates.value) || []; return TPL; }
async function leadCard(id) {
  TPL = null;
  const [d, tpls] = [await api(`admin/leads/${id}`), await templates()];
  if (!d.ok) return leads();
  const l = d.lead;
  const kv = (k, v) => v ? `<p class="meta"><b>${k}:</b> ${esc(v)}</p>` : '';
  const msgs = (d.messages || []).map(m => `<p class="meta">${dt(m.created_at)} · ${m.ok ? 'отправлено' : 'ошибка: ' + esc(m.error || '')}<br>${esc(m.text)}</p>`).join('');
  shell(`<button class="back" type="button" data-adm-tab="leads">‹ Все заявки</button>
    <div class="card"><p class="eyebrow">Заявка #${l.id} · ${dt(l.created_at)}</p>
      ${kv('Кто', [l.name, l.username && '@' + l.username].filter(Boolean).join(' '))}${kv('Контакт', l.contact)}${kv('Площадка', l.platform)}${kv('Источник', l.src)}${kv('Промокод', l.promo_code)}
      ${kv('Бизнес', l.biz)}${kv('Услуга', l.svc)}${kv('Задача', l.task)}${kv('Бюджет', l.budget)}${kv('Срок', l.when_text)}${kv('Расчёт', l.calc)}
      <p class="meta">Согласие: ${dt(l.consent_at)}, версия ${esc(l.consent_version)}</p></div>
    <div class="field"><label for="a-st">Статус</label><select id="a-st">${Object.entries(ST).map(([k, v]) => `<option value="${k}"${k === l.status ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label for="a-na">Следующее действие</label><input id="a-na" value="${esc(l.next_action || '')}" placeholder="Например: позвонить, отправить предложение"></div>
    <div class="field"><label for="a-na-at">Когда (МСК)</label><input id="a-na-at" type="datetime-local" value="${esc(toLocalInput(l.next_action_at))}">
      <div class="chips"><button class="chip" type="button" data-adm-quick="1">Завтра</button><button class="chip" type="button" data-adm-quick="3">Через 3 дня</button><button class="chip" type="button" data-adm-quick="7">Через неделю</button></div></div>
    <div class="field"><label for="a-lost">Причина отказа (обязательна для статуса «Отказ»)</label><select id="a-lost"><option value="">—</option>${LOST.map(x => `<option${x === l.lost_reason ? ' selected' : ''}>${x}</option>`).join('')}</select></div>
    <div class="field"><label for="a-tags">Теги через запятую</label><input id="a-tags" value="${esc((l.tags || []).join(', '))}" placeholder="горячий, бот"></div>
    <div class="field"><label for="a-note">Заметка (видите только вы)</label><textarea id="a-note">${esc(l.note || '')}</textarea></div>
    <div class="card"><p class="eyebrow" style="margin:0 0 6px">История заметок</p>${(d.notes || []).map(n => `<p class="meta">${dt(n.at)} — ${esc(n.text)}</p>`).join('') || '<p class="meta">Пока нет.</p>'}
      <div class="field"><textarea id="a-newnote" placeholder="Новая запись: созвонились, договорились, ждём бриф…"></textarea></div><button class="btn" type="button" data-adm-addnote="${l.id}">Добавить запись</button></div>
    ${l.first_response_at ? `<p class="meta">Первый ответ: ${dt(l.first_response_at)}</p>` : `<button class="btn btn-wide" type="button" data-adm-responded="${l.id}">Я уже ответил(а) клиенту</button>`}
    <button class="btn btn-wide" type="button" data-adm-save="${l.id}">Сохранить</button>
    ${tpls.length ? `<p class="meta" style="margin:12px 0 4px">Быстрые ответы</p><div class="chips">${tpls.map((x, i) => `<button class="chip" type="button" data-adm-tpl="${i}">${esc(x.title)}</button>`).join('')}</div>` : ''}
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
  const [d, m] = await Promise.all([api(`admin/funnel?days=${days}`), api(`admin/metrics?days=${days}`)]);
  const t = d.total || {};
  const num = n => new Intl.NumberFormat('ru-RU').format(n || 0);
  const pct = (a, b) => b ? Math.round(a * 100 / b) + '%' : '—';
  const frows = (d.sources || []).map(([src, v]) => `<tr><td>${esc(src)}</td><td>${v.open}</td><td>${v.calc}</td><td>${v.brief}</td><td>${v.lead}</td></tr>`).join('');
  const srows = (m.by_source || []).map(x => `<tr><td>${esc(x.src)}</td><td>${x.leads}</td><td>${x.won}</td></tr>`).join('');
  const lost = (m.lost_reasons || []).map(x => `${esc(x.lost_reason)}: <b>${x.n}</b>`).join(' · ');
  const few = (m.total_leads || 0) < 20 ? '<p class="meta">Заявок пока мало: проценты не показываем, смотрите числа.</p>' : '';
  shell(`<div class="chips">${[7, 30, 90].map(n => `<button class="chip" type="button" data-adm-days="${n}"${n === days ? ' aria-pressed="true"' : ''}>${n} дней</button>`).join('')}</div>
    <div class="card"><p class="eyebrow">За ${days} дней</p>
      <p>Заявок: <b>${m.total_leads || 0}</b> · Оплачено: <b>${num(m.paid_rub)} ₽</b></p>
      <p>Первый ответ (медиана): <b>${m.response_median_min == null ? '—' : m.response_median_min < 60 ? Math.round(m.response_median_min) + ' мин' : Math.round(m.response_median_min / 60) + ' ч'}</b> <span class="meta">по ${m.response_n || 0} заявкам</span></p>
      <p>Предложений на руках: <b>${(m.offers || {}).n || 0}</b>${(m.offers || {}).n ? ` <span class="meta">старейшее — ${(m.offers || {}).oldest} дн.</span>` : ''}</p>
      ${lost ? `<p>Причины отказов: ${lost}</p>` : ''}${few}</div>
    ${srows ? `<div class="card adm-table"><p class="eyebrow">Заявки по источникам</p><table><thead><tr><th>Источник</th><th>Заявок</th><th>Договор/закрыто</th></tr></thead><tbody>${srows}</tbody></table></div>` : ''}
    <div class="card"><p class="eyebrow">Воронка приложения</p>
      <p>Открыли: <b>${t.open || 0}</b> · Калькулятор: <b>${t.calc || 0}</b> · Форма: <b>${t.brief || 0}</b> · Заявка: <b>${t.lead || 0}</b>${(t.open || 0) >= 50 ? ` (${pct(t.lead, t.open)})` : ''}</p></div>
    ${frows ? `<div class="card adm-table"><table><thead><tr><th>Источник</th><th>Откр.</th><th>Кальк.</th><th>Форма</th><th>Заявки</th></tr></thead><tbody>${frows}</tbody></table></div>` : ''}
    ${(m.promos || []).length ? `<div class="card"><p class="eyebrow">Промокоды</p><p>${m.promos.map(x => `${esc(x.promo_code)}: <b>${x.n}</b>`).join(' · ')}</p></div>` : ''}
    <p class="note">Счётчики воронки обезличены: без имён и ID.</p>`);
}

/* ---------- События ---------- */
function toastMsg(t) { const el = $('#toast'); if (!el) return; el.textContent = t; el.hidden = false; setTimeout(() => { el.hidden = true; }, 4000); }

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-adm-csv],[data-adm-addnote],[data-adm-tpl],[data-adm-quick],[data-adm-responded],[data-cfg-hist],[data-cfg-rb],[data-adm-copy],[data-adm-inv],[data-adm-invfor],[data-adm-tab],[data-adm-filter],[data-adm-lead],[data-adm-save],[data-adm-reply],[data-adm-del],[data-adm-cancel],[data-adm-days]');
  if (!t) return;
  const d = t.dataset; haptic();
  if ('admTpl' in d) { const x = TPL[+d.admTpl]; const el = $('#a-reply'); if (el) { el.value = el.value ? el.value + '\n' + x.text : x.text; el.focus(); } else { try { await navigator.clipboard.writeText(x.text); toastMsg('Текст скопирован — вставьте в чат клиента'); } catch { toastMsg('Не удалось скопировать'); } } return; }
  if (d.admAddnote) { const el = $('#a-newnote'); const text = (el.value || '').trim(); if (!text) return toastMsg('Напишите запись'); const r = await api(`admin/leads/${d.admAddnote}/notes`, { method: 'POST', body: JSON.stringify({ text }) }); toastMsg(r.ok ? 'Записано' : 'Не получилось'); return leadCard(d.admAddnote); }
  if ('admCsv' in d) {
    try { const r = await fetch('/api/admin/export/leads.csv', { headers: { 'X-Platform': P.kind, 'X-Init-Data': P.sdk?.initData || '' } }); if (!r.ok) return toastMsg('Не удалось выгрузить'); const text = await r.text(); try { await navigator.clipboard.writeText(text); toastMsg('CSV скопирован — вставьте в таблицу'); } catch { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = 'leads.csv'; a.click(); toastMsg('Файл leads.csv'); } } catch { toastMsg('Ошибка выгрузки'); } return;
  }
  if ('admQuick' in d) { const x = new Date(Date.now() + 3 * 3600e3 + (+d.admQuick) * 86400e3); const el = $('#a-na-at'); if (el) el.value = `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}T10:00`; return; }
  if (d.admResponded) { const r = await api(`admin/leads/${d.admResponded}`, { method: 'PATCH', body: JSON.stringify({ responded: true }) }); toastMsg(r.ok ? 'Отмечено' : 'Не получилось'); return leadCard(d.admResponded); }
  if (d.cfgHist) {
    const box = $(`#hist-${d.cfgHist}`); const r = await api(`admin/config/${d.cfgHist}/versions`);
    box.innerHTML = (r.versions || []).map(v => `<p class="meta">v${v.version} · ${dt(v.created_at)} · ${esc(v.note || '')}${v.live ? ' · <b>сейчас</b>' : ` <button class="chip" type="button" data-cfg-rb="${d.cfgHist}:${v.version}">Вернуть</button>`}</p>`).join('') || '<p class="meta">Версий пока нет.</p>'; return;
  }
  if (d.cfgRb) { const [k, v] = d.cfgRb.split(':'); if (!(await ask(`Вернуть версию ${v}? Текущая останется в истории.`))) return; const r = await api(`admin/config/${k}/rollback`, { method: 'POST', body: JSON.stringify({ version: +v }) }); toastMsg(r.ok ? 'Версия возвращена' : (r.error || 'Ошибка')); return contentScreen(); }
  if (d.admCopy) { try { await navigator.clipboard.writeText(d.admCopy); toastMsg('Ссылка скопирована'); } catch { toastMsg('Выделите ссылку и скопируйте'); } return; }
  if (d.admInvfor) { tab = 'inv'; return invoices(d.admInvfor); }
  if (d.admInv) { const [id, act] = d.admInv.split(':'); if (act === 'cancel' && !(await ask('Отменить счёт?'))) return; const r = await api(`admin/invoices/${id}/${act}`, { method: 'POST' }); toastMsg(r.ok ? 'Готово' : 'Не получилось'); return invoices(); }
  if (d.admTab) { tab = d.admTab; return admin(); }
  if ('admFilter' in d) { filter = d.admFilter; return leads(); }
  if (d.admLead) return leadCard(d.admLead);
  if (d.admDays) return funnel(+d.admDays);
  if (d.admSave) {
    const r = await api(`admin/leads/${d.admSave}`, { method: 'PATCH', body: JSON.stringify({ status: $('#a-st').value, note: $('#a-note').value, next_action: $('#a-na').value, next_action_at: $('#a-na-at').value || null, lost_reason: $('#a-lost').value || undefined, tags: $('#a-tags').value.split(',').map(x => x.trim()).filter(Boolean) }) });
    toastMsg(r.ok ? 'Сохранено' : (r.error || 'Не сохранилось')); if (r.ok) hapticOk(); return;
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
  const cf = e.target.closest('[data-cfg]');
  if (cf) {
    e.preventDefault();
    const key = cf.dataset.cfg;
    let value; try { value = formValue(key, cf); } catch { return toastMsg('Проверьте поля'); }
    const r = await api(`admin/config/${key}`, { method: 'POST', body: JSON.stringify({ value, note: 'из пульта' }) });
    toastMsg(r.ok ? `Опубликовано (v${r.version})` : (r.error || 'Ошибка')); if (r.ok) hapticOk();
    return;
  }
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
