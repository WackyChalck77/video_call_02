/*
 * main.js — точка входа. Проверяет SDK, подключает обработчики кнопок,
 * запускает сторожа stale и цикл статистики.
 *
 * ion-sdk — UMD-пакеты, которые устанавливают глобалы:
 *   globalThis.IonSDK → { Client, LocalStream }
 *   globalThis.Signal → { IonSFUJSONRPCSignal }
 *
 * Обычные <script> выше загружают UMD-бандлы, поэтому при загрузке
 * <script type="module"> глобалы уже доступны. Классы оттуда экспортирует
 * ./sdk.js — остальные модули берут их только через него.
 */

/* ---- Модули проекта ---- */

import { Client, LocalStream, IonSFUJSONRPCSignal, missingSdkParts } from './sdk.js';
import { join, leave, startStaleWatch } from './room.js';
import { startStatsLoop } from './stats.js';
import { logAudioDevices } from './media.js';
import { QUALITY_PRESETS } from './config.js';
import { initExpandKeyboard, initTileClicks, toggleVideoMute, toggleAudioMute, resetMuteState } from './ui.js';

/* ---- Проверка SDK ---- */

const missing = missingSdkParts();
if (missing.length) {
    document.getElementById('status').textContent =
        'SDK не загрузился: не найдено ' + missing.join(', ') +
        ' — проверьте /libs/ion-sdk.min.js и /libs/json-rpc.min.js';
    throw new Error('ion-sdk UMD bundles are missing: ' + missing.join(', '));
}

console.log('SDK loaded:', { Client, LocalStream, IonSFUJSONRPCSignal });

/* ---- Кнопки ---- */

document.getElementById('joinBtn').onclick = async () => {
    const quality = document.getElementById('qualitySelect').value;
    await join(QUALITY_PRESETS[quality]);
};

document.getElementById('leaveBtn').onclick = leave;
document.getElementById('videoMuteBtn').onclick = toggleVideoMute;
document.getElementById('audioMuteBtn').onclick = toggleAudioMute;

/* ---- Инициализация фоновых процессов ---- */

startStaleWatch();
startStatsLoop();
initExpandKeyboard();
initTileClicks();
resetMuteState();

logAudioDevices();
