/*
 * Сбор статистики WebRTC.
 *
 * В SDK два RTCPeerConnection: публикующий (мы отправляем) и подписной
 * (мы получаем). Поэтому входящая и исходящая статистика берутся из разных
 * транспортов и считаются по-разному: inbound-rtp vs outbound-rtp.
 */

import { STATS_INTERVAL_MS } from './config.js';
import { state, remoteStreams, prevStats } from './state.js';
import { renderStats } from './ui.js';
import { peerRttFor, bestPeerRtt, setOwnSfuRtt, prunePeers } from './peerlink.js';

/* ---------- Вспомогательные ---------- */

// Формат задержки: текущий замер плюс разброс по окну сглаживания.
function fmtMs(value) {
    return (typeof value === 'number' && isFinite(value)) ? value.toFixed(0) + ' мс' : '—';
}

function fmtPeerRtt(entry) {
    if (!entry) return '—';
    return fmtMs(entry.rtt) + ' (min ' + entry.min.toFixed(0) +
        ', avg ' + entry.avg.toFixed(0) + ')';
}

// Битрейт по дельте байт между двумя замерами.
function bitrateOf(deltaBytes, dtSec, unit) {
    if (!dtSec || dtSec <= 0 || deltaBytes === undefined || isNaN(deltaBytes)) return '—';
    const bps = (deltaBytes * 8) / dtSec;
    if (unit === 'Mbps') return (bps / 1e6).toFixed(2) + ' Mbps';
    if (unit === 'kbps') return (bps / 1e3).toFixed(0) + ' kbps';
    return bps.toFixed(0) + ' bps';
}

// Транспорты SDK как массив RTCPeerConnection.
function transports() {
    const tr = state.client && state.client.transports;
    if (!tr) return [];
    return tr instanceof Map ? [...tr.values()] : Object.values(tr);
}

/**
 * Найти RTCPeerConnection по trackIdentifier'ам sender'ов.
 * pub  — тот, у кого есть senders с нашими track id (мы публикуем).
 * sub  — тот, у кого нет наших track id в senders (мы подписываемся).
 */
function findPc(kind) {
    if (!state.localStream) return null;
    const ourIds = new Set(state.localStream.getTracks().map((t) => t.id));
    for (const t of transports()) {
        const pc = t && t.pc;
        if (!pc) continue;
        const senders = pc.getSenders();
        const hasOurTracks = senders.some((s) => {
            const media = s && s.track;
            return media && ourIds.has(media.id);
        });
        if (kind === 'pub' && hasOurTracks) return pc;
        if (kind === 'sub' && !hasOurTracks && pc.getReceivers().length > 0) return pc;
    }
    return null;
}

// RTT из активной пары кандидатов (in-use — выбранная, succeeded — прошедшая ICE).
function readRtt(report) {
    let rtt = null;
    report.forEach((s) => {
        if (s.type === 'candidate-pair' &&
            (s.state === 'in-use' || s.state === 'succeeded') &&
            s.currentRoundTripTime !== undefined) {
            const ms = s.currentRoundTripTime * 1000;
            if (ms > 0 && (!rtt || ms < rtt)) rtt = ms;
        }
    });
    return rtt;
}

/* ---------- Исходящая статистика (наш pub-пир) ---------- */

/**
 * Собрать outbound-rtp для наших видео/аудио с pub-пира.
 * Вызывается для ключа 'local'.
 */
export async function collectLocalStats() {
    if (!state.client || !state.localStream) return;
    const pc = findPc('pub');
    if (!pc) return;

    // Фильтр по trackIdentifier: на pub-пире могут быть и чужие sender'ы
    // (например, после replaceTrack), берём только свои дорожки.
    const ourIds = new Set(state.localStream.getTracks().map((t) => t.id));

    try {
        const report = await pc.getStats();

        let video = null, audio = null;
        report.forEach((s) => {
            if (s.type !== 'outbound-rtp') return;
            if (s.trackIdentifier && ourIds.has(s.trackIdentifier)) {
                if (s.kind === 'video' && !video) video = s;
                if (s.kind === 'audio' && !audio) audio = s;
            }
        });
        
        // Если не нашли по trackIdentifier, ищем по первому video/audio
        if (!video) {
            report.forEach((s) => {
                if (s.type === 'outbound-rtp' && s.kind === 'video' && !video) video = s;
            });
        }

        const now = performance.now();
        const prev = prevStats.get('stats_local') || {};
        const dt = prev.timestamp ? (now - prev.timestamp) / 1000 : 0;
        const rtt = readRtt(report);

        // Наш RTT до SFU уезжает собеседникам в ping: на их плитках он
        // показывает качество их же канала, а не нашего.
        setOwnSfuRtt(rtt);

        let res = '—', fps = '—', sent = '—', jitter = '—', nack = '—';
        if (video) {
            let w = video.frameWidth;
            let h = video.frameHeight;
            // Если ширина меньше высоты — поменяем местами (поворот 90°)
            if (w && h && w < h) {
                [w, h] = [h, w];
            }
            if (w && h) res = w + '×' + h;
            if (video.framesPerSecond !== undefined) fps = Math.round(video.framesPerSecond);
            sent = bitrateOf(video.bytesSent - prev.videoBytes, dt, 'Mbps');
            if (video.jitter !== undefined) jitter = (video.jitter * 1000).toFixed(1) + ' мс';
            if (video.nackCount !== undefined) nack = video.nackCount;
        }
        if (jitter === '—' && audio && audio.jitter !== undefined)
            jitter = (audio.jitter * 1000).toFixed(1) + ' мс';
        const sentAudio = audio ? bitrateOf(audio.bytesSent - prev.audioBytes, dt, 'kbps') : '—';

        prevStats.set('stats_local', {
            timestamp: now,
            videoBytes: video && video.bytesSent !== undefined ? video.bytesSent : prev.videoBytes,
            audioBytes: audio && audio.bytesSent !== undefined ? audio.bytesSent : prev.audioBytes
        });

        renderStats('local', [
            ['RTT до SFU', rtt ? rtt.toFixed(0) + ' мс' : '—'],
            ['RTT до пира', fmtMs(bestPeerRtt())],
            ['Битрейт Tx', sent],
            ['Разрешение', res],
            ['Джиттер', jitter],
            ['FPS', fps],
            ['Аудио', sentAudio],
            ['Запросов повтора', nack]
        ]);
    } catch (err) {
        console.warn('Ошибка локальной статистики:', err);
    }
}

