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
 */
const SECURE = location.protocol === 'https:';
export const SIGNAL_URL = (SECURE ? 'wss://' : 'ws://') + location.hostname +
    ':' + (SECURE ? '8443' : '7000') + '/ws';

// WebSocket в конструкторе сигнала создаётся сразу, но открывается асинхронно.
export const SIGNAL_OPEN_TIMEOUT_MS = 8000;

// join() резолвится только после служебного data-channel "ion-sfu" от SFU.
export const JOIN_TIMEOUT_MS = 6000;

export const STATS_INTERVAL_MS = 1000;
export const STALE_CHECK_INTERVAL_MS = 2000;

// Все дорожки потока заглушены дольше этого срока — считаем участника ушедшим.
export const STALE_MS = 5000;
