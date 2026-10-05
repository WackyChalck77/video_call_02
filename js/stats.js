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

/* ---------- Вспомогательные ---------- */

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
 * Найти нужный RTCPeerConnection.
 * pub  — тот, у кого есть senders; sub — тот, у кого есть receivers, но нет
 * senders, иначе на pub-пире можно увидеть его же пустые receivers.
 */
function findPc(kind) {
    for (const t of transports()) {
        const pc = t && t.pc;
        if (!pc) continue;
        const senders = pc.getSenders().length > 0;
        const receivers = pc.getReceivers().length > 0;
        if (kind === 'pub' && senders) return pc;
        if (kind === 'sub' && receivers && !senders) return pc;
    }
    return null;
}

// RTT из успешной пары кандидатов (есть в отчёте обоих пиров).
function readRtt(report) {
    let rtt = null;
    report.forEach((s) => {
        if (s.type === 'candidate-pair' && s.state === 'succeeded' &&
            s.currentRoundTripTime !== undefined)
            rtt = s.currentRoundTripTime * 1000;
    });
    return rtt;
}

const LIMITATION_LABELS = { none: 'нет', cpu: 'CPU', bandwidth: 'канал', other: 'иное' };

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
            if (s.type !== 'outbound-rtp' || !ourIds.has(s.trackIdentifier)) return;
            if (s.kind === 'video' && !video) video = s;
            if (s.kind === 'audio' && !audio) audio = s;
        });

        const now = performance.now();
        const prev = prevStats.get('stats_local') || {};
        const dt = prev.timestamp ? (now - prev.timestamp) / 1000 : 0;
        const rtt = readRtt(report);

        let res = '—', fps = '—', sent = '—', limit = '—', nack = '—';
        if (video) {
            if (video.frameWidth && video.frameHeight) res = video.frameWidth + '×' + video.frameHeight;
            if (video.framesPerSecond !== undefined) fps = Math.round(video.framesPerSecond);
            sent = bitrateOf(video.bytesSent - prev.videoBytes, dt, 'Mbps');
            limit = LIMITATION_LABELS[video.qualityLimitationReason] || '—';
            if (video.nackCount !== undefined) nack = video.nackCount;
        }
        const sentAudio = audio ? bitrateOf(audio.bytesSent - prev.audioBytes, dt, 'kbps') : '—';

        prevStats.set('stats_local', {
            timestamp: now,
            videoBytes: video ? video.bytesSent : prev.videoBytes,
            audioBytes: audio ? audio.bytesSent : prev.audioBytes
        });

        renderStats('local', [
            ['RTT', rtt ? rtt.toFixed(0) + ' мс' : '—'],
            ['Отправлено', sent],
            ['Разрешение', res],
            ['FPS', fps],
            ['Упирается в', limit],
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
            if (video.frameWidth && video.frameHeight) res = video.frameWidth + '×' + video.frameHeight;
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

        renderStats(key, [
            ['RTT', rtt ? rtt.toFixed(0) + ' мс' : '—'],
            ['Получено', received],
            ['Разрешение', res],
            ['FPS', fps],
            ['Дрожание', jitter],
            ['Аудио', receivedAudio],
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
        collectLocalStats();
        remoteStreams.forEach((rec, key) => collectRemoteStats(key));
    }, STATS_INTERVAL_MS);
}
