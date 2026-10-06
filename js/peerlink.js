/*
 * peerlink.js — RTT между участниками, а не между участником и SFU.
 *
 * Почему нельзя взять из getStats(): candidate-pair на sub-пире измеряет
 * путь «браузер ↔ SFU». У обоих участников он свой, и ни один из них не
 * видит путь «браузер A ↔ браузер B». Единственный способ получить его —
 * обменяться собственными метками времени, то есть пинговать собеседника
 * прикладным сообщением.
 *
 * Транспорт — data channel, который фабустит SFU. В SessionLocal.AddDatachannel
 * канал, созданный публикующим, регистрируется у всех остальных участников
 * сессии, а ответы маршрутизируются обратно создателю (FanOutMessage +
 * GetDataChannels по метке). Поэтому достаточно ОДНОГО канала на участника:
 *
 *   A создаёт канал "link:<uid A>"  →  SFU раздаёт его B, C, D
 *   B шлёт pong в свой входящий канал "link:<uid A>"
 *   SFU доставляет его только A (метка зарегистрирована за A)
 *
 * Итого каждый участник измеряет RTT до всех остальных, создав один канал.
 */

import {
    LINK_LABEL_PREFIX, PING_INTERVAL_MS, PEER_RTT_STALE_MS, PEER_RTT_WINDOW
} from './config.js';
import { state, peerRtt, peerRttByStream } from './state.js';

/* ---------- Служебное состояние модуля ---------- */

/*
 * pending: id ping'а -> performance.now() в момент отправки.
 * На один ping отвечает каждый участник, поэтому запись удаляем не по
 * первому ответу, а по таймеру — иначе ответы остальных отбрасывались бы.
 */
const pending = new Map();

// Последний замер RTT до SFU. Едет в ping, чтобы собеседник видел и своё
// качество, и чтобы на хосте можно было отличить «у меня плохой канал»
// от «у собеседника плохой канал».
let ownSfuRtt = null;

let ownChannel = null;
let pingTimer = null;
let seq = 0;

/* ---------- Отправка ---------- */

function ownStreamId() {
    return state.localStream ? state.localStream.id : null;
}

/** stats.js вызывает его на каждом тике, peerlink только отдаёт значение в ping. */
export function setOwnSfuRtt(value) {
    ownSfuRtt = (typeof value === 'number' && isFinite(value)) ? value : null;
}

function send(channel, payload) {
    if (!channel || channel.readyState !== 'open') return false;
    try {
        channel.send(JSON.stringify(payload));
        return true;
    } catch (err) {
        console.warn('[peerlink] не отправлено:', err);
        return false;
    }
}

/* ---------- Учёт замеров ---------- */

function record(msg, rtt) {
    if (!msg.uid) return;

    const prev = peerRtt.get(msg.uid);
    const samples = prev ? prev.samples.slice() : [];
    samples.push(rtt);
    while (samples.length > PEER_RTT_WINDOW) samples.shift();

    peerRtt.set(msg.uid, {
        uid: msg.uid,
        // streamId участника нужен, чтобы сопоставить uid с ключом плитки.
        streamId: msg.streamId || (prev && prev.streamId) || null,
        sfuRtt: (typeof msg.sfuRtt === 'number' && isFinite(msg.sfuRtt))
            ? msg.sfuRtt
            : ((prev && prev.sfuRtt) || null),
        samples,
        rtt,
        min: samples.reduce((a, b) => (b < a ? b : a), rtt),
        avg: samples.reduce((a, b) => a + b, 0) / samples.length,
        at: Date.now()
    });

    if (msg.streamId) peerRttByStream.set(msg.streamId, msg.uid);
}

function handleMessage(raw, channel) {
    let msg;
    try {
        msg = JSON.parse(raw);
    } catch (err) {
        return;                       // не наше сообщение — молча пропускаем
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'ping') {
        // Ответ строго в тот же канал: SFU маршрутизует его владельцу метки.
        send(channel, {
            t: 'pong',
            id: msg.id,
            uid: state.uid,
            streamId: ownStreamId(),
            sfuRtt: ownSfuRtt
        });
        return;
    }

    if (msg.t === 'pong') {
        const sentAt = pending.get(msg.id);
        if (sentAt === undefined) return;    // просрочено или не наш id
        record(msg, performance.now() - sentAt);
    }
}

