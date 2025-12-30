import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import { Platform } from 'react-native';
import { openAIService, OpenAIVoice } from './OpenAIService';

class AudioService {
    private sound: Audio.Sound | null = null;
    
    // AI Voice features
    private isPlayingAI = false;
    private isPaused = false;
    private currentAIVoice: OpenAIVoice | null = null;
    private lastPositionMillis: number = 0;
    private prefetchMap: Map<number, string> = new Map();

    // Speed control features
    private currentRate: number = 1.0; // Tốc độ hiện tại (0.25 - 2.0)
    private isPlaying: boolean = false;
    private currentLanguage: 'en' | 'vi' = 'vi';
    private currentText: string = '';

    async speak(
        text: string,
        language: 'en' | 'vi',
        onChunkStart?: (index: number, total: number, chunks: string[]) => void,
        startIndex: number = 0,
        rate?: number
    ) {
        this.isPlayingAI = false;
        try {
            const speechRate = rate ?? this.currentRate;
            this.currentRate = speechRate;
            this.currentLanguage = language;
            this.currentText = text;
            
            console.log(`[AudioService] Using Local System TTS for ${language} at rate ${speechRate} from chunk ${startIndex}`);

            // 1. Set audio mode for playback
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
                staysActiveInBackground: false,
                shouldDuckAndroid: true,
            });

            // 2. Stop any existing playback
            await this.stop();

            // 3. Split text into chunks
            const chunks = this.chunkText(text, 300);
            let currentChunkIndex = startIndex;

            const speakNext = () => {
                if (currentChunkIndex < chunks.length && !this.isPlayingAI) {
                    const chunk = chunks[currentChunkIndex];
                    if (onChunkStart) {
                        onChunkStart(currentChunkIndex, chunks.length, chunks);
                    }

                    // Set audio mode before speaking (non-blocking)
                    Audio.setAudioModeAsync({
                        allowsRecordingIOS: false,
                        playsInSilentModeIOS: true,
                        staysActiveInBackground: false,
                        shouldDuckAndroid: true,
                    }).catch(e => {
                        console.warn('[AudioService] Audio mode set warning:', e);
                    });

                    // Determine language code - thử nhiều options cho tiếng Việt
                    let langCode: string;
                    if (language === 'en') {
                        langCode = 'en-US';
                    } else {
                        // iOS thường dùng 'vi-VN', Android có thể dùng 'vi'
                        langCode = 'vi-VN'; // iOS thường cần 'vi-VN'
                    }
                    
                    console.log(`[AudioService] Using language code: ${langCode} for language: ${language}`);

                    Speech.speak(chunk, {
                        language: langCode,
                        pitch: 1.0,
                        rate: speechRate,
                        volume: 1.0, // Đảm bảo volume tối đa
                        onStart: () => {
                            console.log(`[AudioService] Speaking chunk ${currentChunkIndex + 1}/${chunks.length} with language ${langCode}`);
                        },
                        onDone: () => {
                            currentChunkIndex++;
                            speakNext();
                        },
                        onStopped: () => {
                            console.log('[AudioService] Speech stopped');
                            this.isPlaying = false;
                        },
                        onError: (error) => {
                            console.error('[AudioService] Speech Error:', error);
                            this.isPlaying = false;
                        }
                    });
                    
                    this.isPlaying = true;
                } else {
                    console.log('[AudioService] Finished reading all chunks');
                    this.isPlaying = false;
                }
            };

            // 4. Start first chunk
            speakNext();
        } catch (error) {
            console.error('[AudioService] TTS error:', error);
            this.isPlaying = false;
        }
    }

    /**
     * Thay đổi tốc độ đọc
     */
    setRate(rate: number) {
        // Clamp rate between 0.25 and 2.0
        this.currentRate = Math.max(0.25, Math.min(2.0, rate));
        console.log(`[AudioService] Rate set to: ${this.currentRate}`);
    }

    /**
     * Tăng tốc độ
     */
    increaseRate(step: number = 0.25) {
        this.setRate(this.currentRate + step);
    }

    /**
     * Giảm tốc độ
     */
    decreaseRate(step: number = 0.25) {
        this.setRate(this.currentRate - step);
    }

    getRate(): number {
        return this.currentRate;
    }

    getIsPlaying(): boolean {
        return this.isPlaying || this.isPlayingAI;
    }

    /**
     * Restart với tốc độ mới
     */
    async restartWithNewRate(onChunkStart?: (index: number, total: number, chunks: string[]) => void, startIndex: number = 0) {
        if (this.currentText && !this.isPlayingAI) {
            const wasPlaying = this.isPlaying;
            await this.stop();
            if (wasPlaying) {
                await this.speak(this.currentText, this.currentLanguage, onChunkStart, startIndex, this.currentRate);
            }
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

            // If voice changed, clear cache to avoid using old voice audio
            if (this.currentAIVoice && this.currentAIVoice !== voice) {
                console.log(`[AudioService] Voice changed from ${this.currentAIVoice} to ${voice}, clearing cache`);
                this.prefetchMap.clear();
            }

            await this.stop();
            // Wait a bit to ensure audio is fully stopped
            await new Promise(resolve => setTimeout(resolve, 100));
            
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
            this.isPlaying = false;
        } catch (error) {
            console.error('[AudioService] Pause error:', error);
            this.isPlaying = false;
        }
    }

    async resume() {
        console.log('[AudioService] Resuming playback');
        this.isPaused = false;
        try {
            if (this.sound) {
                await this.sound.playAsync();
                this.isPlaying = true;
            }
            if (Platform.OS === 'ios') {
                await Speech.resume();
                this.isPlaying = true;
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
            console.log('[AudioService] Stopping speech...');
            if (this.sound) {
                await this.sound.stopAsync();
                await this.sound.unloadAsync();
                this.sound = null;
            }
            // Stop tất cả speech đang phát
            await Speech.stop();
            this.isPlaying = false;
            console.log('[AudioService] Speech stopped successfully');
        } catch (error) {
            console.error('[AudioService] Stop error:', error);
            this.isPlaying = false;
            // Force stop nếu có lỗi
            try {
                await Speech.stop();
            } catch (e) {
                console.error('[AudioService] Force stop error:', e);
            }
        }
    }
}

export const audioService = new AudioService();
