/*
 * Захват медиа и перечисление устройств.
 *
 * Используем LocalStream из ion-sdk (не navigator.mediaDevices),
 * потому что ion-sdk оборачивает getUserMedia и добавляет свои обработчики.
 * Класс берём из ./sdk.js — он достаёт его из глобала window.IonSDK,
 * который ставит /libs/ion-sdk.min.js.
 */

import { LocalStream } from './sdk.js';

/**
 * Печатаем, что реально видит браузер — частая причина «звука нет» в том,
 * что у публикующего просто нет микрофона, и аудиодорожки нет вообще.
 */
export function logAudioDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then((devices) => {
        const kinds = {};
        devices.forEach((d) => { kinds[d.kind] = (kinds[d.kind] || 0) + 1; });
        console.warn('Устройства ввода/вывода:', JSON.stringify(kinds), '| микрофонов:', kinds.audioinput || 0);
    }).catch(() => {});
}

/**
 * Запросить видео+звук через LocalStream из ion-sdk.
 * Цепочка фолбэков: аудио+видео → только видео → только аудио → null.
 * Возвращает MediaStream или null.
 */
export async function acquireLocalStream(videoConstraints) {
    if (!LocalStream) {
        console.error('LocalStream не найден в globalThis.IonSDK');
        return null;
    }

    // 1) Аудио + видео
    try {
        const stream = await LocalStream.getUserMedia({ audio: true, video: videoConstraints });
        console.log('Микрофон и камера подключены');
        return stream;
    } catch (err) {
        console.warn('A/V failed:', err.name, err.message);
        logAudioDevices();
    }

    // 2) Только видео (нет микрофона)
    try {
        const stream = await LocalStream.getUserMedia({ audio: false, video: videoConstraints });
        console.log('Камера подключена (микрофон не найден)');
        return stream;
    } catch (err) {
        console.warn('Video-only failed:', err.name, err.message);
    }

    // 3) Только аудио (нет камеры)
    try {
        const stream = await LocalStream.getUserMedia({ audio: true, video: false });
        console.log('Микрофон подключён (камера не найдена)');
        return stream;
    } catch (err) {
        console.warn('Audio-only failed:', err.name, err.message);
    }

    console.log('Нет доступных устройств — режим только приёма');
    return null;
}
