import * as FileSystem from 'expo-file-system/legacy';
import { databaseService } from './DatabaseService';
import { epubParser } from './EpubParser';
import { Asset } from 'expo-asset';

const BOOK_ASSETS: Record<string, any> = {
    'Anh Sang Thanh Pho - Loi Me.epub': require('../../assets/epub/Anh Sang Thanh Pho - Loi Me.epub'),
    'TÂM LÝ TỘI PHẠM - Lôi Mễ.epub': require('../../assets/epub/TÂM LÝ TỘI PHẠM - Lôi Mễ.epub'),
    'Đề thi Đẫm Máu - Lôi Mễ.epub': require('../../assets/epub/Đề thi Đẫm Máu - Lôi Mễ.epub'),
};

class BookImportService {
    async importLocalEpubs() {
        try {
            console.log('[BookImportService] Starting import process...');

            // Clear old books for consistency
            await databaseService.clearBooks();

            // Check if we already have books
            const existingBooks = await databaseService.getBooks();
            if (existingBooks.length >= 3) {
                console.log('[BookImportService] Books already imported');
                return;
            }

            for (const [filename, assetModule] of Object.entries(BOOK_ASSETS)) {
                try {
                    console.log(`[BookImportService] Loading asset: ${filename}...`);

                    // 1. Resolve asset
                    const asset = Asset.fromModule(assetModule);
                    await asset.downloadAsync();

                    if (!asset.localUri) {
                        throw new Error(`Could not resolve local URI for ${filename}`);
                    }

                    console.log(`[BookImportService] Parsing ${filename} from ${asset.localUri}...`);
                    const epubData = await epubParser.parse(asset.localUri);

                    const bookId = await databaseService.insertBook({
                        title: epubData.title,
                        author: epubData.author,
                        language: 'vi',
                        description: `Bản dịch tiếng Việt của bộ sách ${epubData.title}`
                    });

                    for (let i = 0; i < epubData.chapters.length; i++) {
                        await databaseService.insertChapter({
                            book_id: bookId,
                            title: epubData.chapters[i].title,
                            content: epubData.chapters[i].content,
                            order_index: i
                        });
                    }
                    console.log(`[BookImportService] Successfully imported: ${epubData.title}`);
                } catch (err) {
                    console.error(`[BookImportService] Failed to import ${filename}:`, err);
                }
            }
        } catch (error) {
            console.error('[BookImportService] Global error:', error);
        }
    }
}

export const bookImportService = new BookImportService();
