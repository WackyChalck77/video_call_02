# video_call_02

Видео-конференция на [ion-sfu](https://github.com/pion/ion-sfu): браузеры обмениваются
медиа через SFU, сигнализация — JSON-RPC по WebSocket, TLS и раздача статики — Caddy.

## Состав

| Файл | Назначение |
| --- | --- |
| `index.html` | Клиент: захват камеры/микрофона, вход в комнату, плитки видео, таблица статистики |
| `libs/` | UMD-сборки `ion-sdk` и `json-rpc` — подключаются как обычные скрипты |
| `sfu.toml` | Конфиг SFU (из `node_modules/ion-sdk-js`) |
| `Caddyfile` | TLS на `:8443`, раздача статики, `/ws` → `localhost:7000` |

## Запуск

Самоподписанный сертификат кладётся в `certs/` (в git не попадает):

docker restart ion-sfu

```bash
docker run -d --name ion-sfu --network host \
  -v "$PWD/sfu.toml":/configs/sfu.toml:ro \
  -p 5000-5200:5000-5200/udp \
  pionwebrtc/ion-sfu:latest-jsonrpc

caddy run    # в этой же директории, подхватит Caddyfile
```

Открыть `https://<хост>:8443/` и нажать «Присоединиться».

## Конфигурация SFU

`[router].maxpackettrack` обязателен: без него SFU выделяет пул буферов размером
0 байт и падает с `panic: index out of range` на первой же видеодорожке.
Диапазон `portrange` из `[webrtc]` должен быть проброшен в контейнер, а `nat1to1`
указывать на адрес, доступный браузерам.

## Зависимости

```bash
npm install
```

`node_modules/` в репозиторий не попадает — клиент берёт SDK из `libs/`.
