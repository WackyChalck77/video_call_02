/*
 * Настройки комнаты. Всё, что имеет смысл менять под конкретный запуск,
 * живёт здесь — остальные модули только читают.
 */

export const ROOM_ID = 'demo-room';

/*
 * Ограничения на захват. width/height/frameRate заданы через ideal, а не exact:
 * при exact браузер вернет OverconstrainedError, если камера не отдаёт ровно
 * такое разрешение (например, при --use-fake-device-for-media-stream).
 */
export const QUALITY_PRESETS = {
    low:    { width: { ideal: 320 },  height: { ideal: 240 },  frameRate: { ideal: 10, max: 30 } },
    medium: { width: { ideal: 640 },  height: { ideal: 480 },  frameRate: { ideal: 20, max: 30 } },
    high:   { width: { ideal: 1280 }, height: { ideal: 720 },  frameRate: { ideal: 30, max: 60 } }
};

/*
 * Адрес сигнализации. По HTTPS идём через TLS-фронт Caddy (wss :8443/ws),
 * который проксирует на SFU. По http — напрямую в SFU (ws :7000/ws):
 * http://localhost браузер считает защищённым контекстом, поэтому getUserMedia
 * разрешён и фронт не нужен. Это же удобно для отладки без сертификата.
 * 
 * Примечание: iOS Safari требует HTTPS для getUserMedia и WebSocket.
 * Redirect на HTTPS происходит в index.html до загрузки модулей.
 */
const SECURE = location.protocol === 'https:';
export const SIGNAL_URL = (SECURE ? 'wss://' : 'ws://') + location.hostname +
    ':' + (SECURE ? '8443' : '7000') + '/ws';

// WebSocket в конструкторе сигнала создаётся сразу, но открывается асинхронно.
// iOS Safari медленнее открывает WebSocket — увеличиваем таймаут.
export const SIGNAL_OPEN_TIMEOUT_MS = 30000;

// join() резолвится только после служебного data-channel "ion-sfu" от SFU.
// iOS Safari может быть медленнее — увеличиваем таймаут.
export const JOIN_TIMEOUT_MS = 20000;

export const STATS_INTERVAL_MS = 1000;
export const STALE_CHECK_INTERVAL_MS = 2000;

// Все дорожки потока заглушены дольше этого срока — считаем участника ушедшим.
export const STALE_MS = 5000;

/* ---------- RTT между участниками (peerlink.js) ---------- */

/*
 * Метка data channel. Каждый участник создаёт канал "link:<свой uid>",
 * SFU фабустит его остальным участникам сессии, а ответы маршрутизует
 * обратно создателю. Поэтому на участника хватает одного канала.
 */
export const LINK_LABEL_PREFIX = 'link:';

// Как часто слать ping. Значение = путь туда-обратно по SCTP через SFU.
export const PING_INTERVAL_MS = 2000;

// Нет ответа дольше этого срока — замер считается неактуальным.
export const PEER_RTT_STALE_MS = 6000;

// Сколько последних замеров усреднять для avg/min.
export const PEER_RTT_WINDOW = 10;
