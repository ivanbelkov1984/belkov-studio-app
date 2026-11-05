// Единый слой для Telegram, MAX и обычного браузера.
export const P = { kind: 'web', sdk: null, startParam: '' };

function detect() {
  const tg = window.Telegram?.WebApp;
  if (tg && tg.initData) return { kind: 'telegram', sdk: tg, startParam: tg.initDataUnsafe?.start_param || '' };
  const mx = window.WebApp;
  if (mx && (mx.initData || mx.initDataUnsafe?.user)) {
    const sp = mx.initDataUnsafe?.start_param;
    return { kind: 'max', sdk: mx, startParam: typeof sp === 'string' ? sp : (sp?.value || sp?.payload || '') };
  }
  return { kind: 'web', sdk: null, startParam: '' };
}

export async function initPlatform() {
  for (let i = 0; i < 20; i++) { const d = detect(); if (d.kind !== 'web') { Object.assign(P, d); break; } await new Promise(r => setTimeout(r, 50)); }
  try { P.sdk?.ready?.(); P.sdk?.expand?.(); } catch {}
  if (P.kind === 'telegram') { try { document.documentElement.dataset.theme = P.sdk.colorScheme; P.sdk.onEvent?.('themeChanged', () => { document.documentElement.dataset.theme = P.sdk.colorScheme; }); } catch {} }
  document.documentElement.dataset.platform = P.kind;
  return P;
}

export const haptic = (k = 'light') => { try { P.sdk?.HapticFeedback?.impactOccurred?.(k); } catch {} };
export const hapticOk = () => { try { P.sdk?.HapticFeedback?.notificationOccurred?.('success'); } catch {} };

export function openLink(url) {
  if (!url) return;
  try {
    if (P.kind === 'telegram' && /^https:\/\/t\.me\//.test(url)) return P.sdk.openTelegramLink(url);
    if (P.kind === 'max' && /^https:\/\/max\.ru\//.test(url) && P.sdk.openMaxLink) return P.sdk.openMaxLink(url);
    if (P.sdk?.openLink) return P.sdk.openLink(url);
  } catch {}
  window.open(url, '_blank', 'noopener');
}

/* Кнопка «Назад» платформы */
let backHandler = null;
export function setBack(fn) {
  const bb = P.sdk?.BackButton; backHandler = fn;
  if (!bb) return;
  try { if (fn) { bb.show(); } else { bb.hide(); } } catch {}
}
export function bindBack() { try { P.sdk?.BackButton?.onClick?.(() => backHandler && backHandler()); } catch {} }

/* Главная кнопка: Telegram MainButton; в MAX и вебе — закреплённая кнопка страницы */
let mainHandler = null;
export function setMain(text, fn) {
  mainHandler = fn;
  const mb = P.kind === 'telegram' ? P.sdk.MainButton : null;
  const dock = document.getElementById('dock');
  if (mb) {
    try { if (text) { mb.setText(text); mb.show(); } else mb.hide(); } catch {}
    if (dock) dock.hidden = true;
  } else if (dock) {
    dock.hidden = !text; dock.querySelector('button').textContent = text || '';
  }
}
export function bindMain() {
  try { P.sdk?.MainButton?.onClick?.(() => mainHandler && mainHandler()); } catch {}
  document.getElementById('dock')?.querySelector('button')?.addEventListener('click', () => mainHandler && mainHandler());
}

/* Хранилище черновика: облако Telegram, DeviceStorage MAX или localStorage */
export async function save(key, val) {
  const s = JSON.stringify(val);
  try { if (P.kind === 'telegram' && P.sdk.CloudStorage) return P.sdk.CloudStorage.setItem(key, s); } catch {}
  try { if (P.kind === 'max' && P.sdk.DeviceStorage) return await P.sdk.DeviceStorage.setItem(key, s); } catch {}
  try { localStorage.setItem(key, s); } catch {}
}
export async function load(key) {
  try {
    if (P.kind === 'telegram' && P.sdk.CloudStorage) return await new Promise(r => P.sdk.CloudStorage.getItem(key, (e, v) => r(v ? JSON.parse(v) : null)));
    if (P.kind === 'max' && P.sdk.DeviceStorage) { const v = await P.sdk.DeviceStorage.getItem(key); return v ? JSON.parse(v?.value ?? v) : null; }
  } catch {}
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}

/* Поделиться ссылкой */
export function share(url, text) {
  if (P.kind === 'max' && P.sdk.shareMaxContent) { try { return P.sdk.shareMaxContent({ text: `${text}\n${url}` }); } catch {} }
  if (P.kind === 'telegram') return openLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
  if (navigator.share) return navigator.share({ url, text }).catch(() => {});
  window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}
