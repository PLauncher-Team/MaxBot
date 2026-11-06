#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $EUID -ne 0 ]]; then
  exec sudo -E bash "$0" "$@"
fi
for cmd in docker getent; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Не найдено: $cmd"; exit 1; }
done
docker compose version >/dev/null 2>&1 || { echo "Требуется Docker Compose v2"; exit 1; }
read -r -s -p "Токен MAX-бота: " BOT_TOKEN
printf '\n'
[[ -n "$BOT_TOKEN" ]] || { echo "Токен не может быть пустым"; exit 1; }
read -r -p "Домен приложения: " MAXBOT_DOMAIN
MAXBOT_DOMAIN="${MAXBOT_DOMAIN,,}"
[[ "$MAXBOT_DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]] || { echo "Некорректный домен"; exit 1; }
mkdir -p secrets
umask 077
printf '%s' "$BOT_TOKEN" > secrets/bot_token
unset BOT_TOKEN
# The app runs as UID/GID 1000 (the "node" user in the Dockerfile).
# Local Compose secrets are bind-mounted, so host ownership and mode matter.
chown 1000:1000 secrets/bot_token
chmod 400 secrets/bot_token
printf 'MAXBOT_DOMAIN=%s\n' "$MAXBOT_DOMAIN" > .env
chmod 600 .env
IP="$(getent ahostsv4 "$MAXBOT_DOMAIN" | awk 'NR==1 {print $1}')"
[[ -n "$IP" ]] || { echo "Домен не разрешается в IPv4"; exit 1; }
echo "DNS $MAXBOT_DOMAIN -> $IP. Убедитесь, что это IP данной VPS."
read -r -p "Продолжить? [y/N] " CONFIRM
[[ "$CONFIRM" =~ ^[Yy]$ ]] || exit 1
cat > nginx/default.conf <<'CONF'
server {
    listen 80;
    server_name _;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
CONF
docker compose build
docker compose up -d nginx
docker compose run --rm --no-deps certbot certonly --webroot -w /var/www/certbot -d "$MAXBOT_DOMAIN" --agree-tos --register-unsafely-without-email --non-interactive
sed "s/__DOMAIN__/$MAXBOT_DOMAIN/g" nginx/default.conf.template > nginx/default.conf
docker compose build nginx
docker compose up -d --force-recreate app nginx
cat > /etc/systemd/system/maxbot-certbot-renew.service <<UNIT
[Unit]
Description=Renew MAXBot Let's Encrypt certificate

[Service]
Type=oneshot
WorkingDirectory=$PWD
ExecStart=/usr/bin/bash -lc 'docker compose run --rm --no-deps certbot renew --webroot -w /var/www/certbot && docker compose exec -T nginx nginx -s reload'
UNIT
cat > /etc/systemd/system/maxbot-certbot-renew.timer <<'UNIT'
[Unit]
Description=Twice-daily MAXBot certificate renewal check

[Timer]
OnCalendar=*-*-* 03,15:17:00
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now maxbot-certbot-renew.timer
echo "Установка завершена: https://$MAXBOT_DOMAIN"
