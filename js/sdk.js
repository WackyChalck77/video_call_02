/*
 * sdk.js — единственная точка доступа к классам из UMD-бандлов.
 *
 * Что реально кладут в глобалы наши скрипты из /libs:
 *
 *   /libs/ion-sdk.min.js   →  window.IonSDK  = { Client, LocalStream, ... }
 *   /libs/json-rpc.min.js  →  window.Signal  = { IonSFUJSONRPCSignal }
 *
 * Конструкторы живут ВНУТРИ пространств имён. Глобалов window.Client и
 * window.IonSFUJSONRPCSignal не существует, поэтому new window.IonSFUJSONRPCSignal()
 * падает с «is not a constructor». Берём классы только отсюда.
 */

const ION_SDK = globalThis.IonSDK || {};
const SIGNAL_NS = globalThis.Signal || {};

export const Client = ION_SDK.Client;
export const LocalStream = ION_SDK.LocalStream;
export const IonSFUJSONRPCSignal = SIGNAL_NS.IonSFUJSONRPCSignal;

/**
 * Имена классов, которые не нашлись в глобалах.
 * Пустой массив означает, что оба бандла загрузились.
 */
export function missingSdkParts() {
    const missing = [];
    if (typeof Client !== 'function') missing.push('IonSDK.Client');
    if (typeof LocalStream !== 'function') missing.push('IonSDK.LocalStream');
    if (typeof IonSFUJSONRPCSignal !== 'function') missing.push('Signal.IonSFUJSONRPCSignal');
    return missing;
}