/* ---------- Входящая статистика (sub-пир) ---------- */

/**
 * key — ключ потока в remoteStreams (он же id элемента статистики).
 */
export async function collectRemoteStats(key) {
    if (!state.client) return;
    const rec = remoteStreams.get(key);
    if (!rec) return;
    const pc = findPc('sub');
    if (!pc) return;

    // На 2+ участниках в отчёте лежат дорожки всех — фильтруем по своим.
    const trackIds = new Set(Array.from(rec.tracks).map((t) => t.id));
    const mine = (s) => trackIds.size === 0 || trackIds.has(s.trackIdentifier);

    try {
        const report = await pc.getStats();
        
        // Собираем inbound-rtp
        const inbound = [];
        report.forEach((s) => {
            if (s.type === 'inbound-rtp') inbound.push({ kind: s.kind, trackId: s.trackIdentifier });
        });

        let video = null, audio = null;
        report.forEach((s) => {
            if (s.type !== 'inbound-rtp' || !mine(s)) return;
            if (s.kind === 'video' && !video) video = s;
            if (s.kind === 'audio' && !audio) audio = s;
        });

        const now = performance.now();
        const prev = prevStats.get('stats_' + key) || {};
        const dt = prev.timestamp ? (now - prev.timestamp) / 1000 : 0;
        const rtt = readRtt(report);

        let res = '—', fps = '—', jitter = '—';
        if (video) {
            let w = video.frameWidth;
            let h = video.frameHeight;
            // Если ширина меньше высоты — поменяем местами (поворот 90°)
            if (w && h && w < h) {
                [w, h] = [h, w];
            }
            if (w && h) res = w + '×' + h;
            if (video.framesPerSecond !== undefined) fps = Math.round(video.framesPerSecond);
            else if (prev.videoFrames !== undefined && dt > 0)
                fps = Math.round((video.framesDecoded - prev.videoFrames) / dt);
            if (video.jitter !== undefined) jitter = (video.jitter * 1000).toFixed(1) + ' мс';
        }
        if (jitter === '—' && audio && audio.jitter !== undefined)
            jitter = (audio.jitter * 1000).toFixed(1) + ' мс';

        const received = video ? bitrateOf(video.bytesReceived - prev.videoBytes, dt, 'Mbps') : '—';
        const receivedAudio = audio ? bitrateOf(audio.bytesReceived - prev.audioBytes, dt, 'kbps') : '—';
        const lost = video && video.packetsLost !== undefined ? video.packetsLost :
                     (audio && audio.packetsLost !== undefined ? audio.packetsLost : '—');

        prevStats.set('stats_' + key, {
            timestamp: now,
            videoBytes: video ? video.bytesReceived : prev.videoBytes,
            videoFrames: video ? video.framesDecoded : prev.videoFrames,
            audioBytes: audio ? audio.bytesReceived : prev.audioBytes
        });

        // Замер «до пира» приходит из peerlink: это ping/pong по data channel,
        // то есть путь через весь SFU, а не только наша ветка до сервера.
        const link = peerRttFor(key, remoteStreams.size);

        renderStats(key, [
            ['RTT до SFU', rtt ? rtt.toFixed(0) + ' мс' : '—'],
            ['RTT до пира', fmtPeerRtt(link)],
            ['RTT пира до SFU', link ? fmtMs(link.sfuRtt) : '—'],
            ['Битрейт Rx', received],
            ['Разрешение', res],
            ['FPS (кадров/с)', fps],
            ['Джиттер', jitter],
            ['Аудио битрейт', receivedAudio],
            ['Потери пакетов', lost]
        ]);
    } catch (err) {
        console.warn('Ошибка статистики для', key, err);
    }
}

/* ---------- Планировщик ---------- */

export function startStatsLoop() {
    setInterval(() => {
        if (!state.client) return;
        prunePeers();
        collectLocalStats();
        remoteStreams.forEach((rec, key) => collectRemoteStats(key));
    }, STATS_INTERVAL_MS);
}
