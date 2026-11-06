#!/usr/bin/env bash
# Развёртывание пульта студии на сервере. Запуск: sudo bash deploy.sh <каталог с файлами>
# Идемпотентен. Секреты не создаёт вслепую: токены и ID владельца вносит владелец в /srv/studio/secrets/.env.
set -euo pipefail
SRC="${1:-/tmp/studio-api}"

apt-get -qq install -y python3-aiohttp python3-asyncpg >/dev/null

id studio &>/dev/null || adduser --system --group --no-create-home --home /srv/studio studio
install -d -m 755 -o root -g root /srv/studio/api
install -d -m 750 -o studio -g studio /srv/studio/logs
install -d -m 750 -o root -g studio /srv/studio/secrets
install -m 644 -o root -g root "$SRC/app.py" "$SRC/schema.sql" "$SRC/yookassa.py" /srv/studio/api/

# База и роль (пароль генерируется на сервере, в консоль не выводится)
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='studio_api'" | grep -q 1; then
  PW=$(openssl rand -hex 24)
  sudo -u postgres psql -qc "CREATE ROLE studio_api LOGIN PASSWORD '$PW'"
  sudo -u postgres createdb -O studio_api studio
  umask 077; echo "DATABASE_URL=postgresql://studio_api:$PW@127.0.0.1:5432/studio" > /srv/studio/secrets/db.env
fi
chown root:studio /srv/studio/secrets/db.env; chmod 640 /srv/studio/secrets/db.env

# Шаблон настроек: создаётся один раз, дальше правит владелец
if [ ! -f /srv/studio/secrets/.env ]; then
  cat > /srv/studio/secrets/.env <<'EOF'
# Пульт студии. Заполняет владелец. Не копировать в репозиторий и чат.
TG_BOT_TOKEN=
MAX_BOT_TOKEN=
OWNER_TG_ID=
OWNER_MAX_ID=
TG_CHANNEL_ID=@belkovstudio
MAX_CHANNEL_CHAT_ID=
MAX_CA_BUNDLE=/srv/studio/secrets/russian_ca.pem
# 1 = принимать заявки на сервер (только после уведомления РКН и обновления политики)
LEADS_ENABLED=0
EOF
fi
# Ключи, добавленные в новых версиях, дописываются пустыми (существующие значения не трогаются)
for k in YOOKASSA_SHOP_ID YOOKASSA_SECRET_KEY TG_API_ENABLED; do
  grep -q "^$k=" /srv/studio/secrets/.env || echo "$k=" >> /srv/studio/secrets/.env
done
chown root:studio /srv/studio/secrets/.env; chmod 640 /srv/studio/secrets/.env
[ -f /srv/studio/secrets/russian_ca.pem ] || { [ -f /srv/music/secrets/russian_ca.pem ] && install -m 644 /srv/music/secrets/russian_ca.pem /srv/studio/secrets/russian_ca.pem || true; }

install -m 644 "$SRC/studio-api.service" /etc/systemd/system/studio-api.service
systemctl daemon-reload
systemctl enable --now studio-api >/dev/null
systemctl restart studio-api
sleep 2
curl -fsS http://127.0.0.1:3001/api/health && echo " studio-api OK"
