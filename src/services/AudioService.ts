import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';

class AudioService {
    private sound: Audio.Sound | null = null;

    async speak(text: string, language: 'en' | 'vi', onChunkStart?: (index: number, total: number, chunks: string[]) => void) {
        try {
            console.log(`[AudioService] Using Local System TTS for ${language}`);

            // 1. Stop any existing playback
            await this.stop();

            // 2. Split text into chunks
            const chunks = this.chunkText(text, 300); // Smaller chunks for better sync
            let currentChunkIndex = 0;

            const speakNext = () => {
                if (currentChunkIndex < chunks.length) {
                    const chunk = chunks[currentChunkIndex];

                    if (onChunkStart) {
                        onChunkStart(currentChunkIndex, chunks.length, chunks);
                    }

                    Speech.speak(chunk, {
                        language: language === 'en' ? 'en-US' : 'vi-VN',
                        pitch: 1.0,
                        rate: 1.0,
                        onDone: () => {
                            currentChunkIndex++;
                            speakNext();
                        },
                        onStopped: () => {
                            console.log('[AudioService] Speech stopped');
                        },
                        onError: (error) => {
                            console.error('[AudioService] Speech Error:', error);
                        }
                    });
                } else {
                    console.log('[AudioService] Finished reading all chunks');
                }
            };

            // 3. Start first chunk
            speakNext();
        } catch (error) {
            console.error('[AudioService] TTS error:', error);
        }
    }

    public chunkText(text: string, size: number): string[] {
        const chunks: string[] = [];
        // Clean text but keep paragraph breaks for better chunking
        const cleanText = text.replace(/\s+/g, ' ').trim();
        let index = 0;

        while (index < cleanText.length) {
            let endIndex = index + size;

            if (endIndex < cleanText.length) {
                // Try to find the last sentence end or space within the chunk
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
        return chunks.filter(c => c.length > 0);
    }

    async stop() {
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
