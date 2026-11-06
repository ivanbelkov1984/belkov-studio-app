"""Пульт студии: API заявок, публикации и воронки.

Запуск: python3 app.py (systemd studio-api.service), слушает 127.0.0.1:3001,
nginx отдаёт его как https://studio.aiservicesint.ru/api/...
Зависимости: python3-aiohttp, python3-asyncpg (пакеты Ubuntu). Секреты только из окружения.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import ssl
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl

import secrets

import aiohttp
import asyncpg
from aiohttp import web

import yookassa as yk

log = logging.getLogger("studio-api")

# ---------- Настройки (все из окружения) ----------
E = os.environ.get
DATABASE_URL = E("DATABASE_URL", "")
TG_BOT_TOKEN = E("TG_BOT_TOKEN", "").strip()
MAX_BOT_TOKEN = E("MAX_BOT_TOKEN", "").strip()
OWNER_TG_ID = E("OWNER_TG_ID", "").strip()
OWNER_MAX_ID = E("OWNER_MAX_ID", "").strip()
TG_CHANNEL_ID = E("TG_CHANNEL_ID", "").strip()          # например @belkovstudio
MAX_CHANNEL_CHAT_ID = E("MAX_CHANNEL_CHAT_ID", "").strip()
MAX_API_BASE = E("MAX_API_BASE", "https://platform-api2.max.ru").rstrip("/")
MAX_CA_BUNDLE = E("MAX_CA_BUNDLE", "").strip()
LEADS_ENABLED = E("LEADS_ENABLED", "0") == "1"          # приём заявок на сервер (после уведомления РКН)
CONSENT_VERSION = E("CONSENT_VERSION", "2026-11-05")
TG_APP_LINK = E("TG_APP_LINK", "https://t.me/BelkovSMM_bot")
MAX_APP_LINK = E("MAX_APP_LINK", "https://max.ru/se14910384_1_bot")
RETENTION_DAYS = int(E("RETENTION_DAYS", "365"))
PUBLIC_URL = E("PUBLIC_URL", "https://studio.aiservicesint.ru").rstrip("/")
# Telegram Bot API заблокирован из дата-центров РФ: по умолчанию серверные вызовы Telegram выключены.
# Проверка подписи Telegram работает без сети, поэтому пульт открывается и в Telegram.
TG_API_ENABLED = E("TG_API_ENABLED", "0") == "1"
TG_OFF = "Telegram API недоступен с сервера в РФ: ответьте вручную в Telegram"
INIT_MAX_AGE = 24 * 3600

STATUSES = ["new", "work", "offer", "contract", "done", "lost"]
KEEP_STATUSES = {"contract", "done"}                      # договорные данные хранятся по сроку договора
EVENT_TYPES = {"open", "calc", "brief", "lead"}
PLATFORMS = {"telegram", "max", "web"}


def clean(v, n=2000):
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", str(v or "")).strip()[:n]


def slug(v, n=32):
    return re.sub(r"[^a-z0-9_-]", "", str(v or "").lower())[:n]


# ---------- Проверка подписанных данных запуска (Telegram и MAX: одна схема) ----------
def verify_init_data(init_data: str, bot_token: str) -> dict | None:
    if not init_data or not bot_token:
        return None
    pairs = parse_qsl(init_data, keep_blank_values=True)
    keys = [k for k, _ in pairs]
    if keys.count("hash") != 1 or len(keys) != len(set(keys)):
        return None
    data = dict(pairs)
    got = data.pop("hash").lower()
    check = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, got):
        return None
    try:
        age = time.time() - int(data.get("auth_date", "0"))
    except ValueError:
        return None
    if age > INIT_MAX_AGE or age < -300:
        return None
    try:
        user = json.loads(data.get("user", ""))
    except ValueError:
        return None
    return user if isinstance(user, dict) and "id" in user else None


def identify(request) -> tuple[str, dict | None]:
    plat = request.headers.get("X-Platform", "")
    init = request.headers.get("X-Init-Data", "")
    if plat == "telegram":
        return plat, verify_init_data(init, TG_BOT_TOKEN)
    if plat == "max":
        return plat, verify_init_data(init, MAX_BOT_TOKEN)
    return "web", None


def is_owner(plat: str, user: dict | None) -> bool:
    if not user:
        return False
    uid = str(user.get("id"))
    return (plat == "telegram" and OWNER_TG_ID and uid == OWNER_TG_ID) or \
           (plat == "max" and OWNER_MAX_ID and uid == OWNER_MAX_ID)


# ---------- Мессенджеры ----------
class Messengers:
    def __init__(self, session: aiohttp.ClientSession):
        self.s = session
        self.max_ssl = None
        if MAX_CA_BUNDLE:
            self.max_ssl = ssl.create_default_context()
            self.max_ssl.load_verify_locations(cafile=MAX_CA_BUNDLE)

    async def tg(self, method: str, payload: dict) -> dict:
        if not TG_API_ENABLED:
            return {"ok": False, "error": TG_OFF}
        if not TG_BOT_TOKEN:
            return {"ok": False, "error": "TG_BOT_TOKEN не задан"}
        try:
            async with self.s.post(f"https://api.telegram.org/bot{TG_BOT_TOKEN}/{method}", json=payload,
                                   timeout=aiohttp.ClientTimeout(total=10)) as r:
                body = await r.json(content_type=None)
                return body if isinstance(body, dict) else {"ok": False, "error": str(body)[:300]}
        except Exception as e:
            return {"ok": False, "error": f"Telegram: {type(e).__name__}"}

    async def max(self, query: str, body: dict) -> dict:
        if not MAX_BOT_TOKEN:
            return {"ok": False, "error": "MAX_BOT_TOKEN не задан"}
        headers = {"Authorization": MAX_BOT_TOKEN, "Accept": "application/json"}
        for attempt in range(4):
            try:
                async with self.s.post(f"{MAX_API_BASE}/messages?{query}", json=body, headers=headers,
                                       ssl=self.max_ssl, timeout=aiohttp.ClientTimeout(total=20)) as r:
                    data = await r.json(content_type=None)
                    if r.status < 400:
                        return {"ok": True, "result": data}
                    if "not.ready" in str(data).lower() and attempt < 3:
                        await asyncio.sleep(2)
                        continue
                    return {"ok": False, "status": r.status, "error": str(data)[:300]}
            except Exception as e:
                return {"ok": False, "error": f"MAX: {type(e).__name__}"}
        return {"ok": False, "error": "MAX: повторы исчерпаны"}

    async def to_user(self, plat: str, user_id: str, text: str) -> dict:
        if plat == "telegram":
            res = await self.tg("sendMessage", {"chat_id": user_id, "text": text})
            return {"ok": bool(res.get("ok")), "error": res.get("description") or res.get("error")}
        if plat == "max":
            return await self.max(f"user_id={user_id}", {"text": text})
        return {"ok": False, "error": "у веб-заявки нет чата: свяжитесь по контакту"}

    async def notify_owner(self, text: str):
        try:
            return await self._notify_owner(text)
        except Exception:
            log.exception("notify_owner")

    async def _notify_owner(self, text: str):
        out = []
        if OWNER_TG_ID and TG_API_ENABLED:
            out.append(await self.tg("sendMessage", {"chat_id": OWNER_TG_ID, "text": text}))
        if OWNER_MAX_ID:
            out.append(await self.max(f"user_id={OWNER_MAX_ID}", {"text": text}))
        return out

    async def publish(self, post: dict) -> dict:
        res = {}
        targets = set((post.get("targets") or "").split(","))
        text, photo, button = post["text"], post.get("photo_url"), post.get("button")
        if "telegram" in targets and not TG_API_ENABLED:
            res["telegram"] = {"ok": False, "error": TG_OFF}
        elif "telegram" in targets and TG_CHANNEL_ID:
            kb = {"inline_keyboard": [[{"text": "Открыть студию", "url": f"{TG_APP_LINK}?startapp=src_post{post['id']}"}]]} if button else None
            if photo:
                p = {"chat_id": TG_CHANNEL_ID, "photo": photo, "caption": text[:1024]}
            else:
                p = {"chat_id": TG_CHANNEL_ID, "text": text[:4096], "link_preview_options": {"is_disabled": True}}
            if kb:
                p["reply_markup"] = kb
            r = await self.tg("sendPhoto" if photo else "sendMessage", p)
            res["telegram"] = {"ok": bool(r.get("ok")), "error": r.get("description") or r.get("error")}
        if "max" in targets and MAX_CHANNEL_CHAT_ID:
            att = []
            if photo:
                att.append({"type": "image", "payload": {"url": photo}})
            if button:
                att.append({"type": "inline_keyboard", "payload": {"buttons": [[
                    {"type": "link", "text": "Открыть студию", "url": f"{MAX_APP_LINK}?startapp=src_post{post['id']}"}]]}})
            body = {"text": text[:4000], "notify": True}
            if att:
                body["attachments"] = att
            r = await self.max(f"chat_id={MAX_CHANNEL_CHAT_ID}", body)
            res["max"] = {"ok": r.get("ok"), "error": r.get("error")}
        return res


# ---------- Простой ограничитель частоты для публичных точек ----------
_hits: dict[str, list[float]] = {}


def rate_ok(key: str, limit: int, window: int) -> bool:
    now = time.time()
    arr = [t for t in _hits.get(key, []) if now - t < window]
    if len(arr) >= limit:
        _hits[key] = arr
        return False
    arr.append(now)
    _hits[key] = arr
    if len(_hits) > 5000:
        _hits.clear()
    return True


def client_ip(request) -> str:
    return request.headers.get("X-Real-IP") or request.headers.get("X-Forwarded-For", "").split(",")[0] or request.remote or ""


async def audit(pool, action: str, lead_id=None, detail: str = ""):
    await pool.execute("INSERT INTO audit(action, lead_id, detail) VALUES($1,$2,$3)", action, lead_id, detail[:500])


# ---------- Публичные точки ----------
async def health(request):
    return web.json_response({"ok": True})


async def status(request):
    return web.json_response({"leads": LEADS_ENABLED})


async def event(request):
    if not rate_ok("ev:" + client_ip(request), 60, 60):
        return web.json_response({"ok": False}, status=429)
    try:
        b = await request.json()
    except Exception:
        return web.json_response({"ok": False}, status=400)
    t = slug(b.get("type"), 16)
    if t not in EVENT_TYPES:
        return web.json_response({"ok": False}, status=400)
    plat = slug(b.get("plat"), 16)
    plat = plat if plat in PLATFORMS else ""
    await request.app["pool"].execute(
        "INSERT INTO events(day,type,src,plat,n) VALUES(current_date,$1,$2,$3,1) "
        "ON CONFLICT (day,type,src,plat) DO UPDATE SET n = events.n + 1", t, slug(b.get("src")), plat)
    return web.json_response({"ok": True})


async def lead(request):
    if not LEADS_ENABLED:
        return web.json_response({"ok": False, "stored": False, "reason": "disabled"}, status=202)
    if not rate_ok("lead:" + client_ip(request), 5, 600):
        return web.json_response({"ok": False, "error": "Слишком много заявок, попробуйте позже"}, status=429)
    try:
        b = await request.json()
    except Exception:
        return web.json_response({"ok": False}, status=400)
    if b.get("consent") is not True:
        return web.json_response({"ok": False, "error": "Нужно согласие на обработку данных"}, status=400)
    task = clean(b.get("task"))
    if not task:
        return web.json_response({"ok": False, "error": "Опишите задачу"}, status=400)
    plat, user = identify(request)
    contact = clean(b.get("contact"), 200)
    if plat == "web" and not contact:
        return web.json_response({"ok": False, "error": "Укажите, как с вами связаться"}, status=400)
    if plat in ("telegram", "max") and not user:
        return web.json_response({"ok": False, "error": "Не удалось подтвердить данные запуска, обновите приложение"}, status=401)
    name = clean(" ".join(filter(None, [(user or {}).get("first_name"), (user or {}).get("last_name")])), 200)
    pool = request.app["pool"]
    lid = await pool.fetchval(
        "INSERT INTO leads(platform,user_id,username,name,contact,biz,svc,task,budget,when_text,calc,src,consent_at,consent_version) "
        "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),$13) RETURNING id",
        plat, str(user["id"]) if user else None, clean((user or {}).get("username"), 100) or None, name or None,
        contact or None, clean(b.get("biz"), 300), slug(b.get("svc")), task, clean(b.get("budget"), 100),
        clean(b.get("when"), 100), clean(b.get("calc"), 1000), slug(b.get("src")), CONSENT_VERSION)
    await audit(pool, "lead_created", lid, plat)
    who = ("@" + user["username"]) if user and user.get("username") else (name or contact or "без имени")
    msg = f"Новая заявка #{lid} ({plat})\nОт: {who}\nЗадача: {task[:500]}"
    if b.get("budget"):
        msg += f"\nБюджет: {clean(b.get('budget'), 100)}"
    asyncio.create_task(request.app["msg"].notify_owner(msg + "\n\nОткройте пульт в боте студии."))
    return web.json_response({"ok": True, "stored": True, "id": lid})


# ---------- Пульт владельца ----------
@web.middleware
async def admin_guard(request, handler):
    if request.path.startswith("/api/admin/") and request.path != "/api/admin/whoami":
        plat, user = identify(request)
        if not is_owner(plat, user):
            return web.json_response({"ok": False, "error": "forbidden"}, status=403)
        request["owner"] = (plat, user)
    return await handler(request)


async def whoami(request):
    """Показывает пользователю только его собственный проверенный id (для настройки OWNER_*_ID)."""
    plat, user = identify(request)
    if not user:
        return web.json_response({"ok": False, "owner": False}, status=401)
    return web.json_response({"ok": True, "platform": plat, "id": str(user["id"]), "owner": is_owner(plat, user)})


def row(r) -> dict:
    d = dict(r)
    for k, v in d.items():
        if isinstance(v, datetime):
            d[k] = v.isoformat()
    return d


async def leads_list(request):
    st = request.query.get("status", "")
    pool = request.app["pool"]
    if st in STATUSES:
        rows = await pool.fetch("SELECT * FROM leads WHERE status=$1 ORDER BY created_at DESC LIMIT 200", st)
    else:
        rows = await pool.fetch("SELECT * FROM leads WHERE status NOT IN ('done','lost') ORDER BY created_at DESC LIMIT 200")
    counts = {r["status"]: r["n"] for r in await pool.fetch("SELECT status, count(*) AS n FROM leads GROUP BY status")}
    return web.json_response({"ok": True, "leads": [row(r) for r in rows], "counts": counts, "enabled": LEADS_ENABLED,
                              "tg_api": TG_API_ENABLED})


async def lead_get(request):
    lid = int(request.match_info["id"])
    pool = request.app["pool"]
    r = await pool.fetchrow("SELECT * FROM leads WHERE id=$1", lid)
    if not r:
        return web.json_response({"ok": False}, status=404)
    msgs = await pool.fetch("SELECT * FROM lead_messages WHERE lead_id=$1 ORDER BY created_at", lid)
    return web.json_response({"ok": True, "lead": row(r), "messages": [row(m) for m in msgs], "tg_api": TG_API_ENABLED})


async def lead_patch(request):
    lid = int(request.match_info["id"])
    b = await request.json()
    pool = request.app["pool"]
    st = b.get("status")
    if st is not None and st not in STATUSES:
        return web.json_response({"ok": False, "error": "bad status"}, status=400)
    r = await pool.fetchrow(
        "UPDATE leads SET status=COALESCE($2,status), note=COALESCE($3,note), updated_at=now() WHERE id=$1 RETURNING id",
        lid, st, clean(b["note"], 2000) if "note" in b else None)
    if not r:
        return web.json_response({"ok": False}, status=404)
    if st:
        await audit(pool, "status", lid, st)
    return web.json_response({"ok": True})


async def lead_reply(request):
    lid = int(request.match_info["id"])
    text = clean((await request.json()).get("text"), 3500)
    if not text:
        return web.json_response({"ok": False, "error": "пустой ответ"}, status=400)
    pool = request.app["pool"]
    r = await pool.fetchrow("SELECT platform, user_id FROM leads WHERE id=$1", lid)
    if not r:
        return web.json_response({"ok": False}, status=404)
    res = await request.app["msg"].to_user(r["platform"], r["user_id"] or "", text)
    await pool.execute("INSERT INTO lead_messages(lead_id,direction,text,ok,error) VALUES($1,'out',$2,$3,$4)",
                       lid, text, bool(res.get("ok")), (res.get("error") or None) and str(res.get("error"))[:300])
    await pool.execute("UPDATE leads SET status=CASE WHEN status='new' THEN 'work' ELSE status END, updated_at=now() WHERE id=$1", lid)
    await audit(pool, "reply", lid, "ok" if res.get("ok") else "error")
    return web.json_response({"ok": bool(res.get("ok")), "error": res.get("error")})


async def lead_delete(request):
    lid = int(request.match_info["id"])
    pool = request.app["pool"]
    n = await pool.execute("DELETE FROM leads WHERE id=$1", lid)
    await audit(pool, "deleted_by_request", lid, n)
    return web.json_response({"ok": n.endswith("1")})


async def funnel(request):
    days = max(1, min(365, int(request.query.get("days", "30"))))
    pool = request.app["pool"]
    rows = await pool.fetch(
        "SELECT src, type, sum(n)::int AS n FROM events WHERE day >= current_date - $1::int GROUP BY src, type", days)
    by_src: dict[str, dict] = {}
    for r in rows:
        by_src.setdefault(r["src"] or "без метки", {t: 0 for t in EVENT_TYPES})[r["type"]] = r["n"]
    total = {t: sum(v[t] for v in by_src.values()) for t in EVENT_TYPES}
    return web.json_response({"ok": True, "days": days, "total": total,
                              "sources": sorted(([k, v] for k, v in by_src.items()), key=lambda x: -x[1]["open"])})


async def posts_list(request):
    rows = await request.app["pool"].fetch("SELECT * FROM posts ORDER BY created_at DESC LIMIT 50")
    out = []
    for r in rows:
        d = row(r)
        d["result"] = json.loads(r["result"]) if r["result"] else None
        out.append(d)
    return web.json_response({"ok": True, "posts": out,
                              "channels": {"telegram": bool(TG_API_ENABLED and TG_CHANNEL_ID and TG_BOT_TOKEN),
                                           "max": bool(MAX_CHANNEL_CHAT_ID and MAX_BOT_TOKEN)}})


async def post_create(request):
    b = await request.json()
    text = clean(b.get("text"), 4000)
    if not text:
        return web.json_response({"ok": False, "error": "пустой текст"}, status=400)
    photo = clean(b.get("photo_url"), 500) or None
    if photo and not photo.startswith("https://"):
        return web.json_response({"ok": False, "error": "фото: нужна ссылка https://"}, status=400)
    targets = ",".join(t for t in ("telegram", "max") if t in (b.get("targets") or ["telegram", "max"]))
    if not targets:
        return web.json_response({"ok": False, "error": "не выбран канал"}, status=400)
    send_at = datetime.now(timezone.utc)
    if b.get("send_at"):
        try:
            send_at = datetime.fromisoformat(str(b["send_at"]))
            if send_at.tzinfo is None:
                send_at = send_at.replace(tzinfo=timezone(timedelta(hours=3)))  # время владельца — МСК
        except ValueError:
            return web.json_response({"ok": False, "error": "неверная дата"}, status=400)
    pid = await request.app["pool"].fetchval(
        "INSERT INTO posts(text,photo_url,button,targets,send_at) VALUES($1,$2,$3,$4,$5) RETURNING id",
        text, photo, bool(b.get("button", True)), targets, send_at)
    request.app["wake"].set()
    return web.json_response({"ok": True, "id": pid, "send_at": send_at.isoformat()})


async def post_cancel(request):
    pid = int(request.match_info["id"])
    r = await request.app["pool"].execute("UPDATE posts SET status='canceled' WHERE id=$1 AND status='scheduled'", pid)
    return web.json_response({"ok": r.endswith("1")})


# ---------- Счета и оплата ЮKassa ----------
def pay_link(pub: str) -> str:
    return f"{PUBLIC_URL}/?pay={pub}"


_pay_locks: dict[str, asyncio.Lock] = {}


def pay_lock(pub: str) -> asyncio.Lock:
    if len(_pay_locks) > 1000:
        for k in [k for k, v in _pay_locks.items() if not v.locked()]:
            _pay_locks.pop(k, None)
    return _pay_locks.setdefault(pub, asyncio.Lock())


async def apply_payment(app, payment: dict, expected: str | None = None) -> str:
    """Применяет платёж, полученный ИЗ API (не тело уведомления). Возвращает итог."""
    found = yk.succeeded(payment, "invoice_id")
    if not found:
        return "not_succeeded"
    pub, amount = found
    if expected and pub != expected:
        return "invoice_mismatch"
    pool, pid = app["pool"], str(payment["id"])
    inv = await pool.fetchrow("SELECT * FROM invoices WHERE public_id=$1", pub)
    if not inv:
        await app["msg"].notify_owner(f"ВНИМАНИЕ: платёж ЮKassa {pid} на {amount} ₽ по неизвестному счёту {pub}. Проверьте и при необходимости верните деньги.")
        return "unknown_invoice"
    if inv["payment_ref"] == pid:
        return "duplicate"
    if inv["amount_rub"] != amount:
        await app["msg"].notify_owner(f"ВНИМАНИЕ: платёж {pid} на {amount} ₽ не совпал с суммой счёта #{inv['id']} ({inv['amount_rub']} ₽). Не применён.")
        return "amount_mismatch"
    upd = await pool.fetchrow(
        "UPDATE invoices SET status='paid', payment_ref=$2, paid_at=now() "
        "WHERE public_id=$1 AND status='awaiting_payment' RETURNING id, lead_id", pub, pid)
    if not upd:
        return "not_payable"
    if upd["lead_id"]:
        await pool.execute("UPDATE leads SET status='contract', updated_at=now() WHERE id=$1 AND status IN ('new','work','offer')", upd["lead_id"])
    await audit(pool, "invoice_paid", upd["lead_id"], f"invoice {upd['id']} {amount} RUB")
    asyncio.create_task(app["msg"].notify_owner(
        f"Оплачен счёт #{upd['id']}: {inv['title']} — {amount} ₽.\nПробейте чек в «Мой налог» и отметьте в пульте."))
    return "paid"


async def refresh_invoice(app, inv) -> None:
    """Проверяет последний платёж счёта через API: студия не зависит от адреса уведомлений."""
    if not inv["provider_payment_id"] or inv["status"] != "awaiting_payment" or not yk.enabled():
        return
    try:
        payment = await yk.get_payment(inv["provider_payment_id"])
    except yk.YooKassaError:
        return
    if payment.get("status") == "succeeded":
        await apply_payment(app, payment, expected=inv["public_id"])


def inv_view(r) -> dict:
    return {"title": r["title"], "amount_rub": r["amount_rub"], "status": r["status"],
            "paid_at": r["paid_at"].isoformat() if r["paid_at"] else None}


async def pay_info(request):
    pub = request.match_info["pub"]
    pool = request.app["pool"]
    inv = await pool.fetchrow("SELECT * FROM invoices WHERE public_id=$1", pub)
    if not inv:
        return web.json_response({"ok": False, "error": "Счёт не найден"}, status=404)
    if inv["status"] == "awaiting_payment" and inv["provider_payment_id"]:
        await refresh_invoice(request.app, inv)
        inv = await pool.fetchrow("SELECT * FROM invoices WHERE public_id=$1", pub)
    return web.json_response({"ok": True, **inv_view(inv), "online": yk.enabled()})


async def pay_start(request):
    pub = request.match_info["pub"]
    if not yk.enabled():
        return web.json_response({"ok": False, "error": "Онлайн-оплата пока не подключена"}, status=503)
    if not rate_ok("pay:" + client_ip(request), 10, 60):
        return web.json_response({"ok": False, "error": "Слишком часто, попробуйте через минуту"}, status=429)
    async with pay_lock(pub):
        pool = request.app["pool"]
        inv = await pool.fetchrow("SELECT * FROM invoices WHERE public_id=$1", pub)
        if not inv:
            return web.json_response({"ok": False, "error": "Счёт не найден"}, status=404)
        if inv["status"] != "awaiting_payment":
            return web.json_response({"ok": False, "status": inv["status"], "error": "Счёт уже не ждёт оплаты"}, status=409)
        if inv["provider_payment_id"]:
            try:
                payment = await yk.get_payment(inv["provider_payment_id"])
            except yk.YooKassaError as e:
                if e.transient:
                    return web.json_response({"ok": False, "error": "Платёжный сервис недоступен, попробуйте позже"}, status=502)
                payment = None
            st = (payment or {}).get("status")
            if st == "pending":
                url = (payment.get("confirmation") or {}).get("confirmation_url")
                if isinstance(url, str) and url.startswith("https://"):
                    return web.json_response({"ok": True, "confirmation_url": url})
            elif st == "succeeded":
                res = await apply_payment(request.app, payment, expected=pub)
                return web.json_response({"ok": True, "result": res})
            elif st == "waiting_for_capture":
                return web.json_response({"ok": False, "error": "Платёж обрабатывается"}, status=409)
        try:
            pid, url = await yk.create_payment(inv["amount_rub"], f"{inv['title']}, счёт {inv['id']}",
                                               pay_link(pub), {"invoice_id": pub})
        except yk.YooKassaError:
            return web.json_response({"ok": False, "error": "Платёжный сервис недоступен, попробуйте позже"}, status=502)
        await pool.execute("UPDATE invoices SET provider_payment_id=$2 WHERE public_id=$1 AND status='awaiting_payment'", pub, pid)
        return web.json_response({"ok": True, "confirmation_url": url})


async def yookassa_notify(request):
    """Уведомление ЮKassa: тело — только подсказка, решает повторный запрос платежа через API."""
    if not yk.enabled():
        return web.json_response({"ok": False}, status=503)
    if not rate_ok("yk", 120, 60):
        return web.json_response({"ok": False}, status=429)
    if not yk.ip_allowed(client_ip(request)):
        log.warning("yookassa notification from non-YooKassa address (re-fetch decides)")
    try:
        data = json.loads(await request.read())
    except (ValueError, UnicodeDecodeError):
        return web.json_response({"ok": False}, status=400)
    obj = data.get("object") if isinstance(data, dict) else None
    pid = obj.get("id") if isinstance(obj, dict) else None
    if not isinstance(pid, str) or data.get("event") not in ("payment.succeeded", "payment.canceled"):
        return web.json_response({"result": "ignored"})
    try:
        payment = await yk.get_payment(pid)
    except yk.YooKassaError as e:
        return web.json_response({"ok": False}, status=503) if e.transient else web.json_response({"result": "ignored"})
    if payment.get("id") != pid or payment.get("status") != "succeeded":
        return web.json_response({"result": "not_succeeded"})
    return web.json_response({"result": await apply_payment(request.app, payment)})


async def invoices_list(request):
    rows = await request.app["pool"].fetch("SELECT * FROM invoices ORDER BY created_at DESC LIMIT 100")
    return web.json_response({"ok": True, "online": yk.enabled(), "invoices": [
        {**row(r), "link": pay_link(r["public_id"])} for r in rows]})


async def invoice_create(request):
    b = await request.json()
    title = clean(b.get("title"), 120)
    try:
        amount = int(b.get("amount_rub"))
    except (TypeError, ValueError):
        amount = 0
    if not title or amount <= 0 or amount > 1_000_000:
        return web.json_response({"ok": False, "error": "Нужны название и сумма от 1 до 1 000 000 ₽"}, status=400)
    lead_id = b.get("lead_id")
    lead_id = int(lead_id) if str(lead_id or "").isdigit() else None
    pub = secrets.token_urlsafe(12)
    iid = await request.app["pool"].fetchval(
        "INSERT INTO invoices(public_id, lead_id, title, amount_rub) VALUES($1,$2,$3,$4) RETURNING id", pub, lead_id, title, amount)
    await audit(request.app["pool"], "invoice_created", lead_id, f"invoice {iid} {amount} RUB")
    return web.json_response({"ok": True, "id": iid, "link": pay_link(pub)})


async def invoice_action(request):
    iid, action = int(request.match_info["id"]), request.match_info["action"]
    pool = request.app["pool"]
    if action == "receipt":
        r = await pool.execute("UPDATE invoices SET receipt_done=true WHERE id=$1 AND status='paid'", iid)
    elif action == "cancel":
        r = await pool.execute("UPDATE invoices SET status='canceled' WHERE id=$1 AND status='awaiting_payment'", iid)
    elif action == "check":
        inv = await pool.fetchrow("SELECT * FROM invoices WHERE id=$1", iid)
        if inv:
            await refresh_invoice(request.app, inv)
        r = "UPDATE 1"
    else:
        return web.json_response({"ok": False}, status=404)
    return web.json_response({"ok": r.endswith("1")})


# ---------- Фоновые задачи: публикация по расписанию, сроки хранения ----------
async def scheduler(app):
    pool, msg = app["pool"], app["msg"]
    last_retention = 0.0
    while True:
        try:
            due = await pool.fetch("SELECT * FROM posts WHERE status='scheduled' AND send_at <= now() ORDER BY send_at LIMIT 5")
            for p in due:
                claimed = await pool.execute("UPDATE posts SET status='sending' WHERE id=$1 AND status='scheduled'", p["id"])
                if not claimed.endswith("1"):
                    continue
                res = await msg.publish(dict(p))
                oks = [v.get("ok") for v in res.values()]
                st = "sent" if oks and all(oks) else ("partial" if any(oks) else "failed")
                await pool.execute("UPDATE posts SET status=$2, result=$3 WHERE id=$1", p["id"], st, json.dumps(res, ensure_ascii=False))
            if yk.enabled():
                pending = await pool.fetch(
                    "SELECT * FROM invoices WHERE status='awaiting_payment' AND provider_payment_id IS NOT NULL "
                    "AND created_at > now() - interval '7 days' ORDER BY created_at DESC LIMIT 10")
                for inv in pending:
                    await refresh_invoice(app, inv)
            if time.time() - last_retention > 6 * 3600:
                last_retention = time.time()
                gone = await pool.fetch(
                    "DELETE FROM leads WHERE status <> ALL($1::text[]) AND updated_at < now() - make_interval(days => $2) RETURNING id",
                    list(KEEP_STATUSES), RETENTION_DAYS)
                for g in gone:
                    await audit(pool, "deleted_retention", g["id"], f"{RETENTION_DAYS}d")
                await pool.execute("DELETE FROM events WHERE day < current_date - 730")
        except Exception:
            log.exception("scheduler")
        app["wake"].clear()
        try:
            await asyncio.wait_for(app["wake"].wait(), timeout=30)
        except asyncio.TimeoutError:
            pass


async def on_start(app):
    app["pool"] = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql"), encoding="utf-8") as f:
        await app["pool"].execute(f.read())
    app["http"] = aiohttp.ClientSession()
    app["msg"] = Messengers(app["http"])
    app["wake"] = asyncio.Event()
    app["bg"] = asyncio.create_task(scheduler(app))


async def on_stop(app):
    app["bg"].cancel()
    await app["http"].close()
    await app["pool"].close()


def make_app() -> web.Application:
    app = web.Application(middlewares=[admin_guard], client_max_size=64 * 1024)
    r = app.router
    r.add_get("/api/health", health)
    r.add_get("/api/status", status)
    r.add_post("/api/event", event)
    r.add_post("/api/lead", lead)
    r.add_get("/api/admin/whoami", whoami)
    r.add_get("/api/admin/leads", leads_list)
    r.add_get("/api/admin/leads/{id:\\d+}", lead_get)
    r.add_patch("/api/admin/leads/{id:\\d+}", lead_patch)
    r.add_post("/api/admin/leads/{id:\\d+}/reply", lead_reply)
    r.add_delete("/api/admin/leads/{id:\\d+}", lead_delete)
    r.add_get("/api/admin/funnel", funnel)
    r.add_get("/api/admin/posts", posts_list)
    r.add_post("/api/admin/posts", post_create)
    r.add_post("/api/admin/posts/{id:\\d+}/cancel", post_cancel)
    r.add_get("/api/admin/invoices", invoices_list)
    r.add_post("/api/admin/invoices", invoice_create)
    r.add_post("/api/admin/invoices/{id:\\d+}/{action:receipt|cancel|check}", invoice_action)
    r.add_get("/api/pay/{pub:[A-Za-z0-9_-]{8,40}}", pay_info)
    r.add_post("/api/pay/{pub:[A-Za-z0-9_-]{8,40}}", pay_start)
    r.add_post("/api/payments/yookassa", yookassa_notify)
    app.on_startup.append(on_start)
    app.on_cleanup.append(on_stop)
    return app


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    web.run_app(make_app(), host="127.0.0.1", port=int(E("PORT", "3001")), access_log=None)
