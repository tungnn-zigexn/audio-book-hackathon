import axios from 'axios';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import { OPENAI_API_KEY } from '../constants/config';

export type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

class OpenAIService {
    private baseUrl = 'https://api.openai.com/v1';
    private readonly TTS_URL = 'https://api.openai.com/v1/audio/speech';
    private readonly WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
    private readonly CHAT_URL = 'https://api.openai.com/v1/chat/completions';

    /**
     * Synthesize speech using OpenAI TTS (for AI voice feature)
     * Returns a local URI to the audio file
     */
    async synthesizeSpeech(text: string, voice: OpenAIVoice = 'alloy'): Promise<string> {
        try {
            if (!OPENAI_API_KEY) {
                throw new Error('OpenAI API key not configured');
            }

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
     * Legacy method - kept for compatibility
     */
    async textToSpeech(text: string, voice: OpenAIVoice = 'alloy') {
        return this.synthesizeSpeech(text, voice);
    }

    /**
     * Transcribe audio using Whisper
     */
    async transcribeAudio(fileUri: string): Promise<string> {
        try {
            if (!OPENAI_API_KEY) {
                throw new Error('OpenAI API key not configured');
            }

            console.log('[OpenAIService] Transcribing with Whisper...');
            const fileInfo = await FileSystem.getInfoAsync(fileUri);
            if (!fileInfo.exists) {
                throw new Error('File does not exist for transcription');
            }

            const formData = new FormData();
            formData.append('file', {
                uri: fileUri,
                name: 'recording.m4a',
                type: 'audio/m4a',
            } as any);
            formData.append('model', 'whisper-1');
            formData.append('language', 'vi'); // Tiếng Việt

            const response = await axios.post(this.WHISPER_URL, formData, {
                headers: {
                    Authorization: `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'multipart/form-data',
                },
            });

            return response.data.text;
        } catch (error: any) {
            if (error.response?.status === 429) {
                console.error('[OpenAIService] Whisper Quota Exceeded (429). Please check your OpenAI billing/limits.');
            } else {
                console.error('[OpenAIService] Whisper Error:', error.response?.data || error.message);
            }
            throw error;
        }
    }

    async chatCompletion(messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>, options?: {
        model?: string;
        max_tokens?: number;
        temperature?: number;
    }): Promise<string> {
        try {
            if (!OPENAI_API_KEY) {
                throw new Error('OpenAI API key not configured');
            }

            const response = await axios.post(
                this.CHAT_URL,
                {
                    model: options?.model || 'gpt-3.5-turbo',
                    messages,
                    max_tokens: options?.max_tokens || 500,
                    temperature: options?.temperature || 0.7,
                },
                {
                    headers: {
                        Authorization: `Bearer ${OPENAI_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            return response.data.choices[0].message.content;
        } catch (error: any) {
            console.error('[OpenAIService] Chat Error:', error.response?.data || error.message);
            throw error;
        }
    }
}

export const openAIService = new OpenAIService();
