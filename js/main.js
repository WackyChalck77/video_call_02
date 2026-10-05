/*
 * main.js — точка входа. Загружает SDK из глобалов, подключает обработчики кнопок,
 * запускает сторожа stale и цикл статистики.
 *
 * ion-sdk — UMD-пакет, который устанавливает глобальные конструкторы:
 *   globalThis.IonSDK → { Client, LocalStream }
 *   globalThis.Signal → { IonSFUJSONRPCSignal }
 *
 * Обычные <script> выше загружают UMD-бандлы, поэтому при загрузке
 * <script type="module"> глобалы уже доступны.
 */

/* ---- SDK из глобалов ---- */

const { Client, LocalStream } = globalThis.IonSDK;
const { IonSFUJSONRPCSignal } = globalThis.Signal;

if (!Client || !LocalStream || !IonSFUJSONRPCSignal) {
    document.getElementById('status').textContent =
        'SDK не загрузился: проверьте /libs/ion-sdk.min.js и /libs/json-rpc.min.js';
    throw new Error('ion-sdk UMD bundles are missing');
}

console.log('SDK loaded:', { Client, LocalStream, IonSFUJSONRPCSignal });

/* ---- Модули проекта ---- */

import { join, leave, startStaleWatch } from './room.js';
import { startStatsLoop } from './stats.js';
import { logAudioDevices } from './media.js';
import { QUALITY_PRESETS } from './config.js';

/* ---- Кнопки ---- */

document.getElementById('joinBtn').onclick = async () => {
    const quality = document.getElementById('qualitySelect').value;
    await join(QUALITY_PRESETS[quality]);
};

document.getElementById('leaveBtn').onclick = leave;

/* ---- Инициализация фоновых процессов ---- */

startStaleWatch();
startStatsLoop();

logAudioDevices();
