/*
 * DOM-логики: статус, кнопки, плитки видео, статистика, разблокировка аудио.
 */

import { prevStats, state } from './state.js';

// Предустановленный цвет для подписи "Местный".
const LOCAL_CAPTION_COLOR = '#aaa';

/* ---------- Статус ---------- */

export function setStatus(text, type) {
    const el = document.getElementById('status');
    el.textContent = text;
    
    // Убираем все классы типов
    el.classList.remove('connected', 'error', 'connecting');
    
    // Добавляем класс в зависимости от типа
    if (type) {
        el.classList.add(type);
    }
    
    console.log('STATUS:', text);
}

/* ---------- Кнопки ---------- */

export function setConnectedUi(connected) {
    const joinBtn = document.getElementById('joinBtn');
    const leaveBtn = document.getElementById('leaveBtn');
    const muteBtns = document.getElementById('muteBtns');
    joinBtn.style.display = connected ? 'none' : 'inline-block';
    joinBtn.disabled = false;
    leaveBtn.style.display = connected ? 'inline-block' : 'none';
    leaveBtn.disabled = false;
    document.getElementById('qualitySelect').disabled = connected;
    
    if (muteBtns) {
        muteBtns.classList.toggle('hidden', !connected);
    }
}

/* ---------- Отключение видео/аудио ---------- */

let videoMuted = false;
let audioMuted = false;

export function toggleVideoMute() {
    if (!state.localStream) return;
    const videoTrack = state.localStream.getVideoTracks()[0];
    if (!videoTrack) return;
    
    videoMuted = !videoMuted;
    videoTrack.enabled = !videoMuted;
    
    const btn = document.getElementById('videoMuteBtn');
    btn.textContent = videoMuted ? 'Видео выкл' : 'Видео вкл';
    btn.classList.toggle('muted', videoMuted);
}

export function toggleAudioMute() {
    if (!state.localStream) return;
    const audioTrack = state.localStream.getAudioTracks()[0];
    if (!audioTrack) return;
    
    audioMuted = !audioMuted;
    audioTrack.enabled = !audioMuted;
    
    const btn = document.getElementById('audioMuteBtn');
    btn.textContent = audioMuted ? 'Микрофон выкл' : 'Микрофон вкл';
    btn.classList.toggle('muted', audioMuted);
}

export function resetMuteState() {
    videoMuted = false;
    audioMuted = false;
    const videoBtn = document.getElementById('videoMuteBtn');
    const audioBtn = document.getElementById('audioMuteBtn');
    if (videoBtn) {
        videoBtn.textContent = 'Видео вкл';
        videoBtn.classList.remove('muted');
    }
    if (audioBtn) {
        audioBtn.textContent = 'Микрофон вкл';
        audioBtn.classList.remove('muted');
    }
}

/* ---------- Плитка видео ---------- */

// Текущая увеличенная плитка
let expandedTile = null;

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

    // Двойной клик по видео — увеличение/уменьшение
    el.addEventListener('dblclick', (e) => {
        e.preventDefault();
        toggleExpandTile(id);
    });

    // Клик по самой плитке — тоже увеличение
    wrapper.addEventListener('click', (e) => {
        // Игнорируем клики по статистике
        if (e.target.closest('.tile__stats')) return;
        toggleExpandTile(id);
    });

    return { wrapper, el };
}

/**
 * Переключить увеличение плитки.
 * @param {string} id - идентификатор плитки
 */
export function toggleExpandTile(id) {
    const wrapper = document.getElementById('wrapper-' + id);
    if (!wrapper) return;

    // Если эта плитка уже увеличена — закрываем
    if (expandedTile === id) {
        closeExpandTile();
        return;
    }

    // Если другая плитка увеличена — сначала закрываем её
    if (expandedTile) {
        closeExpandTile();
    }

    // Увеличиваем
    wrapper.classList.add('tile--expanded');
    expandedTile = id;
}

/**
 * Закрыть увеличенную плитку.
 */
export function closeExpandTile() {
    if (!expandedTile) return;
    const wrapper = document.getElementById('wrapper-' + expandedTile);
    if (wrapper) {
        wrapper.classList.remove('tile--expanded');
    }
    expandedTile = null;
}

/**
 * Инициализация обработчика ESC для закрытия увеличенной плитки.
 */
export function initExpandKeyboard() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && expandedTile) {
            closeExpandTile();
        }
    });
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
    if (!el) {
        console.warn('[stats] element not found:', 'stats-' + id);
        return;
    }
    el.style.display = 'block';
    el.innerHTML = rows.map(([label, value]) =>
        `<div>${label}: ${value}</div>`
    ).join('');
}
