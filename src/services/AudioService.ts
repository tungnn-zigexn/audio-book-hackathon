import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import { Platform } from 'react-native';
import { openAIService, OpenAIVoice } from './OpenAIService';

class AudioService {
    private sound: Audio.Sound | null = null;
    private isPlayingAI = false;
    private isPaused = false;
    private currentAIVoice: OpenAIVoice | null = null;
    private lastPositionMillis: number = 0;

    private prefetchMap: Map<number, string> = new Map();

    async speak(
        text: string,
        language: 'en' | 'vi',
        onChunkStart?: (index: number, total: number, chunks: string[]) => void,
        startIndex: number = 0
    ) {
        this.isPlayingAI = false;
        try {
            console.log(`[AudioService] Using Local System TTS for ${language} from chunk ${startIndex}`);
            await this.stop();

            const chunks = this.chunkText(text, 300);
            let currentChunkIndex = startIndex;

            const speakNext = () => {
                if (currentChunkIndex < chunks.length && !this.isPlayingAI) {
                    const chunk = chunks[currentChunkIndex];
                    if (onChunkStart) onChunkStart(currentChunkIndex, chunks.length, chunks);

                    Speech.speak(chunk, {
                        language: language === 'en' ? 'en-US' : 'vi-VN',
                        pitch: 1.0,
                        rate: 1.0,
                        onDone: () => {
                            currentChunkIndex++;
                            speakNext();
                        },
                        onStopped: () => console.log('[AudioService] Speech stopped'),
                        onError: (error) => console.error('[AudioService] Speech Error:', error)
                    });
                }
            };
            speakNext();
        } catch (error) {
            console.error('[AudioService] TTS error:', error);
        }
    }

    async speakWithOpenAI(
        text: string,
        voice: OpenAIVoice,
        onChunkStart?: (index: number, total: number, chunks: string[]) => void,
        onProgress?: (msg: string) => void,
        startIndex: number = 0,
        resumeMillis: number = 0
    ) {
        try {
            // If we are already paused on this session AND it's the same voice, just resume!
            if (this.isPaused && this.isPlayingAI && this.sound && this.currentAIVoice === voice) {
                console.log('[AudioService] Resuming existing AI session');
                await this.resume();
                return;
            }

            await this.stop();
            this.isPlayingAI = true;
            this.isPaused = false;
            this.currentAIVoice = voice;

            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
                staysActiveInBackground: true,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false,
            });

            if (onProgress) onProgress('Đang chuẩn bị giọng đọc AI...');
            const chunks = this.chunkText(text, 500);
            let currentIdx = startIndex;

            const prefetchNext = async (idx: number) => {
                if (idx < chunks.length && !this.prefetchMap.has(idx) && this.isPlayingAI) {
                    try {
                        console.log(`[AudioService] Pre-fetching chunk ${idx + 1}`);
                        const uri = await openAIService.synthesizeSpeech(chunks[idx], voice);
                        this.prefetchMap.set(idx, uri);
                    } catch (e) {
                        console.error('[AudioService] Pre-fetch failed for', idx, e);
                    }
                }
            };

