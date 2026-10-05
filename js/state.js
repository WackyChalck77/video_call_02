/*
 * Общее состояние комнаты. ES-модуль — синглтон, поэтому любой импорт
 * получает один и тот же объект. Изменяется в room.js, читается везде.
 */

export const state = { client: null, signal: null, localStream: null };

/*
 * remoteStreams: key → { stream, tracks: Set<MediaStreamTrack>, mutedAt }.
 * Ключ совпадает с id элемента <video> ('video-' + key), поэтому по нему
 * и удаляем фрейм, когда дорожка ушла.
 */
export const remoteStreams = new Map();

/*
 * prevStats: 'stats_' + key → { timestamp, videoBytes, videoFrames, audioBytes }.
 * Используется для расчёта битрейта между тиками.
 */
export const prevStats = new Map();
