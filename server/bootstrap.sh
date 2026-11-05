#!/usr/bin/env bash
# Первичная настройка сервера FirstVDS (Ubuntu 24.04) для двух приложений: студия и музыка.
# Запуск от root: bash bootstrap.sh <домен> <email-для-сертификатов>
# Идемпотентен: можно запускать повторно. Секреты не содержит.
set -euo pipefail

DOMAIN="${1:?домен, например aiservicesrus.ru}"
EMAIL="${2:?e-mail для сертификатов}"
DEPLOY_USER="deploy"
PUBKEY_FILE="${3:-/root/.ssh/authorized_keys}"   # ключ берём тот же, что у root

export DEBIAN_FRONTEND=noninteractive

echo "== 1. Обновления и пакеты"
apt-get update -y
apt-get -y upgrade
apt-get -y install postgresql docker.io ufw fail2ban unattended-upgrades nginx certbot python3-certbot-nginx \
  curl git sqlite3 rsync age jq ca-certificates gnupg logrotate

echo "== 2. Пользователь $DEPLOY_USER (без пароля, ключ SSH)"
id "$DEPLOY_USER" &>/dev/null || adduser --disabled-password --gecos "" "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
cp "$PUBKEY_FILE" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-deploy
chmod 440 /etc/sudoers.d/90-deploy

echo "== 3. SSH: только ключи, root только по ключу"
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'EOS'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 3
X11Forwarding no
EOS
sshd -t && systemctl reload ssh

echo "== 4. Файрвол: 22, 80, 443"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "== 5. fail2ban и автообновления безопасности"
cat > /etc/fail2ban/jail.d/sshd.local <<'EOS'
[sshd]
enabled = true
maxretry = 4
bantime = 1h
EOS
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== 6. Node.js 22 LTS"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get -y install nodejs
fi

echo "== 6b. Swap 2 ГБ"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
fi

echo "== 6c. Пользователь music (отдельный ключ, группа docker) и PostgreSQL"
id music &>/dev/null || adduser --disabled-password --gecos "" music
usermod -aG docker music
install -d -m 700 -o music -g music /home/music/.ssh
cp "$(dirname "$0")/keys/music.pub" /home/music/.ssh/authorized_keys
chown music:music /home/music/.ssh/authorized_keys && chmod 600 /home/music/.ssh/authorized_keys
systemctl enable --now postgresql docker
# роль и база music_bot; пароль генерируется на сервере и пишется в secrets/db.env (владелец music), в консоль не выводится
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='music_bot'" | grep -q 1; then
  PW=$(openssl rand -hex 24)
  sudo -u postgres psql -c "CREATE ROLE music_bot LOGIN PASSWORD '$PW'"
  sudo -u postgres createdb -O music_bot music_bot
  install -d -m 700 -o music -g music /srv/music/secrets
  umask 077; echo "DATABASE_URL=postgresql://music_bot:$PW@127.0.0.1:5432/music_bot" > /srv/music/secrets/db.env
  chown music:music /srv/music/secrets/db.env
fi

echo "== 7. Каталоги приложений (раздельные, права только у владельца)"
for app in studio music; do
  install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/srv/$app" "/srv/$app/app" "/srv/$app/data" "/srv/$app/logs"
  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/srv/$app/secrets"   # .env с токенами: заполняет владелец
done

echo "== 8. Nginx: заглушки, затем HTTPS"
for app in studio music; do
  SUB="$app.$DOMAIN"
  cat > "/etc/nginx/sites-available/$SUB" <<EOS
server {
    listen 80;
    server_name $SUB;
    root /srv/$app/app/public;
    index index.html;
    location / { try_files \$uri \$uri/ =404; }
    location /api/ { proxy_pass http://127.0.0.1:$( [ "$app" = studio ] && echo 3001 || echo 3002 ); proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr; }
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
}
EOS
  ln -sf "/etc/nginx/sites-available/$SUB" "/etc/nginx/sites-enabled/$SUB"
  [ -f "/srv/$app/app/public/index.html" ] || { install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/srv/$app/app/public"; echo "<h1>$SUB</h1>" > "/srv/$app/app/public/index.html"; chown "$DEPLOY_USER:$DEPLOY_USER" "/srv/$app/app/public/index.html"; }
done
rm -f /etc/nginx/sites-enabled/default
sed -i 's/# server_tokens off;/server_tokens off;/' /etc/nginx/nginx.conf
nginx -t && systemctl reload nginx

echo "== 9. HTTPS (нужны A-записи studio.$DOMAIN и music.$DOMAIN на этот сервер)"
certbot --nginx --non-interactive --agree-tos -m "$EMAIL" --redirect \
  -d "studio.$DOMAIN" -d "music.$DOMAIN" || echo "!! Сертификат не выпущен: проверьте DNS, затем повторите bootstrap"

echo "== 10. Резервные копии: ежедневно, шифрование age, хранение 14 дней"
install -d -m 700 /var/backups/apps
cat > /usr/local/bin/apps-backup.sh <<'EOS'
#!/usr/bin/env bash
set -euo pipefail
RCPT_FILE=/root/.backup-age-recipient       # публичный ключ age; приватный хранит владелец вне сервера
[ -s "$RCPT_FILE" ] || { echo "нет $RCPT_FILE"; exit 1; }
STAMP=$(date +%F)
for app in studio music; do
  tar -C /srv/$app -czf - data | age -R "$RCPT_FILE" > /var/backups/apps/$app-$STAMP.tar.gz.age
done
find /var/backups/apps -name '*.age' -mtime +14 -delete
EOS
chmod 750 /usr/local/bin/apps-backup.sh
echo '17 3 * * * root /usr/local/bin/apps-backup.sh >> /var/log/apps-backup.log 2>&1' > /etc/cron.d/apps-backup

echo "== 11. Журналы: хранение 6 месяцев"
cat > /etc/logrotate.d/apps <<'EOS'
/srv/*/logs/*.log {
    monthly
    rotate 6
    compress
    missingok
    notifempty
}
EOS

echo "== Готово. Проверка:"
ufw status | head -5; systemctl is-active nginx fail2ban; node -v
