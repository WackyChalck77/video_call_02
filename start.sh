#!/usr/bin/env bash
# start.sh — запускать при каждой смене сети:
#   ./start.sh                    # автоопределение IP
#   ./start.sh -i 10.0.100.77     # явный IP
#   ./start.sh --ip 10.0.100.77   # длинный флаг
#
# Скрипт:
# 1) Определяет IP (флаг > автоопределение).
# 2) Генерирует сертификат mkcert, если его нет.
# 3) Обновляет sfu.toml: nat1to1 → текущий IP.
# 4) Перезапускает ion-sfu, если sfu.toml изменился.
# 5) Запускает Caddy.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

CERT_DIR="certs"
SFU_TOML="sfu.toml"

# ---------- Аргументы ----------

MY_IP=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        -i|--ip) MY_IP="$2"; shift 2 ;;
        --ip=*)  MY_IP="${1#*=}"; shift ;;
        *)       shift ;;
    esac
done

# ---------- Автоопределение ----------

if [[ -z "$MY_IP" ]]; then
    MY_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7}' | head -1)"
    if [[ -z "$MY_IP" ]]; then
        echo "❌ Не удалось определить IP-адрес."
        echo "   Укажите явно: $0 -i <IP>"
        exit 1
    fi
    echo "🔍 Автоопределение: IP = $MY_IP"
else
    echo "📌 IP задан явно: $MY_IP"
fi

# ---------- Сертификат ----------

CERT="$CERT_DIR/$MY_IP.pem"
CERT_KEY="$CERT_DIR/$MY_IP-key.pem"

if [[ ! -f "$CERT" || ! -f "$CERT_KEY" ]]; then
    echo "📜 Генерация сертификата mkcert для $MY_IP..."
    # mkcert: root CA уже установлен (`mkcert -install`),
    # сертификаты подписываются локально доверенным CA.
    mkdir -p "$CERT_DIR"
    mkcert -cert-file "$CERT" -key-file "$CERT_KEY" "$MY_IP"
    echo "   ✅ $CERT, $CERT_KEY"
else
    echo "📜 Сертификат уже есть: $CERT"
fi

export MY_IP
export CERT_DIR="$SCRIPT_DIR/$CERT_DIR"

# ---------- sfu.toml ----------

# ion-sfu читает nat1to1 при старте. Проверяем, совпадает ли IP в конфиге.
# Файл примонтирован в контейнер (bind, rw), поэтому достаточно правки на хосте
# и docker restart.
SFU_CHANGED=0
if ! grep -q "nat1to1 = \[\"$MY_IP\"\]" "$SFU_TOML"; then
    echo "🔄 Обновляю sfu.toml: nat1to1 → $MY_IP"
    sed -i "s|nat1to1 = \[.*\]|nat1to1 = [\"$MY_IP\"]|" "$SFU_TOML"
    SFU_CHANGED=1
else
    echo "📋 sfu.toml: nat1to1 уже $MY_IP"
fi

if [[ "$SFU_CHANGED" == 1 ]]; then
    if docker ps --format '{{.Names}}' | grep -qx 'ion-sfu'; then
        echo "   Перезапускаю контейнер ion-sfu..."
        docker restart ion-sfu >/dev/null && echo "   ✅ ion-sfu перезапущен"
    else
        echo "   ⚠️  Контейнер ion-sfu не запущен — применится при следующем старте."
    fi
fi

# ---------- Caddy ----------

echo ""
echo "✅ Запуск: caddy run --config Caddyfile"
echo "   URL: https://$MY_IP:8443"
echo ""

caddy run --config Caddyfile
