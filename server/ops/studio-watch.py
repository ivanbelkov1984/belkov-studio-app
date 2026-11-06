#!/usr/bin/env python3
"""Сторож студии: проверяет сайт, API, музыкального бота, диск и сертификат; при сбое шлёт сообщение владельцу в MAX.
Запуск раз в 2 минуты из systemd-таймера (root). Секреты читает из /srv/studio/secrets/.env, в вывод их не пишет."""
import json, os, shutil, socket, ssl, subprocess, time, urllib.request, urllib.parse

ENV = "/srv/studio/secrets/.env"
STATE = "/var/lib/studio-watch/state.json"
CHECKS = [("сайт студии", "https://studio.aiservicesint.ru/"), ("API студии", "https://studio.aiservicesint.ru/api/health"),
          ("музыкальный бот", "https://music.aiservicesint.ru/health")]
FAILS_BEFORE_ALERT, REMIND_SEC = 2, 6 * 3600


def load_env():
    d = {}
    for line in open(ENV, encoding="utf-8"):
        if "=" in line and not line.startswith("#"):
            k, v = line.rstrip("\n").split("=", 1); d[k] = v
    return d


def http_ok(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return r.status == 200
    except Exception:
        return False


def cert_days(host):
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((host, 443), timeout=10) as s, ctx.wrap_socket(s, server_hostname=host) as t:
            exp = ssl.cert_time_to_seconds(t.getpeercert()["notAfter"])
        return int((exp - time.time()) / 86400)
    except Exception:
        return None


def send(env, text):
    token, uid, ca = env.get("MAX_BOT_TOKEN"), env.get("OWNER_MAX_ID"), env.get("MAX_CA_BUNDLE")
    if not token or not uid:
        return
    ctx = ssl.create_default_context(cafile=ca) if ca else None
    req = urllib.request.Request(f"https://platform-api2.max.ru/messages?user_id={urllib.parse.quote(uid)}",
                                 data=json.dumps({"text": text}).encode(), headers={"Authorization": token, "Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=20, context=ctx).read()
    except Exception:
        pass


def main():
    env = load_env()
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    try:
        st = json.load(open(STATE))
    except Exception:
        st = {}
    problems = {}
    for name, url in CHECKS:
        if not http_ok(url):
            problems[name] = "не отвечает"
    free = shutil.disk_usage("/")
    if free.used / free.total > 0.88:
        problems["диск"] = f"занято {int(100 * free.used / free.total)}%"
    for host in ("studio.aiservicesint.ru", "music.aiservicesint.ru"):
        d = cert_days(host)
        if d is not None and d < 10:
            problems[f"сертификат {host}"] = f"истекает через {d} дн."
    if "API студии" in problems:
        subprocess.run(["systemctl", "restart", "studio-api"], check=False)
    now = time.time()
    for k in set(problems) | set(st):
        e = st.get(k, {"fails": 0, "alerted": 0})
        if k in problems:
            e["fails"] += 1
            if e["fails"] >= FAILS_BEFORE_ALERT and now - e["alerted"] > REMIND_SEC:
                send(env, f"Сторож студии: {k} — {problems[k]}.")
                e["alerted"] = now
            st[k] = e
        else:
            if e.get("alerted"):
                send(env, f"Сторож студии: {k} — снова в порядке.")
            st.pop(k, None)
    json.dump(st, open(STATE, "w"))


if __name__ == "__main__":
    main()
