/*
 * DOM-логики: статус, кнопки, плитки видео, статистика, разблокировка аудио.
 */

import { prevStats } from './state.js';

// Предустановленный цвет для подписи "Местный".
const LOCAL_CAPTION_COLOR = '#aaa';

/* ---------- Статус ---------- */

export function setStatus(text) {
    document.getElementById('status').textContent = text;
    console.log('STATUS:', text);
}

/* ---------- Кнопки ---------- */

export function setConnectedUi(connected) {
    const joinBtn = document.getElementById('joinBtn');
    const leaveBtn = document.getElementById('leaveBtn');
    joinBtn.style.display = connected ? 'none' : 'inline-block';
    joinBtn.disabled = false;
    leaveBtn.style.display = connected ? 'inline-block' : 'none';
    leaveBtn.disabled = false;
    document.getElementById('qualitySelect').disabled = connected;
}

/* ---------- Плитка видео ---------- */

/**
 * Получить или создать обёртку .tile, <video> и (если нужно) таблицу статистики.
 * Возвращает объект { wrapper, el } для удобства использования.
 */
export function ensureTile(id, { stats }) {
    let wrapper = document.getElementById('wrapper-' + id);
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.id = 'wrapper-' + id;
        wrapper.className = 'tile';
        const cap = document.createElement('div');
        cap.className = 'tile__caption';
        cap.id = 'caption-' + id;
        wrapper.appendChild(cap);
        document.getElementById('videos').appendChild(wrapper);
    }

    let el = document.getElementById('video-' + id);
    if (!el) {
        el = document.createElement('video');
        el.id = 'video-' + id;
        el.autoplay = true;
        el.playsInline = true;
        el.volume = 1;
        wrapper.appendChild(el);
    }

    if (stats && !document.getElementById('stats-' + id)) {
        const div = document.createElement('div');
        div.id = 'stats-' + id;
        div.className = 'tile__stats';
        wrapper.appendChild(div);
    }

    return { wrapper, el };
}

/**
 * Удалить плитку целиком: обёртку, видео, статистику, кэши предыдущих замеров.
 * Вызывается при leave, при уходе пира, при отключении.
 */
export function removeTile(key) {
    prevStats.delete('stats_' + key);
    const wrapper = document.getElementById('wrapper-' + key);
    if (!wrapper) return;
    const el = wrapper.querySelector('video');
    if (el) {
        el.pause();
        el.srcObject = null;
        el.load();
    }
    wrapper.remove();
    console.log('Removed tile:', key);
}

/**
 * Обновить подпись под видео.
 */
export function setCaption(id, text, color) {
    const cap = document.getElementById('caption-' + id);
    if (!cap) return;
    cap.textContent = text;
    cap.style.color = color || '#666';
}

/* ---------- Воспроизведение ---------- */

/**
 * Браузер может отложить автовоспроизведение со звуком. AbortError — это
 * гонка с пересогласованием SDP, её просто повторяем. Настоящую блокировку
 * автоплея снимаем при первом же взаимодействии со страницей.
 */
export function playWithSound(el, attempt) {
    const tries = attempt || 0;
    const p = el.play();
    if (!p || !p.catch) return;
    p.catch((err) => {
        if (err && err.name === 'AbortError' && tries < 3) {
            setTimeout(() => playWithSound(el, tries + 1), 150);
            return;
        }
        console.warn('Autoplay blocked for', el.id, err && err.name);
        const unlock = () => {
            el.play().then(() => console.log('Playback unlocked by user gesture:', el.id))
                .catch(() => {});
            document.removeEventListener('pointerdown', unlock);
            document.removeEventListener('keydown', unlock);
        };
        document.addEventListener('pointerdown', unlock);
        document.addEventListener('keydown', unlock);
    });
}

/* ---------- Таблица статистики ---------- */

/**
 * Обновить таблицу под видео. rows — массив [label, value].
 */
export function renderStats(id, rows) {
    const el = document.getElementById('stats-' + id);
    if (!el) return;
    el.innerHTML = rows.map(([label, value]) =>
        `<div>${label}: ${value}</div>`
    ).join('');
}
