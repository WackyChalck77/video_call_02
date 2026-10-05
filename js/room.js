/*
 * room.js — управление комнатой: join, leave, ontrack, watchPeer,
 * сторож stale (автоматическое удаление фреймов ушедших пира).
 */

import {
    ROOM_ID, SIGNAL_URL, SIGNAL_OPEN_TIMEOUT_MS, JOIN_TIMEOUT_MS,
    STALE_CHECK_INTERVAL_MS, STALE_MS
} from './config.js';
import { state, remoteStreams } from './state.js';
import { acquireLocalStream } from './media.js';
import { setStatus, setConnectedUi, ensureTile, removeTile, playWithSound, setCaption } from './ui.js';

/* ---------- Сигнализация ---------- */

/**
 * Дождаться открытия WebSocket в сигнале.
 * SDK создаёт WebSocket в конструкторе, но он открывается асинхронно.
 * Любой send() до события open падает с InvalidStateError.
 */
export function waitSignalOpen(signal, timeoutMs) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error('Сигнал не открылся за ' + timeoutMs + ' мс'));
        }, timeoutMs || SIGNAL_OPEN_TIMEOUT_MS);

        signal.onopen = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            console.log('Signaling connected');
            resolve();
        };
        signal.onerror = (e) => {
            console.error('Signaling error:', e);
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(new Error('WebSocket error — проверь адрес ' + SIGNAL_URL + ' и журнал ion-sfu'));
        };
        signal.onclose = (e) => {
            console.log('Signaling closed, code=' + e.code);
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(new Error('WebSocket закрыт до открытия (code ' + e.code + ')'));
        };
    });
}

/* ---------- PeerConnection ---------- */

export function watchPeer(label, pc) {
    if (!pc) return;
    const log = () => {
        console.log('[' + label + '] ice=' + pc.iceConnectionState + ' conn=' + pc.connectionState);
        if (label === 'sub' && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) {
            removeAllRemote('subscriber pc ' + pc.connectionState);
        }
    };
    pc.addEventListener('iceconnectionstatechange', log);
    pc.addEventListener('connectionstatechange', log);
    pc.addEventListener('track', (ev) => console.log('[' + label + '] pc.track event:', ev.track.kind));
}

function errText(err) {
    if (!err) return 'неизвестная ошибка';
    if (typeof err === 'string') return err;
    return err.message || err.reason || JSON.stringify(err);
}

/* ---------- Управление фреймами ---------- */

function removeVideo(key, reason) {
    const rec = remoteStreams.get(key);
    if (rec) {
        rec.tracks.forEach((t) => {
            t.onended = null;
            t.onmute = null;
            t.onunmute = null;
        });
        rec.stream.onaddtrack = null;
        rec.stream.onremovetrack = null;
        remoteStreams.delete(key);
    }
    removeTile(key);
    console.log('Removed video element:', key, '-', reason);
}

function removeAllRemote(reason) {
    Array.from(remoteStreams.keys()).forEach((key) => removeVideo(key, reason));
}

function dropTrack(key, track, reason) {
    const rec = remoteStreams.get(key);
    if (!rec) return;
    rec.tracks.delete(track);
    if (rec.tracks.size === 0) {
        removeVideo(key, reason);
    } else {
        console.log('Track gone:', track.kind, 'from', key, '- осталось', rec.tracks.size, '(' + reason + ')');
    }
}

function watchTrack(key, rec, track) {
    rec.tracks.add(track);
    track.onended = () => dropTrack(key, track, 'track ended');
    track.onmute = () => {
        rec.mutedAt = rec.mutedAt || Date.now();
        console.log('Track muted:', track.kind, key);
    };
    track.onunmute = () => {
        rec.mutedAt = 0;
        console.log('Track unmuted:', track.kind, key);
    };
}

/* ---------- Сторож stale ---------- */

// ion-sfu при уходе пиббера может как пересогласовать sub-пир (тогда дорожка
// удаляется из MediaStream), так и просто перестать слать RTP (тогда только mute).
// Поэтому страхуемся таймером: все дорожки потока заглушены дольше STALE_MS — выкидываем.
import { STALE_CHECK_INTERVAL_MS, STALE_MS } from './config.js';

export function startStaleWatch() {
    setInterval(() => {
        const now = Date.now();
        remoteStreams.forEach((rec, key) => {
            const tracks = Array.from(rec.tracks);
            if (tracks.length === 0) {
                removeVideo(key, 'no tracks left');
                return;
            }
            const allStale = tracks.every((t) => t.muted || t.readyState !== 'live');
            if (!allStale) {
                rec.mutedAt = 0;
                return;
            }
            rec.mutedAt = rec.mutedAt || now;
            if (now - rec.mutedAt >= STALE_MS) {
                removeVideo(key, 'all tracks muted for ' + STALE_MS + 'ms');
            }
        });
    }, STALE_CHECK_INTERVAL_MS);
}

/* ---------- Join ---------- */

/**
 * Войти в комнату. Возвращает Promise.
 * @param {string} quality  - ключ qualityPresets (low/medium/high)
 */
