import { openAIService } from './OpenAIService';
import { voiceService } from './VoiceService';

export interface VoiceCommand {
    intent: 'play' | 'pause' | 'speed' | 'summarize' | 'navigation' | 'volume' | 'voice' | 'unknown';
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

            // 5. Phân tích và trích xuất command bằng AI (tự nhiên hơn)
            let command = await this.parseCommandWithAI(transcript);
            
            // Fallback về regex nếu AI không parse được
            if (!command || command.intent === 'unknown') {
                console.log('[VoiceCommand] AI parsing failed or returned unknown, falling back to regex');
                command = this.parseCommand(transcript);
            }
            
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
     * Phân tích text và trích xuất command bằng AI (GPT)
     */
    async parseCommandWithAI(text: string): Promise<VoiceCommand | null> {
        try {
            const systemPrompt = `Bạn là một AI assistant chuyên phân tích lệnh giọng nói cho ứng dụng audiobook.
Nhiệm vụ của bạn là phân tích câu nói của người dùng và trả về lệnh dưới dạng JSON.

Các loại lệnh có thể:
1. play - Bắt đầu phát/đọc sách (ví dụ: "bắt đầu", "phát đi", "đọc cho tôi nghe", "mở sách lên")
2. pause - Dừng phát (ví dụ: "dừng lại", "tạm dừng", "ngừng đọc", "dừng đi")
3. speed - Điều chỉnh tốc độ:
   - increase: Tăng tốc (ví dụ: "nói nhanh hơn", "tăng tốc độ", "đọc nhanh lên", "tăng lên")
   - decrease: Giảm tốc (ví dụ: "nói chậm lại", "giảm tốc", "đọc chậm hơn", "chậm lại")
   - set: Đặt tốc độ cụ thể (ví dụ: "tốc độ 1.5", "đọc với tốc độ 2", "tốc độ bình thường")
4. summarize - Tóm tắt:
   - chapter: Tóm tắt chương hiện tại (ví dụ: "tóm tắt chương này", "tóm tắt chương", "tóm tắt phần này")
   - book: Tóm tắt toàn bộ sách (ví dụ: "tóm tắt sách", "tóm tắt cuốn sách", "tóm tắt toàn bộ")
5. navigation - Điều hướng:
   - next: Chương tiếp theo (ví dụ: "chương sau", "tiếp theo", "sang chương tiếp", "chuyển sang chương sau")
   - previous: Chương trước (ví dụ: "chương trước", "quay lại", "lùi lại", "chương trước đó")
   - goto: Đến chương cụ thể (ví dụ: "chương 5", "đến chương 3", "nhảy đến chương 10", "về lại chương 5")
       LƯU Ý: Với goto, value phải là số chương thực tế mà người dùng nói (1-indexed). Ví dụ: "chương 5" thì value là 5, "chương 3" thì value là 3.
6. volume - Điều chỉnh âm lượng:
   - increase: Tăng âm lượng (ví dụ: "to hơn", "tăng âm lượng", "lớn tiếng hơn", "to lên", "âm lượng to hơn", "to", "lớn tiếng", "tăng âm", "âm lượng lớn hơn", "to ra")
   - decrease: Giảm âm lượng (ví dụ: "nhỏ hơn", "giảm âm lượng", "nhỏ tiếng hơn", "nhỏ lại", "âm lượng nhỏ hơn", "nhỏ", "nhỏ tiếng", "giảm âm", "âm lượng nhỏ hơn", "nhỏ xuống")
   - set: Đặt âm lượng cụ thể (ví dụ: "âm lượng 50", "âm lượng 80 phần trăm", "âm lượng tối đa", "âm lượng bình thường", "âm lượng 100", "âm lượng 0")
       LƯU Ý: Với set, value phải là số từ 0-100 (phần trăm). Ví dụ: "âm lượng 50" thì value là 50, "âm lượng 80 phần trăm" thì value là 80, "âm lượng tối đa" thì value là 100.
7. voice - Đổi giọng AI:
   - change: Đổi sang giọng AI khác (ví dụ: "đổi sang giọng đọc khác", "đổi giọng", "giọng khác", "chuyển giọng", "đổi giọng đọc", "giọng đọc khác", "thay đổi giọng", "đổi sang giọng khác", "chuyển sang giọng khác")
       LƯU Ý: Với voice change, không cần value. Hệ thống sẽ tự động chọn một giọng AI khác với giọng hiện tại.

Trả về JSON với format:
{
  "intent": "play|pause|speed|summarize|navigation|volume|voice|unknown",
  "action": "start|stop|increase|decrease|set|chapter|book|next|previous|goto|change",
  "value": số hoặc chuỗi (nếu có, ví dụ: tốc độ 1.5 thì value là 1.5, chương 5 thì value là 5 (số chương thực tế, không phải 0-indexed), âm lượng 50 thì value là 50),
  "confidence": 0.0-1.0
}

Chỉ trả về JSON, không có text khác.`;

            const userPrompt = `Phân tích lệnh sau và trả về JSON: "${text}"`;

            const response = await openAIService.chatCompletion([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ], {
                model: 'gpt-3.5-turbo',
                max_tokens: 200,
                temperature: 0.3 // Lower temperature for more consistent results
            });

            console.log('[VoiceCommand] AI Response:', response);

            // Parse JSON response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                
                // Validate and normalize
                const command: VoiceCommand = {
                    intent: parsed.intent || 'unknown',
                    action: parsed.action || 'unknown',
                    value: parsed.value,
                    confidence: parsed.confidence || 0.8,
                    originalText: text
                };

                    // Validate intent
                    const validIntents = ['play', 'pause', 'speed', 'summarize', 'navigation', 'volume', 'voice', 'unknown'];
                    if (!validIntents.includes(command.intent)) {
                        command.intent = 'unknown';
                    }

                // Handle navigation goto - convert to 0-indexed
                if (command.intent === 'navigation' && command.action === 'goto' && typeof command.value === 'number') {
                    command.value = Math.max(0, command.value - 1);
                }

                // Handle speed value validation
                if (command.intent === 'speed' && command.action === 'set' && typeof command.value === 'number') {
                    command.value = Math.max(0.25, Math.min(2.0, command.value));
                }

                // Handle volume value validation
                if (command.intent === 'volume' && command.action === 'set' && typeof command.value === 'number') {
                    command.value = Math.max(0, Math.min(100, command.value));
                }

                console.log('[VoiceCommand] Parsed command:', command);
                return command;
            }

            return null;
        } catch (error: any) {
            console.error('[VoiceCommand] AI parsing error:', error);
            return null;
        }
    }

    /**
     * Phân tích text và trích xuất command (fallback với regex)
     */
    parseCommand(text: string): VoiceCommand {
        const lowerText = text.toLowerCase().trim();

        // Check play - mở rộng patterns
        if (this.patterns.play.vi.some(p => p.test(lowerText)) ||
            this.patterns.play.en.some(p => p.test(lowerText)) ||
            /bắt đầu|mở|phát đi|đọc cho|đọc đi|chơi đi|bật/i.test(lowerText)) {
            return {
                intent: 'play',
                action: 'start',
                confidence: 0.9,
                originalText: text
            };
        }

        // Check pause - mở rộng patterns
        if (this.patterns.pause.vi.some(p => p.test(lowerText)) ||
            this.patterns.pause.en.some(p => p.test(lowerText)) ||
            /dừng|ngừng|tắt|dừng lại|tạm dừng|dừng đi|ngừng đi/i.test(lowerText)) {
            return {
                intent: 'pause',
                action: 'stop',
                confidence: 0.9,
                originalText: text
            };
        }

        // Check speed increase - mở rộng patterns
        if (this.patterns.speed.increase.vi.some(p => p.test(lowerText)) ||
            this.patterns.speed.increase.en.some(p => p.test(lowerText)) ||
            /nhanh hơn|tăng lên|nhanh lên|đọc nhanh|tăng tốc|nhanh|tăng/i.test(lowerText)) {
            return {
                intent: 'speed',
                action: 'increase',
                value: 0.25,
                confidence: 0.85,
                originalText: text
            };
        }

        // Check speed decrease - mở rộng patterns
        if (this.patterns.speed.decrease.vi.some(p => p.test(lowerText)) ||
            this.patterns.speed.decrease.en.some(p => p.test(lowerText)) ||
            /chậm lại|giảm xuống|chậm hơn|đọc chậm|giảm tốc|chậm|giảm/i.test(lowerText)) {
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

        // Check navigation next - mở rộng patterns
        if (this.patterns.navigation.next.vi.some(p => p.test(lowerText)) ||
            this.patterns.navigation.next.en.some(p => p.test(lowerText)) ||
            /sang chương sau|chuyển sang|tiếp|sau|tiếp tục|chương tiếp|sang tiếp/i.test(lowerText)) {
            return {
                intent: 'navigation',
                action: 'next',
                confidence: 0.9,
                originalText: text
            };
        }

        // Check navigation previous - mở rộng patterns
        if (this.patterns.navigation.previous.vi.some(p => p.test(lowerText)) ||
            this.patterns.navigation.previous.en.some(p => p.test(lowerText)) ||
            /quay lại|lùi lại|chương trước|trước|về trước|quay về/i.test(lowerText)) {
            return {
                intent: 'navigation',
                action: 'previous',
                confidence: 0.9,
                originalText: text
            };
        }

        // Check navigation goto - support various patterns including "về lại chương X", "đến chương X", etc.
        const chapterMatch = lowerText.match(/(?:về lại|đến|nhảy đến|chuyển đến|chuyển tới|chuyển sang|sang|tới)\s*chương\s*(\d+)|chương\s*(\d+)|chapter\s*(\d+)/i);
        if (chapterMatch) {
            const chapterNum = parseInt(chapterMatch[1] || chapterMatch[2] || chapterMatch[3]);
            if (chapterNum > 0) {
                return {
                    intent: 'navigation',
                    action: 'goto',
                    value: chapterNum - 1, // Convert to 0-indexed (chương 5 -> index 4)
                    confidence: 0.9,
                    originalText: text
                };
            }
        }

        // Check volume increase - mở rộng patterns
        if (/to hơn|tăng âm lượng|lớn tiếng hơn|to lên|âm lượng to hơn|tăng âm|to$|lớn tiếng|âm lượng lớn hơn|to ra|tăng âm lượng lên/i.test(lowerText)) {
            return {
                intent: 'volume',
                action: 'increase',
                value: 10, // Increase by 10%
                confidence: 0.85,
                originalText: text
            };
        }

        // Check volume decrease - mở rộng patterns
        if (/nhỏ hơn|giảm âm lượng|nhỏ tiếng hơn|nhỏ lại|âm lượng nhỏ hơn|giảm âm|nhỏ$|nhỏ tiếng|âm lượng nhỏ hơn|nhỏ xuống|giảm âm lượng xuống/i.test(lowerText)) {
            return {
                intent: 'volume',
                action: 'decrease',
                value: -10, // Decrease by 10%
                confidence: 0.85,
                originalText: text
            };
        }

        // Check volume set
        const volumeMatch = lowerText.match(/âm lượng (\d+)|volume (\d+)|âm lượng (\d+) phần trăm/i);
        if (volumeMatch) {
            const volume = parseInt(volumeMatch[1] || volumeMatch[2] || volumeMatch[3]);
            if (!isNaN(volume) && volume >= 0 && volume <= 100) {
                return {
                    intent: 'volume',
                    action: 'set',
                    value: volume,
                    confidence: 0.9,
                    originalText: text
                };
            }
        }

        // Check normal volume
        if (/âm lượng bình thường|âm lượng tối đa|volume max|volume normal/i.test(lowerText)) {
            const volume = /tối đa|max/i.test(lowerText) ? 100 : 75;
            return {
                intent: 'volume',
                action: 'set',
                value: volume,
                confidence: 0.9,
                originalText: text
            };
        }

        // Check voice change - đơn giản hóa, chỉ cần nói "đổi giọng" hoặc "giọng khác"
        if (/đổi sang giọng đọc khác|đổi giọng|giọng khác|chuyển giọng|đổi giọng đọc|giọng đọc khác|thay đổi giọng|đổi sang giọng khác|chuyển sang giọng khác/i.test(lowerText)) {
            return {
                intent: 'voice',
                action: 'change',
                confidence: 0.95,
                originalText: text
            };
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

