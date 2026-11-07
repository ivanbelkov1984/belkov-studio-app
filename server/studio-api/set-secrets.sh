#!/usr/bin/env bash
# Внести секреты пульта студии на сервер. Запуск владельцем в Git Bash:
#   bash server/studio-api/set-secrets.sh
# Значения вводятся скрыто, в чат, историю и репозиторий не попадают. Пустой ввод — оставить как есть.
set -euo pipefail
KEY="${SSH_KEY:-$HOME/.ssh/timeweb_belkov}"
HOST="deploy@168.113.190.224"

ONLY="${1:-}"   # можно спросить один ключ: bash set-secrets.sh MAX_BOT_TOKEN
ask() { # имя, подсказка, скрыто(1/0)
  local v
  [ -n "$ONLY" ] && [ "$1" != "$ONLY" ] && return 0
  if [ "$3" = 1 ]; then read -r -s -p "$2: " v; echo; else read -r -p "$2: " v; fi
  [ -n "$v" ] && printf '%s=%s\n' "$1" "$v" >> "$TMP"
  return 0
}
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
echo "Пустой ввод = не менять."
ask MAX_BOT_TOKEN "Токен MAX-бота студии (@se14910384_1_bot): business.max.ru → Чат-боты → Настройки → Токен" 1
ask OWNER_MAX_ID "Ваш ID в MAX (пульт в боте покажет его при первом открытии)" 0
ask MAX_CHANNEL_CHAT_ID "ID канала студии в MAX (после добавления бота админом)" 0
ask OWNER_TG_ID "Ваш ID в Telegram (пульт покажет при открытии в Telegram)" 0
ask TG_BOT_TOKEN "Токен Telegram-бота @BelkovSMM_bot (нужен для входа в пульт из Telegram)" 1
ask YOOKASSA_SHOP_ID "ЮKassa shopId" 0
ask YOOKASSA_SECRET_KEY "ЮKassa секретный ключ" 1
[ -s "$TMP" ] || { echo "Ничего не введено."; exit 0; }

ssh -i "$KEY" -o BatchMode=yes "$HOST" 'sudo python3 -c "
import sys,re
p=\"/srv/studio/secrets/.env\"; s=open(p).read()
import json,ssl,urllib.request
def check_max(tok):
    ca=re.search(r\"(?m)^MAX_CA_BUNDLE=(.*)$\",s)
    ctx=ssl.create_default_context(cafile=ca.group(1).strip()) if ca else None
    try:
        d=json.loads(urllib.request.urlopen(urllib.request.Request(\"https://platform-api2.max.ru/me\",headers={\"Authorization\":tok}),timeout=20,context=ctx).read())
    except Exception as e:
        sys.exit(\"MAX не принял токен: \"+str(e)[:80])
    if d.get(\"username\")!=\"se14910384_1_bot\":
        sys.exit(\"НЕ ТОТ БОТ: это токен бота \"+str(d.get(\"username\"))+\", нужен se14910384_1_bot (Студия SMM). Ничего не записано.\")
for line in sys.stdin.read().splitlines():
    k,v=line.split(\"=\",1)
    if k==\"MAX_BOT_TOKEN\": check_max(v)
    s=re.sub(r\"(?m)^\"+re.escape(k)+r\"=.*$\",lambda m:k+\"=\"+v,s) if re.search(r\"(?m)^\"+re.escape(k)+\"=\",s) else s+k+\"=\"+v+\"\n\"
open(p,\"w\").write(s)
" && sudo systemctl restart studio-api && sleep 2 && curl -fsS http://127.0.0.1:3001/api/health >/dev/null && echo "Сохранено, пульт перезапущен."' < "$TMP"
