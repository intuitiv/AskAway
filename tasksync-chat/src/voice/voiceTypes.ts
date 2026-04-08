/**
 * Voice conversation types and interfaces
 * Shared between extension host and webview
 */

/** Messages from extension → webview */
export interface VoiceStartMessage {
    type: 'voiceStart';
    taskId: string;
    question: string;
}

export interface VoiceStopMessage {
    type: 'voiceStop';
}

/** Messages from webview → extension */
export interface VoiceResponseMessage {
    type: 'voiceResponse';
    taskId: string;
    transcription: string;
}

export interface VoiceErrorMessage {
    type: 'voiceError';
    taskId: string;
    error: string;
}

export interface VoiceStatusMessage {
    type: 'voiceStatus';
    status: 'speaking' | 'listening' | 'processing' | 'idle' | 'error';
    detail?: string;
}

/** STT provider configuration */
export type STTProvider = 'browser' | 'whisper';

/** TTS provider configuration */
export type TTSProvider = 'browser' | 'off';

/** Voice settings (stored in VS Code config) */
export interface VoiceSettings {
    sttProvider: STTProvider;
    ttsProvider: TTSProvider;
    ttsVoice?: string;       // name of preferred voice
    ttsRate?: number;        // speech rate 0.5-2.0
    ttsPitch?: number;       // pitch 0.5-2.0
    whisperApiKey?: string;  // for Whisper provider
    autoListen: boolean;     // auto-activate mic after TTS finishes
    language: string;        // BCP-47 language code, default 'en-US'
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
    sttProvider: 'browser',
    ttsProvider: 'browser',
    ttsRate: 1.0,
    ttsPitch: 1.0,
    autoListen: true,
    language: 'en-US',
};
