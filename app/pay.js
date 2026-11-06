// Экран оплаты счёта: https://studio.aiservicesint.ru/?pay=<id> (ссылку присылает студия).
import { P, openLink, setMain, hapticOk } from './platform.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rub = n => new Intl.NumberFormat('ru-RU').format(n) + ' ₽';

export async function payScreen(pub) {
  const view = document.getElementById('view');
  view.innerHTML = '<p class="note">Загружаем счёт…</p>';
  setMain(null);
  let d = {};
  try { d = await (await fetch(`/api/pay/${encodeURIComponent(pub)}`)).json(); } catch {}
  if (!d.ok) { view.innerHTML = `<h1>Счёт не найден</h1><p class="lead">Проверьте ссылку или напишите в чат студии.</p>`; return; }
  const head = `<p class="eyebrow">Оплата</p><h1>${esc(d.title)}</h1><p class="price">${rub(d.amount_rub)}</p>`;
  if (d.status === 'paid') {
    hapticOk();
    view.innerHTML = `${head}<div class="card"><p><b>Оплачено.</b> Спасибо! Чек придёт от «Мой налог».</p></div>`;
    return setMain('На главную', () => { location.hash = '#/'; });
  }
  if (d.status === 'canceled') { view.innerHTML = `${head}<div class="card"><p>Счёт отменён. Напишите в чат студии, если нужен новый.</p></div>`; return; }
  if (!d.online) { view.innerHTML = `${head}<div class="card"><p>Онлайн-оплата пока не подключена. Студия пришлёт реквизиты в чат.</p></div>`; return; }
  view.innerHTML = `${head}<div class="card"><p class="meta">Оплата картой, SberPay или через СБП на защищённой странице ЮKassa. Студия работает как самозанятый: чек придёт из «Мой налог».</p></div>
    <p class="note">После оплаты вернитесь сюда: статус обновится автоматически.</p>`;
  setMain(`Оплатить ${rub(d.amount_rub)}`, async () => {
    setMain('Открываем оплату…', () => {});
    let r = {};
    try { r = await (await fetch(`/api/pay/${encodeURIComponent(pub)}`, { method: 'POST' })).json(); } catch {}
    if (r.confirmation_url) {
      if (P.kind === 'web') location.href = r.confirmation_url; else openLink(r.confirmation_url);
      setMain('Я оплатил — проверить', () => payScreen(pub));
    } else if (r.result) payScreen(pub);
    else { setMain(`Оплатить ${rub(d.amount_rub)}`, () => payScreen(pub)); alert(r.error || 'Не удалось открыть оплату, попробуйте ещё раз'); }
  });
}
