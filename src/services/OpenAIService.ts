import axios from 'axios';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

export type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

class OpenAIService {
    private baseUrl = 'https://api.openai.com/v1';

    /**
     * Synthesize speech using OpenAI TTS
     * Returns a local URI to the audio file
     */
    async synthesizeSpeech(text: string, voice: OpenAIVoice = 'alloy'): Promise<string> {
        try {
            console.log(`[OpenAIService] Sending request to OpenAI TTS... (Text length: ${text.length})`);

            const response = await axios.post(
                `${this.baseUrl}/audio/speech`,
                {
                    model: 'tts-1',
                    input: text,
                    voice: voice,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${OPENAI_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    responseType: 'arraybuffer',
                    timeout: 30000, // 30 seconds
                }
            );

            console.log(`[OpenAIService] Response received. status: ${response.status}, byteLength: ${response.data.byteLength}`);

            // In some environments, response.data might be a Buffer or ArrayBuffer
            const audioData = response.data instanceof Buffer ? response.data : Buffer.from(response.data);
            const base64Audio = audioData.toString('base64');
            const filename = `${FileSystem.cacheDirectory}tts_${Date.now()}.mp3`;

            await FileSystem.writeAsStringAsync(filename, base64Audio, {
                encoding: FileSystem.EncodingType.Base64,
            });

            const verify = await FileSystem.getInfoAsync(filename);
            console.log(`[OpenAIService] Audio saved: ${filename}, exists: ${verify.exists}, size: ${verify.exists ? verify.size : 0}`);
            return filename;
        } catch (error: any) {
            console.error('[OpenAIService] TTS Error:', error?.response?.data || error.message);
            throw new Error('Failed to synthesize speech with OpenAI');
        }
    }

    /**
     * Transcribe audio using Whisper
     */
    async transcribeAudio(fileUri: string): Promise<string> {
        try {
            console.log('[OpenAIService] Transcribing audio...');

            const formData = new FormData();
            formData.append('file', {
                uri: fileUri,
                name: 'audio.m4a',
                type: 'audio/m4a',
            } as any);
            formData.append('model', 'whisper-1');

            const response = await axios.post(
                `${this.baseUrl}/audio/transcriptions`,
                formData,
                {
                    headers: {
                        'Authorization': `Bearer ${OPENAI_API_KEY}`,
                        'Content-Type': 'multipart/form-data',
                    },
                }
            );

            return response.data.text;
        } catch (error: any) {
            console.error('[OpenAIService] Transcription Error:', error?.response?.data || error.message);
            throw new Error('Failed to transcribe audio');
        }
    }
}

export const openAIService = new OpenAIService();
