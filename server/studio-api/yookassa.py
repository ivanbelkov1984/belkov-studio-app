"""ЮKassa API v3: минимальный надёжный адаптер (aiohttp, без SDK).

Основано на рабочей интеграции музыки (TMB-YOOKASSA-001) и документации yookassa.ru/developers:
  * https://api.yookassa.ru/v3, HTTP Basic shopId:secretKey;
  * POST обязательно с Idempotence-Key (UUIDv4, хранится у ЮKassa 24 ч);
  * сумма — строка с двумя знаками: {"value": "1500.00", "currency": "RUB"};
  * уведомление — только подсказка: платёж всегда перезапрашивается GET /payments/{id};
  * продавец-самозанятый: объект receipt (54-ФЗ) НЕ передаётся, чек — в «Мой налог».
Секреты в логи не попадают: в ошибках только HTTP-статус и код ЮKassa.
"""
from __future__ import annotations

import base64
import ipaddress
import logging
import os
import uuid
from decimal import Decimal, InvalidOperation

import aiohttp

log = logging.getLogger("yookassa")

SHOP_ID = os.environ.get("YOOKASSA_SHOP_ID", "").strip()
SECRET_KEY = os.environ.get("YOOKASSA_SECRET_KEY", "").strip()
API_BASE = (os.environ.get("YOOKASSA_API_BASE", "") or "https://api.yookassa.ru/v3").rstrip("/")
TIMEOUT_S = 20
DESCRIPTION_MAX = 128

# Адреса, с которых ЮKassa шлёт уведомления (yookassa.ru/developers/using-api/webhooks).
NOTIFY_NETWORKS = tuple(ipaddress.ip_network(n) for n in (
    "185.71.76.0/27", "185.71.77.0/27", "77.75.153.0/25", "77.75.156.11/32",
    "77.75.156.35/32", "77.75.154.128/25", "2a02:5180::/32",
))


class YooKassaError(Exception):
    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status

    @property
    def transient(self) -> bool:
        return self.status == 0 or self.status == 429 or self.status >= 500


def enabled() -> bool:
    return bool(SHOP_ID and SECRET_KEY)


def fmt_amount(rub: int) -> str:
    return f"{Decimal(rub).quantize(Decimal('0.01'))}"


def ip_allowed(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address((ip or "").strip())
    except ValueError:
        return False
    return any(addr in n for n in NOTIFY_NETWORKS)


async def _request(method: str, path: str, body: dict | None = None) -> dict:
    if not enabled():
        raise YooKassaError("yookassa is not configured")
    auth = base64.b64encode(f"{SHOP_ID}:{SECRET_KEY}".encode()).decode()
    headers = {"Content-Type": "application/json", "Authorization": "Basic " + auth}
    if method == "POST":
        headers["Idempotence-Key"] = str(uuid.uuid4())
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=TIMEOUT_S)) as s:
            async with s.request(method, API_BASE + path, json=body, headers=headers) as r:
                try:
                    data = await r.json(content_type=None)
                except Exception:
                    data = None
                if r.status != 200:
                    code = data.get("code") if isinstance(data, dict) else None
                    log.warning("yookassa %s %s -> HTTP %s (%s)", method, path.split("/")[1], r.status, code)
                    raise YooKassaError(f"HTTP {r.status} ({code})", r.status)
                if not isinstance(data, dict):
                    raise YooKassaError("non-object body")
                return data
    except YooKassaError:
        raise
    except Exception as e:
        log.warning("yookassa %s failed: %s", method, type(e).__name__)
        raise YooKassaError(type(e).__name__) from e


async def create_payment(amount_rub: int, description: str, return_url: str, metadata: dict) -> tuple[str, str]:
    """Одностадийный платёж с переходом на страницу ЮKassa -> (payment_id, confirmation_url)."""
    data = await _request("POST", "/payments", {
        "amount": {"value": fmt_amount(amount_rub), "currency": "RUB"},
        "capture": True,
        "confirmation": {"type": "redirect", "return_url": return_url},
        "description": description[:DESCRIPTION_MAX],
        "metadata": metadata,
    })
    pid, url = data.get("id"), (data.get("confirmation") or {}).get("confirmation_url")
    if not isinstance(pid, str) or not pid or not isinstance(url, str) or not url.startswith("https://"):
        raise YooKassaError("no id or confirmation_url")
    return pid, url


async def get_payment(payment_id: str) -> dict:
    pid = (payment_id or "").strip()
    if not pid or len(pid) > 64 or not all(c.isalnum() or c in "-_" for c in pid):
        raise YooKassaError("bad payment id", 400)
    return await _request("GET", f"/payments/{pid}")


def succeeded(payment: dict, meta_key: str) -> tuple[str, int] | None:
    """(id объекта из metadata, сумма в целых рублях), если платёж реально завершён в рублях."""
    if payment.get("status") != "succeeded" or payment.get("paid") is not True:
        return None
    amount = payment.get("amount") or {}
    if amount.get("currency") != "RUB":
        return None
    try:
        value = Decimal(str(amount.get("value")))
    except (InvalidOperation, ValueError):
        return None
    if value != value.to_integral_value() or value <= 0:
        return None
    ref = (payment.get("metadata") or {}).get(meta_key)
    return (ref, int(value)) if isinstance(ref, str) and ref else None
