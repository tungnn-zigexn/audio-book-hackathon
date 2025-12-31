import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import { Platform } from 'react-native';
import { openAIService, OpenAIVoice } from './OpenAIService';
import { databaseService } from './DatabaseService';

class AudioService {
    private sound: Audio.Sound | null = null;

    // AI Voice features
    private isPlayingAI = false;
    private isPaused = false;
    private currentAIVoice: OpenAIVoice | null = null;
    private lastPositionMillis: number = 0;
    private lastChapterId: number | null = null;
    private prefetchMap: Map<string, string> = new Map();
    private fetchingPromises: Map<string, Promise<string | undefined>> = new Map();
    private preferredVoices: OpenAIVoice[] = ['alloy', 'shimmer', 'nova', 'echo', 'onyx'];

    // Speed control features
    private currentRate: number = 1.0; // Tốc độ hiện tại (0.25 - 2.0)
    private currentVolume: number = 1.0; // Âm lượng hiện tại (0.0 - 1.0)
    private isPlaying: boolean = false;
    private currentLanguage: 'en' | 'vi' = 'vi';
    private currentText: string = '';
    private currentIndex: number = 0;
    private currentOnChunkStart?: (index: number, total: number, chunks: string[]) => void;

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
            this.currentIndex = startIndex;
            this.currentOnChunkStart = onChunkStart;

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
                        volume: this.currentVolume, // Sử dụng volume hiện tại
                        onStart: () => {
                            console.log(`[AudioService] Speaking chunk ${currentChunkIndex + 1}/${chunks.length} with language ${langCode}`);
                        },
                        onDone: () => {
                            currentChunkIndex++;
                            this.currentIndex = currentChunkIndex;
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

    async setRate(rate: number) {
        // Clamp rate between 0.25 and 2.0
        this.currentRate = Math.max(0.25, Math.min(2.0, rate));
        console.log(`[AudioService] Rate set to: ${this.currentRate}`);

        // Apply to current AI sound if playing
        if (this.sound) {
            try {
                await this.sound.setRateAsync(this.currentRate, true);
                console.log('[AudioService] Applied new rate to active AI sound');
            } catch (e) {
                console.warn('[AudioService] Could not set rate on active sound:', e);
            }
        }
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

    /**
     * Set volume (0.0 - 1.0)
     */
    setVolume(volume: number) {
        this.currentVolume = Math.max(0.0, Math.min(1.0, volume));
        console.log(`[AudioService] Volume set to: ${this.currentVolume}`);
        // Update volume of currently playing sound if exists
        if (this.sound && this.isPlayingAI) {
            this.sound.setVolumeAsync(this.currentVolume).catch(err => {
                console.warn('[AudioService] Failed to update volume:', err);
            });
        }
    }

    /**
     * Get current volume (0.0 - 1.0)
     */
    getVolume(): number {
        return this.currentVolume;
    }

    getIsPlaying(): boolean {
        // AI Voice is active even if paused (session wise) but we want to reflect ACTUALLY playing
        if (this.isPaused) return false;
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
        resumeMillis: number = 0,
        chapterId?: number
    ) {
        try {
            // If we are already paused on this session AND it's the same voice, just resume!
            if (this.isPaused && this.isPlayingAI && this.sound && this.currentAIVoice === voice) {
                console.log('[AudioService] Resuming existing AI session');
                await this.resume();
                return;
            }

            // Clear cache ONLY if chapter changed or text changed significantly
            if (chapterId && this.lastChapterId !== chapterId) {
                console.log(`[AudioService] Chapter changed from ${this.lastChapterId} to ${chapterId}, clearing cache`);
                this.prefetchMap.clear();
                this.lastChapterId = chapterId;
            } else if (!chapterId && text !== this.currentText) {
                console.log('[AudioService] Text changed without chapterId, clearing cache');
                this.prefetchMap.clear();
            }

            await this.stop();
            // Wait a bit to ensure audio is fully stopped
            await new Promise(resolve => setTimeout(resolve, 100));

            this.isPlayingAI = true;
            this.isPlaying = true;
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

            const fetchVoiceChunk = async (idx: number, v: OpenAIVoice): Promise<string | undefined> => {
                const key = `${v}_${idx}`;
                if (this.prefetchMap.has(key)) {
                    console.log(`[AudioService] [STEP 1: Memory Cache] HIT for ${key}`);
                    return this.prefetchMap.get(key);
                }

                // Deduplicate ongoing requests
                if (this.fetchingPromises.has(key)) {
                    // console.log(`[AudioService] Joining existing fetch for ${key}`);
                    return this.fetchingPromises.get(key);
                }

                const fetchPromise = (async () => {
                    try {
                        // 1. Check persistent DB cache first
                        if (chapterId) {
                            const cachedUri = await databaseService.getCachedAudio(chapterId, idx, v);
                            if (cachedUri) {
                                console.log(`[AudioService] [STEP 2: DB Cache] HIT for ${key}`);
                                this.prefetchMap.set(key, cachedUri);
                                return cachedUri;
                            }
                        }

                        // 2. API Fetch
                        console.log(`[AudioService] [STEP 3: API Request] Missing for ${key}, calling OpenAI...`);
                        const uri = await openAIService.synthesizeSpeech(chunks[idx], v);
                        this.prefetchMap.set(key, uri); // Temporary save to memory cache

                        // 3. Persist to DB (limited by 2-voice-per-chunk rule in DatabaseService)
                        if (chapterId) {
                            const savedUri = await databaseService.saveCachedAudio(chapterId, idx, v, uri);
                            if (savedUri) {
                                this.prefetchMap.set(key, savedUri);
                            }
                        }
                        return this.prefetchMap.get(key) || uri;
                    } catch (e) {
                        console.error(`[AudioService] Fetch failed for ${key}`, e);
                        return undefined;
                    } finally {
                        this.fetchingPromises.delete(key);
                    }
                })();

                this.fetchingPromises.set(key, fetchPromise);
                return fetchPromise;
            };

            const prefetchNext = async (idx: number) => {
                if (!this.isPlayingAI) return;

                // Priority 1: Current Voice for target index
                if (idx < chunks.length) fetchVoiceChunk(idx, voice);

                // Priority 2: Alternate voices for current and target index
                const currentIdx = idx - 1;
                this.preferredVoices.forEach(v => {
                    if (v !== voice) {
                        if (currentIdx >= 0 && currentIdx < chunks.length) fetchVoiceChunk(currentIdx, v);
                        if (idx < chunks.length) fetchVoiceChunk(idx, v);
                    }
                });
            };

            const playNextAIChunk = async () => {
                if (!this.isPlayingAI) return;

                if (currentIdx < chunks.length) {
                    if (onProgress) onProgress(`Đang tải đoạn ${currentIdx + 1}/${chunks.length}...`);
                    if (onChunkStart) onChunkStart(currentIdx, chunks.length, chunks);

                    const key = `${voice}_${currentIdx}`;
                    let audioUri = this.prefetchMap.get(key);
                    if (!audioUri) {
                        console.log(`[AudioService] Cache miss for ${key}, searching...`);
                        audioUri = await fetchVoiceChunk(currentIdx, voice);
                    } else {
                        console.log(`[AudioService] Memory cache HIT for ${key}`);
                    }

                    if (!this.isPlayingAI) return;

                    // Start prefetching the next one immediately
                    prefetchNext(currentIdx + 1);

                    console.log(`[AudioService] Creating sound for: ${audioUri}${resumeMillis > 0 ? ` at ${resumeMillis}ms` : ''}`);
                    const { sound } = await Audio.Sound.createAsync(
                        { uri: audioUri },
                        {
                            shouldPlay: true,
                            volume: this.currentVolume,
                            positionMillis: resumeMillis,
                            rate: this.currentRate,
                            shouldCorrectPitch: true,
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
                    this.isPlaying = false;
                }
            };

            // Initial prefetch: specifically fetch ALL preferred voices for current chunk
            // and the main voice for the next chunk
            this.preferredVoices.forEach(v => {
                fetchVoiceChunk(startIndex, v);
            });
            fetchVoiceChunk(startIndex + 1, voice);

            await playNextAIChunk();
        } catch (error) {
            console.error('[AudioService] OpenAI TTS error:', error);
            if (onProgress) onProgress('Lỗi khi nạp giọng đọc AI.');
            this.isPlayingAI = false;
            this.isPlaying = false;
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
            } else if (Platform.OS === 'android' && !this.sound && this.currentText) {
                // On Android, system Speech doesn't support resume. Restart from current index.
                console.log(`[AudioService] Android Local Resume: Restarting from chunk ${this.currentIndex}`);
                await this.speak(this.currentText, this.currentLanguage, this.currentOnChunkStart, this.currentIndex);
            }
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
        // NOTE: We no longer clear prefetchMap here to allow voice-switching to be instant
        try {
            console.log('[AudioService] Stopping speech...');
            if (this.sound) {
                try {
                    // Check if sound is loaded before trying to stop
                    const status = await this.sound.getStatusAsync();
                    if (status.isLoaded) {
                        await this.sound.stopAsync();
                        await this.sound.unloadAsync();
                    }
                } catch (soundError: any) {
                    // Ignore errors if sound is not loaded or already unloaded
                    if (soundError.message && !soundError.message.includes('not loaded')) {
                        console.warn('[AudioService] Error stopping sound:', soundError.message);
                    }
                }
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