/* ---------- Жизненный цикл ---------- */

function pingAll() {
    if (!ownChannel || ownChannel.readyState !== 'open') return;

    const id = ++seq;
    pending.set(id, performance.now());
    setTimeout(() => pending.delete(id), PEER_RTT_STALE_MS);

    send(ownChannel, {
        t: 'ping',
        id,
        uid: state.uid,
        streamId: ownStreamId(),
        sfuRtt: ownSfuRtt
    });
}

/**
 * Принять входящий канал от SFU. Вызывается из client.ondatachannel.
 * Возвращает true, если канал наш и его не надо показывать в логе как чужой.
 */
export function acceptChannel(channel) {
    if (!channel || typeof channel.label !== 'string') return false;
    if (!channel.label.startsWith(LINK_LABEL_PREFIX)) return false;
    if (channel === ownChannel) return false;

    channel.onmessage = (ev) => handleMessage(ev.data, channel);
    console.log('[peerlink] входящий канал:', channel.label);
    return true;
}

/**
 * Создать собственный канал и запустить пингование. Звать после join() и
 * publish(): создание канала провоцирует пересогласование pub-пира, поэтому
 * лучше, чтобы дорожки уже были на месте.
 */
export function startLink(client) {
    stopLink();

    if (!client || typeof client.createDataChannel !== 'function') {
        console.warn('[peerlink] createDataChannel недоступен — ' +
            'RTT между пирами не измеряется, остаётся только RTT до SFU');
        return;
    }

    const label = LINK_LABEL_PREFIX + state.uid;
    try {
        ownChannel = client.createDataChannel(label);
    } catch (err) {
        console.warn('[peerlink] канал не создан:', err);
        return;
    }

    ownChannel.onmessage = (ev) => handleMessage(ev.data, ownChannel);
    ownChannel.onopen = () => {
        console.log('[peerlink] свой канал открыт:', label);
        pingAll();                       // не ждём первого тика таймера
    };
    ownChannel.onclose = () => console.log('[peerlink] свой канал закрыт:', label);

    pingTimer = setInterval(pingAll, PING_INTERVAL_MS);
    console.log('[peerlink] канал создан, жду пересогласования:', label);
}

export function stopLink() {
    if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
    }
    pending.clear();
    ownSfuRtt = null;
    seq = 0;

    if (ownChannel) {
        ownChannel.onmessage = null;
        ownChannel.onopen = null;
        ownChannel.onclose = null;
        try { ownChannel.close(); } catch (err) { /* уже закрыт */ }
        ownChannel = null;
    }

    peerRtt.clear();
    peerRttByStream.clear();
}

/* ---------- Чтение для отображения ---------- */

function isFresh(entry) {
    return !!entry && entry.at >= Date.now() - PEER_RTT_STALE_MS;
}

/** Убрать записи об ушедших участниках. */
export function prunePeers() {
    const cutoff = Date.now() - PEER_RTT_STALE_MS * 2;
    peerRtt.forEach((entry, uid) => {
        if (entry.at < cutoff) {
            if (entry.streamId) peerRttByStream.delete(entry.streamId);
            peerRtt.delete(uid);
        }
    });
}

/**
 * Замер для плитки key. Ключ плитки в room.js — id входящего MediaStream,
 * а ключ замеров — uid участника, поэтому нужно сопоставление.
 *
 * 1) точное совпадение: участник присылает свой streamId в ping;
 * 2) запасной вариант: пир и плитка по одной — считаем, что это он. Нужен
 *    потому, что SFU может переписать stream id при форвардинге, и тогда
 *    точного совпадения не будет.
 */
export function peerRttFor(key, remoteCount) {
    const byStream = peerRtt.get(peerRttByStream.get(key));
    if (isFresh(byStream)) return byStream;

    if (remoteCount === 1) {
        const live = liveEntries();
        if (live.length === 1) return live[0];
    }
    return null;
}

function liveEntries() {
    const out = [];
    peerRtt.forEach((entry) => { if (isFresh(entry)) out.push(entry); });
    return out;
}

/** Наилучший (минимальный) RTT среди живых участников — для локальной плитки. */
export function bestPeerRtt() {
    const live = liveEntries();
    if (!live.length) return null;
    return live.reduce((a, e) => (e.rtt < a ? e.rtt : a), live[0].rtt);
}
