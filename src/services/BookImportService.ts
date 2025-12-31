import * as FileSystem from 'expo-file-system/legacy';
import { databaseService } from './DatabaseService';
import { epubParser } from './EpubParser';
import { Asset } from 'expo-asset';

const PREBUILT_DB_ASSET = require('../../assets/audiobook-prebuilt.db');

const BOOK_ASSETS: Record<string, any> = {
    'Anh Sang Thanh Pho - Loi Me.epub': require('../../assets/epub/Anh Sang Thanh Pho - Loi Me.epub'),
    'Đề thi Đẫm Máu - Lôi Mễ.epub': require('../../assets/epub/Đề thi Đẫm Máu - Lôi Mễ.epub'),
};

class BookImportService {
    async importLocalEpubs() {
        try {
            console.log('[BookImportService] Checking database status...');

            // 1. Check if we already have books in the database
            const existingBooks = await databaseService.getBooks();
            console.log(`[BookImportService] Current books in DB: ${existingBooks.length}`);
            if (existingBooks.length > 0) {
                console.log('[BookImportService] Database already initialized with books. Ready.');
                return;
            }

            console.log('[BookImportService] Database empty. Attempting to load pre-built database...');

            // 2. Try to load pre-built DB from assets
            try {
                const asset = Asset.fromModule(PREBUILT_DB_ASSET);
                await asset.downloadAsync();

                if (asset.localUri) {
                    // Directory paths to try
                    const dbDirs = [
                        FileSystem.documentDirectory + 'SQLite/',
                        FileSystem.documentDirectory + 'databases/'
                    ];

                    // MUST close connection before copying over the file
                    await databaseService.close();

                    for (const dir of dbDirs) {
                        try {
                            const dirInfo = await FileSystem.getInfoAsync(dir);
                            if (!dirInfo.exists) {
                                await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
                                console.log(`[BookImportService] Created directory: ${dir}`);
                            }

                            // Clean up any existing sidecar files (-wal, -shm) to prevent corruption/stale state
                            const sidecars = ['audiobook_v2.db-wal', 'audiobook_v2.db-shm'];
                            for (const s of sidecars) {
                                const sPath = dir + s;
                                const sInfo = await FileSystem.getInfoAsync(sPath);
                                if (sInfo.exists) await FileSystem.deleteAsync(sPath);
                            }

                            const path = dir + 'audiobook_v2.db';
                            console.log(`[BookImportService] Copying to: ${path}`);
                            await FileSystem.copyAsync({
                                from: asset.localUri,
                                to: path
                            });

                            const verify = await FileSystem.getInfoAsync(path);
                            if (verify.exists) {
                                console.log(`[BookImportService] Successfully copied to ${path} (${verify.size} bytes)`);
                                const files = await FileSystem.readDirectoryAsync(dir);
                                console.log(`[BookImportService] Files in ${dir}:`, files);
                            }
                        } catch (e) {
                            console.warn(`[BookImportService] Failed to copy to ${dir}:`, e);
                        }
                    }

                    // Small delay to ensure OS finishes file flushing
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    // Re-initialize database to use the new file
                    await databaseService.init(true);

                    const postVerifyBooks = await databaseService.getBooks();
                    console.log(`[BookImportService] Books found after restore: ${postVerifyBooks.length}`);
                    if (postVerifyBooks.length > 0) {
                        console.log('[BookImportService] Pre-built database loaded successfully!');
                    } else {
                        console.warn('[BookImportService] Pre-built database loaded but appears EMPTY.');
                    }
                    return;
                }
            } catch (copyErr) {
                console.error('[BookImportService] Failed to load pre-built DB, falling back to parsing:', copyErr);
            }

            // 3. Fallback: Parse ePubs if pre-built DB failed
            console.log('[BookImportService] Falling back to manual ePub parsing...');
            for (const [filename, assetModule] of Object.entries(BOOK_ASSETS)) {
                try {
                    const asset = Asset.fromModule(assetModule);
                    await asset.downloadAsync();
                    if (!asset.localUri) continue;

                    const epubData = await epubParser.parse(asset.localUri);
                    const bookId = await databaseService.insertBook({
                        title: epubData.title,
                        author: epubData.author,
                        language: 'vi',
                        description: `Bản dịch của ${epubData.title}`,
                        last_chapter_index: 0
                    });

                    for (let i = 0; i < epubData.chapters.length; i++) {
                        await databaseService.insertChapter({
                            book_id: bookId,
                            title: epubData.chapters[i].title,
                            content: epubData.chapters[i].content,
                            order_index: i
                        });
                    }
                } catch (err) {
                    console.error(`[BookImportService] Fallback import failed for ${filename}:`, err);
                }
            }
        } catch (error) {
            console.error('[BookImportService] Global error:', error);
        }
    }

    async importExternalEpub(fileUri: string) {
        try {
            console.log(`[BookImportService] Importing external EPUB: ${fileUri}`);
            const epubData = await epubParser.parse(fileUri);

            const bookId = await databaseService.insertBook({
                title: epubData.title,
                author: epubData.author || 'Chưa rõ tác giả',
                language: 'vi',
                description: `Sách tải lên: ${epubData.title}`,
                last_chapter_index: 0
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
            return bookId;
        } catch (error) {
            console.error('[BookImportService] External EPUB import failed:', error);
            throw error;
        }
    }
}

export const bookImportService = new BookImportService();
