import axios from 'axios';
import * as FileSystem from 'expo-file-system/legacy';
import { OPENAI_API_KEY } from '../constants/config';

class OpenAIService {
    private readonly TTS_URL = 'https://api.openai.com/v1/audio/speech';
    private readonly WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

    async textToSpeech(text: string, voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'alloy') {
        try {
            console.log('[OpenAIService] Generating TTS...');
            const response = await axios.post(
                this.TTS_URL,
                {
                    model: 'tts-1',
                    input: text,
                    voice: voice,
                },
                {
                    headers: {
                        Authorization: `Bearer ${OPENAI_API_KEY}`,
                    },
                    responseType: 'arraybuffer',
                }
            );

            const base64Audio = Buffer.from(response.data, 'binary').toString('base64');
            const fileUri = `${FileSystem.cacheDirectory}narration.mp3`;
            await FileSystem.writeAsStringAsync(fileUri, base64Audio, {
                encoding: 'base64',
            });

            return fileUri;
        } catch (error) {
            console.error('[OpenAIService] TTS Error:', error);
            throw error;
        }
    }

    async transcribeAudio(fileUri: string) {
        try {
            console.log('[OpenAIService] Transcribing with Whisper...');
            const formData = new FormData();

            // Note: Expo FileSystem might need the file to be exist
            const fileInfo = await FileSystem.getInfoAsync(fileUri);
            if (!fileInfo.exists) {
                throw new Error('File does not exist for transcription');
            }

            formData.append('file', {
                uri: fileUri,
                name: 'recording.m4a',
                type: 'audio/m4a',
            } as any);
            formData.append('model', 'whisper-1');

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
                console.error('[OpenAIService] Whisper Error:', error.message || error);
            }
            throw error;
        }
    }
}

export const openAIService = new OpenAIService();