export async function join(quality) {
    const btn = document.getElementById('joinBtn');
    if (btn.disabled) return;
    btn.disabled = true;

    try {
        setStatus('Подключение...');

        // 1) Захват локального потока
        const local = await acquireLocalStream(quality);
        state.localStream = local;

        if (local) {
            const { el } = ensureTile('local', { stats: true });
            setCaption('local', 'Вы', 'var(--local-color, #aaa)');
            el.setAttribute('muted', '');
            el.muted = true;
        }

        // 2) Сигнализация
        const signal = new window.IonSFUJSONRPCSignal(SIGNAL_URL);
        state.signal = signal;
        await waitSignalOpen(signal);

        // 3) Клиент SFU
        const client = new window.Client(signal);
        state.client = client;
        window.__client = client;
        window.__remoteStreams = remoteStreams;

        // 4) Обработка закрытия сокета
        signal.onclose = (e) => {
            console.log('Signaling closed, code=' + e.code);
            removeAllRemote('signaling closed (code ' + e.code + ')');
            if (state.client) {
                setStatus('Соединение с SFU потеряно');
                setConnectedUi(false);
            }
        };

        // 5) Обработка входящих дорожек
        client.ontrack = (track, stream) => {
            console.log('Remote track received:', track.kind, 'stream id:', stream && stream.id);
            const hasStream = !!(stream && stream.id);
            const key = hasStream ? stream.id : 'remote-' + track.id;
            const media = hasStream ? stream : new MediaStream([track]);

            let rec = remoteStreams.get(key);
            if (!rec) {
                rec = { stream: media, tracks: new Set(), mutedAt: 0 };
                remoteStreams.set(key, rec);
                media.onremovetrack = (ev) => {
                    console.log('Stream removetrack:', ev.track.kind, key);
                    dropTrack(key, ev.track, 'stream removetrack');
                };
                media.onaddtrack = (ev) => watchTrack(key, rec, ev.track);
            }
            watchTrack(key, rec, track);

            const { el } = ensureTile(key, { stats: true });
            el.removeAttribute('muted');
            el.muted = false;
            if (el.srcObject !== media) el.srcObject = media;
            playWithSound(el);
        };
        client.onerrnegotiate = (role, err) => {
            console.error('Negotiation error [role=' + role + ']:', err);
        };
        client.ondatachannel = (ev) => console.log('App data channel:', ev.channel.label);

        // 6) join()
        const joinPromise = client.join(ROOM_ID, 'user-' + Math.random().toString(36).slice(2, 8));
        const apiTimeout = new Promise((resolve) => setTimeout(() => resolve('api-wait'), JOIN_TIMEOUT_MS));
        const joinState = await Promise.race([joinPromise.then(() => 'joined'), apiTimeout]);
        console.log('join() state:', joinState);

        // 7) Подписка на события PC
        const transports = client.transports;
        if (transports) {
            const list = transports instanceof Map ? [...transports.values()] : Object.values(transports);
            list.forEach((t, i) => watchPeer(i === 0 ? 'pub' : 'sub', t && t.pc));
        }

        if (joinState !== 'joined') {
            setStatus('Подключено, жду служебный канал SFU...');
        }

        // 8) Публикация
        if (local) {
            client.publish(local);
            const kinds = local.getTracks().map((t) => t.kind);
            console.log('Published. Локальные дорожки:', kinds.join(', ') || 'нет');
            if (!kinds.includes('audio')) {
                console.warn('Внимание: аудиодорожки нет — вас не услышат');
            }
            setStatus('В эфире');
        } else {
            console.log('Joined in receive-only mode');
            setStatus('Режим только приёма');
        }

        // 9) Показываем «Отключиться», прячем «Присоединиться»
        setConnectedUi(true);

    } catch (err) {
        console.error('Join failed:', err);
        setStatus('Ошибка: ' + errText(err));
        setConnectedUi(false);
    } finally {
        // Разблокируем кнопку в любом случае (успех или ошибка)
        document.getElementById('joinBtn').disabled = false;
    }
}

/* ---------- Leave ---------- */

export async function leave() {
    const btn = document.getElementById('leaveBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    setStatus('Отключение...');

    // 1) Останавливаем свои треки
    if (state.localStream) {
        state.localStream.getTracks().forEach((t) => t.stop());
        state.localStream = null;
    }

    // 2) Убираем свою плитку
    removeTile('local');

    // 3) Чистим все чужие фреймы
    removeAllRemote('leave() called');

    // 4) Закрываем PeerConnection-ы и сигнализацию
    try {
        if (state.client && typeof state.client.leave === 'function') {
            await state.client.leave();
        }
    } catch (err) {
        console.warn('client.leave() failed:', err);
    }
    try {
        if (state.client && typeof state.client.close === 'function') {
            state.client.close();
        }
    } catch (err) {
        console.warn('client.close() failed:', err);
    }
    try {
        if (state.signal && typeof state.signal.close === 'function') {
            state.signal.close();
        }
    } catch (err) {
        console.warn('signal.close() failed:', err);
    }

    // 5) Снимаем ссылки
    state.client = null;
    state.signal = null;
    window.__client = null;
    window.__remoteStreams = null;

    // 6) Возвращаем UI в исходное состояние
    setStatus('Отключено');
    setConnectedUi(false);
}
