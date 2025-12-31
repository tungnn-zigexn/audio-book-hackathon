import { openAIService } from './OpenAIService';
import { databaseService } from './DatabaseService';

class CoverImageService {
    /**
     * Generate a cover for a book and update the database
     */
    async generateForBook(bookId: number, title: string, author: string) {
        try {
            console.log(`[CoverImageService] Generating cover for book: ${title} by ${author}`);

            // Construct a professional prompt for DALL-E 3
            const prompt = `A professional, high-quality book cover for a book titled "${title}" by ${author}.
            The style should be modern, artistic, and evocative.
            NO text on the image except maybe stylized title if appropriate.
            Vibrant colors, cinematic lighting, 3D digital art style.
            The cover should represent the mood of a compelling story.`;

            const localUri = await openAIService.generateImage(prompt);

            if (localUri) {
                await databaseService.updateBookCover(bookId, localUri);
                console.log(`[CoverImageService] Successfully updated cover for book ${bookId}`);
                return localUri;
            }
        } catch (error) {
            console.error('[CoverImageService] Failed to generate for book:', error);
            // Don't throw, just log. Cover generation is a non-critical enhancement.
        }
        return null;
    }
}

export const coverImageService = new CoverImageService();