            const playNextAIChunk = async () => {
                if (!this.isPlayingAI) return;

                if (currentIdx < chunks.length) {
                    if (onProgress) onProgress(`Đang tải đoạn ${currentIdx + 1}/${chunks.length}...`);
                    if (onChunkStart) onChunkStart(currentIdx, chunks.length, chunks);

                    let audioUri = this.prefetchMap.get(currentIdx);
                    if (!audioUri) {
                        console.log(`[AudioService] Cache miss for chunk ${currentIdx + 1}, fetching now...`);
                        audioUri = await openAIService.synthesizeSpeech(chunks[currentIdx], voice);
                        this.prefetchMap.set(currentIdx, audioUri);
                    } else {
                        console.log(`[AudioService] Cache HIT for chunk ${currentIdx + 1}`);
                    }

                    if (!this.isPlayingAI) return;

                    // Start prefetching the next one immediately
                    prefetchNext(currentIdx + 1);

                    console.log(`[AudioService] Creating sound for: ${audioUri}${resumeMillis > 0 ? ` at ${resumeMillis}ms` : ''}`);
                    const { sound } = await Audio.Sound.createAsync(
                        { uri: audioUri },
                        {
                            shouldPlay: true,
                            volume: 1.0,
                            positionMillis: resumeMillis,
                            progressUpdateIntervalMillis: 100 // Update position every 100ms
                        }
                    );

                    // Reset resumeMillis after first chunk use
                    resumeMillis = 0;

                    if (!this.isPlayingAI) {
                        await sound.stopAsync();
                        await sound.unloadAsync();
                        return;
                    }

                    this.sound = sound;

                    sound.setOnPlaybackStatusUpdate(async (status) => {
                        if (status.isLoaded) {
                            if (status.positionMillis !== undefined) {
                                this.lastPositionMillis = status.positionMillis;
                                // Debug: console.log(`[AudioService] Current pos: ${this.lastPositionMillis}`);
                            }

                            if (status.didJustFinish) {
                                console.log('[AudioService] Chunk finished playing');
                                await sound.unloadAsync();
                                if (this.sound === sound) this.sound = null;
                                this.lastPositionMillis = 0; // Reset for next chunk
                                currentIdx++;
                                playNextAIChunk();
                            }
                        }
                    });
                } else {
                    console.log('[AudioService] AI Playback finished');
                    if (onProgress) onProgress('');
                    this.isPlayingAI = false;
                }
            };

            // Initial prefetch for next chunk
            prefetchNext(startIndex + 1);
            await playNextAIChunk();
        } catch (error) {
            console.error('[AudioService] OpenAI TTS error:', error);
            if (onProgress) onProgress('Lỗi khi nạp giọng đọc AI.');
            this.isPlayingAI = false;
        }
    }

    public chunkText(text: string, size: number): string[] {
        console.log(`[AudioService] Chunking text of length: ${text?.length}, size: ${size}`);
        if (!text) return [];
        const chunks: string[] = [];
        const cleanText = text.replace(/\s+/g, ' ').trim();
        let index = 0;

        while (index < cleanText.length) {
            let endIndex = index + size;
            if (endIndex < cleanText.length) {
                const lastSentence = cleanText.lastIndexOf('. ', endIndex);
                const lastSpace = cleanText.lastIndexOf(' ', endIndex);
                if (lastSentence > index + (size * 0.4)) {
                    endIndex = lastSentence + 1;
                } else if (lastSpace > index) {
                    endIndex = lastSpace;
                }
            }
            chunks.push(cleanText.substring(index, endIndex).trim());
            index = endIndex;
        }
        const result = chunks.filter(c => c.length > 0);
        console.log(`[AudioService] Created ${result.length} chunks`);
        return result;
    }

    async pause() {
        console.log('[AudioService] Pausing playback');
        this.isPaused = true;
        try {
            if (this.sound) {
                await this.sound.pauseAsync();
            }
            // Speech.pause is not available on Android
            if (Platform.OS === 'ios') {
                await Speech.pause();
            } else {
                // On Android, system Speech doesn't support pause/resume well.
                // We mainly care about OpenAI TTS which uses this.sound
                if (!this.sound) {
                    await Speech.stop();
                }
            }
        } catch (error) {
            console.error('[AudioService] Pause error:', error);
        }
    }

    async resume() {
        console.log('[AudioService] Resuming playback');
        this.isPaused = false;
        try {
            if (this.sound) {
                await this.sound.playAsync();
            }
            if (Platform.OS === 'ios') {
                await Speech.resume();
            }
            // On Android, we don't have a good way to resume native speech midway,
            // but OpenAI TTS (this.sound) works perfectly.
        } catch (error) {
            console.error('[AudioService] Resume error:', error);
        }
    }

    public isPausedState() {
        return this.isPaused;
    }

    public getPlaybackState() {
        return {
            isPaused: this.isPaused,
            isPlayingAI: this.isPlayingAI,
            lastPositionMillis: this.lastPositionMillis,
            currentAIVoice: this.currentAIVoice
        };
    }

    async stop() {
        this.isPlayingAI = false;
        this.isPaused = false;
        this.currentAIVoice = null;
        this.prefetchMap.clear();
        try {
            if (this.sound) {
                await this.sound.stopAsync();
                await this.sound.unloadAsync();
                this.sound = null;
            }
            await Speech.stop();
        } catch (error) {
            console.error('[AudioService] Stop error:', error);
        }
    }
}

export const audioService = new AudioService();
