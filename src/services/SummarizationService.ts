import { openAIService } from './OpenAIService';

class SummarizationService {
    /**
     * Tóm tắt một chương
     */
    async summarizeChapter(content: string, language: 'vi' | 'en' = 'vi'): Promise<string> {
        try {
            // Giới hạn content để tránh token limit
            const limitedContent = content.substring(0, 3000);
            
            const prompt = language === 'vi' 
                ? `Hãy tóm tắt ngắn gọn nội dung sau đây trong 3-5 câu, tập trung vào các điểm chính:\n\n${limitedContent}`
                : `Please summarize the following content in 3-5 sentences, focusing on key points:\n\n${limitedContent}`;

            const summary = await openAIService.chatCompletion([
                {
                    role: 'user',
                    content: prompt
                }
            ], {
                model: 'gpt-3.5-turbo',
                max_tokens: 200,
                temperature: 0.7
            });

            return summary;
        } catch (error: any) {
            console.error('[SummarizationService] Error:', error.message || error);
            throw new Error('Không thể tạo tóm tắt. Vui lòng kiểm tra kết nối mạng và API key.');
        }
    }

    /**
     * Tóm tắt toàn bộ cuốn sách
     */
    async summarizeBook(
        chapters: Array<{ title: string; content: string }>, 
        language: 'vi' | 'en' = 'vi'
    ): Promise<string> {
        try {
            // Lấy nội dung từ tất cả các chương (giới hạn để tránh token limit)
            const allContent = chapters
                .slice(0, 10) // Chỉ lấy 10 chương đầu để tránh quá dài
                .map(ch => `Chương: ${ch.title}\n${ch.content.substring(0, 500)}`)
                .join('\n\n');

            const prompt = language === 'vi'
                ? `Hãy tóm tắt cuốn sách này trong 5-7 câu, tập trung vào cốt truyện chính và các nhân vật quan trọng:\n\n${allContent}`
                : `Please summarize this book in 5-7 sentences, focusing on the main plot and important characters:\n\n${allContent}`;

            const summary = await openAIService.chatCompletion([
                {
                    role: 'user',
                    content: prompt
                }
            ], {
                model: 'gpt-3.5-turbo',
                max_tokens: 300,
                temperature: 0.7
            });

            return summary;
        } catch (error: any) {
            console.error('[SummarizationService] Error:', error.message || error);
            throw new Error('Không thể tạo tóm tắt. Vui lòng kiểm tra kết nối mạng và API key.');
        }
    }
}

export const summarizationService = new SummarizationService();

