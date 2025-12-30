import { openAIService } from './OpenAIService';
import { voiceService } from './VoiceService';

export interface VoiceCommand {
    intent: 'play' | 'pause' | 'speed' | 'summarize' | 'navigation' | 'unknown';
    action: string;
    value?: number | string;
    confidence: number;
    originalText?: string;
}

class VoiceCommandProcessor {
    private patterns = {
        play: {
            vi: [/phát|bắt đầu|đọc|tiếp tục|chơi/i],
            en: [/play|start|read|continue/i]
        },
        pause: {
            vi: [/dừng|tạm dừng|ngừng|dừng lại/i],
            en: [/pause|stop|halt/i]
        },
        speed: {
            increase: {
                vi: [/nói nhanh|tăng tốc|nhanh hơn|tăng tốc độ/i],
                en: [/faster|speed up|increase speed/i]
            },
            decrease: {
                vi: [/nói chậm|giảm tốc|chậm hơn|giảm tốc độ/i],
                en: [/slower|speed down|decrease speed/i]
            },
            set: {
                vi: [/tốc độ (\d+\.?\d*)|tốc độ bình thường|tốc độ (\d+)/i],
                en: [/speed (\d+\.?\d*)|normal speed|rate (\d+\.?\d*)/i]
            }
        },
        summarize: {
            chapter: {
                vi: [/tóm tắt chương|tóm tắt chương này|tóm tắt/i],
                en: [/summarize chapter|chapter summary/i]
            },
            book: {
                vi: [/tóm tắt sách|tóm tắt cuốn sách|tóm tắt toàn bộ/i],
                en: [/summarize book|book summary/i]
            }
        },
        navigation: {
            next: {
                vi: [/tiếp theo|chương sau|sau đó|chương tiếp/i],
                en: [/next|next chapter/i]
            },
            previous: {
                vi: [/quay lại|chương trước|trước đó|chương trước đó/i],
                en: [/previous|previous chapter|back/i]
            },
            goto: {
                vi: [/chương (\d+)|đến chương (\d+)|chuyển đến chương (\d+)/i],
                en: [/chapter (\d+)|go to chapter (\d+)/i]
            }
        }
    };

    /**
     * Xử lý voice command từ audio recording
     */
    async processVoiceCommand(recordingDuration: number = 3000): Promise<VoiceCommand | null> {
        try {
            // 1. Bắt đầu ghi âm
            const started = await voiceService.startRecording();
            if (!started) {
                return null;
            }

            // 2. Đợi người dùng nói
            await new Promise(resolve => setTimeout(resolve, recordingDuration));

            // 3. Dừng ghi âm và lấy file
            const audioUri = await voiceService.stopRecording();
            if (!audioUri) {
                return null;
            }

            // 4. Chuyển giọng nói thành text (Whisper)
            const transcript = await openAIService.transcribeAudio(audioUri);
            console.log('[VoiceCommand] Transcript:', transcript);

            if (!transcript || transcript.trim().length === 0) {
                return null;
            }

            // 5. Phân tích và trích xuất command
            const command = this.parseCommand(transcript);
            command.originalText = transcript;
            return command;

        } catch (error: any) {
            console.error('[VoiceCommand] Error:', error.message || error);
            // Cleanup nếu có lỗi
            await voiceService.cancelRecording();
            return null;
        }
    }

    /**
     * Phân tích text và trích xuất command
     */
    parseCommand(text: string): VoiceCommand {
        const lowerText = text.toLowerCase().trim();

        // Check play
        if (this.patterns.play.vi.some(p => p.test(lowerText)) ||
            this.patterns.play.en.some(p => p.test(lowerText))) {
            return {
                intent: 'play',
                action: 'start',
                confidence: 0.9,
                originalText: text
            };
        }

        // Check pause
        if (this.patterns.pause.vi.some(p => p.test(lowerText)) ||
            this.patterns.pause.en.some(p => p.test(lowerText))) {
            return {
                intent: 'pause',
                action: 'stop',
                confidence: 0.9,
                originalText: text
            };
        }

        // Check speed increase
        if (this.patterns.speed.increase.vi.some(p => p.test(lowerText)) ||
            this.patterns.speed.increase.en.some(p => p.test(lowerText))) {
            return {
                intent: 'speed',
                action: 'increase',
                value: 0.25,
                confidence: 0.85,
                originalText: text
            };
        }

        // Check speed decrease
        if (this.patterns.speed.decrease.vi.some(p => p.test(lowerText)) ||
            this.patterns.speed.decrease.en.some(p => p.test(lowerText))) {
            return {
                intent: 'speed',
                action: 'decrease',
                value: -0.25,
                confidence: 0.85,
                originalText: text
            };
        }

        // Check speed set
        const speedMatch = lowerText.match(/tốc độ (\d+\.?\d*)|speed (\d+\.?\d*)|rate (\d+\.?\d*)/i);
        if (speedMatch) {
            const speed = parseFloat(speedMatch[1]);
            if (speed >= 0.25 && speed <= 2.0) {
                return {
                    intent: 'speed',
                    action: 'set',
                    value: speed,
                    confidence: 0.9,
                    originalText: text
                };
            }
        }

        // Check normal speed
        if (/tốc độ bình thường|normal speed/i.test(lowerText)) {
            return {
                intent: 'speed',
                action: 'set',
                value: 1.0,
                confidence: 0.9,
                originalText: text
            };
        }

        // Check summarize chapter
        if (this.patterns.summarize.chapter.vi.some(p => p.test(lowerText)) ||
            this.patterns.summarize.chapter.en.some(p => p.test(lowerText))) {
            return {
                intent: 'summarize',
                action: 'chapter',
                confidence: 0.85,
                originalText: text
            };
        }

        // Check summarize book
        if (this.patterns.summarize.book.vi.some(p => p.test(lowerText)) ||
            this.patterns.summarize.book.en.some(p => p.test(lowerText))) {
            return {
                intent: 'summarize',
                action: 'book',
                confidence: 0.85,
                originalText: text
            };
        }

        // Check navigation next
        if (this.patterns.navigation.next.vi.some(p => p.test(lowerText)) ||
            this.patterns.navigation.next.en.some(p => p.test(lowerText))) {
            return {
                intent: 'navigation',
                action: 'next',
                confidence: 0.9,
                originalText: text
            };
        }

        // Check navigation previous
        if (this.patterns.navigation.previous.vi.some(p => p.test(lowerText)) ||
            this.patterns.navigation.previous.en.some(p => p.test(lowerText))) {
            return {
                intent: 'navigation',
                action: 'previous',
                confidence: 0.9,
                originalText: text
            };
        }

        // Check navigation goto
        const chapterMatch = lowerText.match(/chương (\d+)|chapter (\d+)/i);
        if (chapterMatch) {
            const chapterNum = parseInt(chapterMatch[1] || chapterMatch[2]);
            if (chapterNum > 0) {
                return {
                    intent: 'navigation',
                    action: 'goto',
                    value: chapterNum - 1, // 0-indexed
                    confidence: 0.9,
                    originalText: text
                };
            }
        }

        return {
            intent: 'unknown',
            action: 'unknown',
            confidence: 0,
            originalText: text
        };
    }
}

export const voiceCommandProcessor = new VoiceCommandProcessor();

