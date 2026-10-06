#!/usr/bin/env bash
#
# Запуск видео-звонка в текущей сети.
#
#   ./start.sh 192.168.50.154          запуск с указанием своего адреса
#   ./start.sh 10.0.100.77 --no-run    только подготовить конфиги
#   ./start.sh --stop                  остановить Caddy, запущенный этим скриптом
#
# IP не определяется автоматически: вы приходите в известную сеть и знаете
# свой адрес, поэтому он передан явно. Он нужен ровно в двух местах — оба
# обновляет этот скрипт:
#
#   1. SAN сертификата (certs/tls.pem)  — иначе браузер отклонит wss://
#   2. nat1to1 в sfu.toml               — иначе ICE не сойдётся: SFU будет
#      advertise адрес из другой сети
#
# Caddyfile не меняется: в нём только порт :8443.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

CERT="certs/tls.pem"
CERT_KEY="certs/tls-key.pem"
SFU_TOML="sfu.toml"
SFU_CONTAINER="ion-sfu"
PORT=8443
ADMIN="127.0.0.1:2020"   # не 2019: он занят системным caddy.service

# ---------- остановка ----------

if [[ "${1:-}" == "--stop" ]]; then
    caddy stop --address "$ADMIN" 2>/dev/null || echo "Наш Caddy не запущен."
    exit 0
fi

MY_IP="${1:-}"
[[ "${2:-}" == "--no-run" ]] && RUN=0 || RUN=1

if [[ ! "$MY_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
    echo "Нужен IPv4-адрес этого компьютера в текущей сети."
    echo "Узнать:  ip -4 -o addr show scope global"
    echo "Запуск:  ./start.sh <IP>      (например ./start.sh 192.168.50.154)"
    exit 1
fi

echo "IP: $MY_IP"

# ---------- сертификат ----------

if [[ ! -f "$(mkcert -CAROOT)/rootCA.pem" ]]; then
    echo "Локальный CA не установлен. Выполните: mkcert -install"
    exit 1
fi

mkdir -p certs

# Перевыпускаем только если в SAN нет нужного адреса — иначе повторный запуск
# в той же сети ничего не трогает.
if [[ -f "$CERT" ]] \
   && openssl x509 -in "$CERT" -noout -ext subjectAltName 2>/dev/null \
        | grep -qE "IP Address:$MY_IP(,|$)"; then
    echo "Сертификат подходит (в SAN есть $MY_IP): $CERT"
else
    echo "Выпускаю сертификат на $MY_IP, 127.0.0.1, localhost, $(hostname)"
    mkcert -cert-file "$CERT" -key-file "$CERT_KEY" \
        "$MY_IP" 127.0.0.1 localhost "$(hostname)" >/dev/null
fi

# ---------- SFU ----------

if grep -q "nat1to1 = \[\"$MY_IP\"\]" "$SFU_TOML"; then
    echo "sfu.toml: nat1to1 уже $MY_IP"
else
    sed -i "s|nat1to1 = \[.*\]|nat1to1 = [\"$MY_IP\"]|" "$SFU_TOML"
    echo "sfu.toml: nat1to1 → $MY_IP"
    if docker ps --format '{{.Names}}' | grep -qx "$SFU_CONTAINER"; then
        docker restart "$SFU_CONTAINER" >/dev/null && echo "Контейнер $SFU_CONTAINER перезапущен"
    elif docker ps -a --format '{{.Names}}' | grep -qx "$SFU_CONTAINER"; then
        docker start "$SFU_CONTAINER" >/dev/null && echo "Контейнер $SFU_CONTAINER запущен"
    else
        echo "ВНИМАНИЕ: контейнера $SFU_CONTAINER нет. Создать:"
        echo "  docker run -d --name $SFU_CONTAINER -p 7000:7000 -p 5000-5200:5000-5200/udp \\"
        echo "    -v \"$SCRIPT_DIR/$SFU_TOML:/configs/$SFU_TOML:ro\" \\"
        echo "    pionwebrtc/ion-sfu:latest-jsonrpc -c /configs/$SFU_TOML"
    fi
fi

# ---------- Caddy ----------

export TLS_CRT="$SCRIPT_DIR/$CERT"
export TLS_KEY="$SCRIPT_DIR/$CERT_KEY"

caddy validate --config Caddyfile --adapter caddyfile >/dev/null 2>&1 || {
    echo "Caddyfile не проходит проверку:"
    caddy validate --config Caddyfile --adapter caddyfile 2>&1 | tail -3
    exit 1
}

# Публичный сертификат нашего CA (не ключ) кладём в раздаваемый каталог,
# чтобы второе устройство можно было настроить без консоли.
cp -f "$(mkcert -CAROOT)/rootCA.pem" certs/rootCA.pem

echo
echo "Откройте:            https://$MY_IP:$PORT"
echo "Собеседник в сети:   https://$MY_IP:$PORT"
echo
echo "Чтобы чужое устройство не блокировало wss://, ему нужно доверять нашему CA."
echo "Скачать сертификат CA:  https://$MY_IP:$PORT/certs/rootCA.pem"
echo "(импорт в доверенные корневые; на Android/iOS — установка профиля). "
echo

if [[ "$RUN" == 0 ]]; then
    echo "Конфигурация готова (--no-run). Запуск: ./start.sh $MY_IP"
    exit 0
fi

# Отдельный админ-порт и явный --address: иначе команда управления уйдёт в
# системный caddy.service, а не в наш экземпляр.
if caddy reload --config Caddyfile --adapter caddyfile --address "$ADMIN" >/dev/null 2>&1; then
    echo "Наш Caddy уже работал — перечитали конфиг."
    exit 0
fi

echo "Запускаю Caddy (Ctrl+C — остановить)."
exec caddy run --config Caddyfile --adapter caddyfile
