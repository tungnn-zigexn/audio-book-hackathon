import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Buffer } from 'buffer';

export interface Book {
    id: number;
    title: string;
    author: string;
    cover_uri?: string;
    language: string;
    description?: string;
    last_chapter_index: number;
}

export interface Chapter {
    id: number;
    book_id: number;
    title: string;
    content: string;
    order_index: number;
}

class DatabaseService {
    private db: SQLite.SQLiteDatabase | null = null;
    private initPromise: Promise<void> | null = null;

    async init(force: boolean = false) {
        if (this.initPromise && !force) return this.initPromise;

        this.initPromise = (async () => {
            console.log('[DatabaseService] Initializing database...');
            if (this.db) {
                try {
                    await this.db.closeAsync();
                } catch (e) {}
                this.db = null;
            }

            const dbName = 'audiobook_v2.db';
            const database = await SQLite.openDatabaseAsync(dbName);

            // Verification: Check version set by generator
            const version = await database.getFirstAsync<{user_version: number}>('PRAGMA user_version');
            console.log(`[DatabaseService] Connected to ${dbName}, user_version: ${version?.user_version}`);

            if (version?.user_version === 777) {
                console.log('[DatabaseService] SUCCESSFULLY identified pre-built database assets.');
            } else {
                console.warn('[DatabaseService] Opened database is NOT the pre-built asset (version mismatch).');
            }

            const tables = await database.getAllAsync<{name: string}>("SELECT name FROM sqlite_master WHERE type='table'");
            console.log('[DatabaseService] Tables existing:', tables.map(t => t.name).join(', '));

            if (tables.some(t => t.name === 'books')) {
                const count = await database.getFirstAsync<{c: number}>('SELECT COUNT(*) as c FROM books');
                console.log(`[DatabaseService] Current books count: ${count?.c}`);
            }

            // Migration: If audio_cache still uses file_uri, it's not portable.
            // We drop it once to force the new BLOB-based schema.
            const audioCacheInfo = await database.getAllAsync<{name: string}>("PRAGMA table_info(audio_cache)");
            if (audioCacheInfo.some(col => col.name === 'file_uri')) {
                console.log('[DatabaseService] Migrating audio_cache: dropping old file_uri table...');
                await database.execAsync('DROP TABLE audio_cache');
            }

            await database.execAsync(`
                PRAGMA journal_mode = DELETE;
                CREATE TABLE IF NOT EXISTS books (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    author TEXT,
                    cover_uri TEXT,
                    language TEXT DEFAULT 'vi',
                    description TEXT,
                    last_chapter_index INTEGER DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS chapters (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    book_id INTEGER,
                    title TEXT,
                    content TEXT,
                    order_index INTEGER,
                    FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS audio_cache (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chapter_id INTEGER,
                    chunk_index INTEGER,
                    voice TEXT,
                    data BLOB,
                    FOREIGN KEY (chapter_id) REFERENCES chapters (id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_audio_cache_lookup ON audio_cache (chapter_id, chunk_index, voice);
            `);

            // Final check after schema ensure
            const finalCount = await database.getFirstAsync<{c: number}>('SELECT COUNT(*) as c FROM books');
            console.log(`[DatabaseService] Post-init books count: ${finalCount?.c}`);

            this.db = database;
            console.log('[DatabaseService] Database ready');
        })();

        return this.initPromise;
    }

    async close() {
        if (this.db) {
            const tempDb = this.db;
            this.db = null; // Set to null FIRST to avoid NPE in concurrent calls
            this.initPromise = null;
            await tempDb.closeAsync();
        }
    }

    async getBooks(): Promise<Book[]> {
        await this.init();
        return await this.db!.getAllAsync<Book>('SELECT * FROM books');
    }

    async getChapters(bookId: number): Promise<Chapter[]> {
        await this.init();
        return await this.db!.getAllAsync<Chapter>(
            'SELECT * FROM chapters WHERE book_id = ? ORDER BY order_index ASC',
            bookId
        );
    }

    async insertBook(book: Omit<Book, 'id'>): Promise<number> {
        await this.init();
        const params = [
            String(book.title ?? 'Chưa rõ tiêu đề'),
            String(book.author ?? 'Chưa rõ tác giả'),
            String(book.cover_uri ?? ''),
            String(book.language ?? 'vi'),
            String(book.description ?? ''),
            book.last_chapter_index ?? 0
        ];

        const result = await this.db!.runAsync(
            'INSERT INTO books (title, author, cover_uri, language, description, last_chapter_index) VALUES (?, ?, ?, ?, ?, ?)',
            ...params
        );
        return result.lastInsertRowId;
    }

    async insertChapter(chapter: Omit<Chapter, 'id'>) {
        await this.init();
        await this.db!.runAsync(
            'INSERT INTO chapters (book_id, title, content, order_index) VALUES (?, ?, ?, ?)',
            chapter.book_id,
            String(chapter.title ?? 'Untitled Chapter'),
            String(chapter.content ?? ''),
            chapter.order_index ?? 0
        );
    }

    async updateBookProgress(bookId: number, chapterIndex: number) {
        await this.init();
        await this.db!.runAsync(
            'UPDATE books SET last_chapter_index = ? WHERE id = ?',
            chapterIndex,
            bookId
        );
    }

    async updateBookCover(bookId: number, coverUri: string) {
        await this.init();
        await this.db!.runAsync(
            'UPDATE books SET cover_uri = ? WHERE id = ?',
            coverUri,
            bookId
        );
    }

    /**
     * Get cached audio URI if exists
     */
    async getCachedAudio(chapterId: number, chunkIndex: number, voice: string): Promise<string | null> {
        await this.init();
        const row = await this.db!.getFirstAsync<{data: Uint8Array}>(
            'SELECT data FROM audio_cache WHERE chapter_id = ? AND chunk_index = ? AND voice = ?',
            chapterId, chunkIndex, voice
        );

        if (row && row.data) {
            try {
                // To play audio, expo-av needs a file URI.
                // We extract the BLOB to a temporary cache file.
                const tempDir = FileSystem.cacheDirectory + 'audio_temp/';
                const dirInfo = await FileSystem.getInfoAsync(tempDir);
                if (!dirInfo.exists) {
                    await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });
                }

                const tempFile = tempDir + `${chapterId}_${chunkIndex}_${voice}.mp3`;
                const base64 = Buffer.from(row.data).toString('base64');
                await FileSystem.writeAsStringAsync(tempFile, base64, { encoding: FileSystem.EncodingType.Base64 });

                return tempFile;
            } catch (e) {
                console.error('[DatabaseService] Failed to extract audio BLOB to temp file:', e);
            }
        }
        return null;
    }

    /**
     * Save audio to persistent cache (SQLite + Document Directory)
     * Limit to 2 voices per chunk
     */
    async saveCachedAudio(chapterId: number, chunkIndex: number, voice: string, sourceUri: string): Promise<string | null> {
        if (!sourceUri || !chapterId) {
            console.warn('[DatabaseService] saveCachedAudio: Missing required data', { chapterId, sourceUri });
            return null;
        }

        await this.init();

        try {
            // 1. Check current voice count for this chunk
            const countRow = await this.db!.getFirstAsync<{c: number}>(
                'SELECT COUNT(DISTINCT voice) as c FROM audio_cache WHERE chapter_id = ? AND chunk_index = ?',
                chapterId, chunkIndex
            );

            const voiceCount = countRow?.c || 0;

            // 2. If already have 2 different voices AND this is a NEW voice, don't persist
            const existingVoice = await this.db!.getFirstAsync<{id: number}>(
                'SELECT id FROM audio_cache WHERE chapter_id = ? AND chunk_index = ? AND voice = ?',
                chapterId, chunkIndex, voice
            );

            if (voiceCount >= 2 && !existingVoice) {
                console.log(`[DatabaseService] Cache quota reached for chapter ${chapterId} chunk ${chunkIndex}. Not persisting third voice.`);
                return null;
            }

            // 3. Read audio file as binary
            const base64 = await FileSystem.readAsStringAsync(sourceUri, { encoding: FileSystem.EncodingType.Base64 });
            const binaryData = new Uint8Array(Buffer.from(base64, 'base64'));

            // 4. Update DB (store BLOB directly)
            if (existingVoice) {
                await this.db!.runAsync(
                    'UPDATE audio_cache SET data = ? WHERE chapter_id = ? AND chunk_index = ? AND voice = ?',
                    binaryData, chapterId, chunkIndex, voice
                );
            } else {
                await this.db!.runAsync(
                    'INSERT INTO audio_cache (chapter_id, chunk_index, voice, data) VALUES (?, ?, ?, ?)',
                    chapterId, chunkIndex, voice, binaryData
                );
            }

            console.log(`[DatabaseService] Saved audio BLOB to DB: ch${chapterId}_idx${chunkIndex}_${voice} (${binaryData.length} bytes)`);

            // Return the original URI so the player can continue playing without waiting for a re-extraction
            return sourceUri;
        } catch (error) {
            console.error('[DatabaseService] saveCachedAudio failed:', error);
            return null;
        }
    }

    async clearBooks() {
        await this.close();

        const filenames = ['audiobook_v2.db', 'audiobook_v2.db-wal', 'audiobook_v2.db-shm'];
        const dirs = [
            FileSystem.documentDirectory + 'SQLite/',
            FileSystem.documentDirectory + 'databases/'
        ];

        for (const dir of dirs) {
            for (const file of filenames) {
                try {
                    const path = dir + file;
                    const info = await FileSystem.getInfoAsync(path);
                    if (info.exists) {
                        await FileSystem.deleteAsync(path, { idempotent: true });
                        console.log(`[DatabaseService] Deleted: ${path}`);
                    }
                } catch (e) {}
            }
        }

        try {
            await SQLite.deleteDatabaseAsync('audiobook_v2.db');
            console.log('[DatabaseService] deleteDatabaseAsync audiobook_v2.db completed');
        } catch (e) {}
    }

    async deleteBook(bookId: number) {
        await this.init();
        await this.db!.withTransactionAsync(async () => {
            // 1. Delete all audio cache for this book
            await this.db!.runAsync(
                'DELETE FROM audio_cache WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id = ?)',
                bookId
            );
            // 2. Delete all chapters
            await this.db!.runAsync('DELETE FROM chapters WHERE book_id = ?', bookId);
            // 3. Delete the book record
            await this.db!.runAsync('DELETE FROM books WHERE id = ?', bookId);
        });
        console.log(`[DatabaseService] Book ${bookId} deleted.`);
    }

    async clearAllData() {
        await this.init();
        await this.db!.execAsync('DELETE FROM audio_cache');
        await this.db!.execAsync('DELETE FROM chapters');
        await this.db!.execAsync('DELETE FROM books');
        console.log('[DatabaseService] Database cleared');
    }

    /**
     * Create a fast snapshot for cloud sync (no VACUUM)
     * Using copyAsync is much faster than VACUUM for background sync
     */
    async getSyncSnapshot(): Promise<string> {
        await this.init();
        const dbPath = FileSystem.documentDirectory + 'SQLite/audiobook_v2.db';
        const snapshotPath = FileSystem.cacheDirectory + 'sync_snapshot.db';

        try {
            // Close DB briefly or rely on OS to handle the copy of the file
            // Since we are in WAL mode, a simple copy is usually safe
            await FileSystem.copyAsync({
                from: dbPath,
                to: snapshotPath
            });
            console.log('[DatabaseService] Sync snapshot created at:', snapshotPath);
            return snapshotPath;
        } catch (error) {
            console.error('[DatabaseService] Failed to create sync snapshot:', error);
            return dbPath; // Fallback to original path
        }
    }

    /**
     * VACUUM the database to reduce size and prepare for export
     */
    async vacuumAndExport(): Promise<string> {
        await this.init();
        console.log('[DatabaseService] Vacuuming database...');
        try {
            await this.db!.execAsync('VACUUM;');
            console.log('[DatabaseService] Database vacuumed');
        } catch (e) {
            console.warn('[DatabaseService] Vacuum failed (likely busy):', e);
        }

        const dbPath = FileSystem.documentDirectory + 'SQLite/audiobook_v2.db';
        return dbPath;
    }

    /**
     * Share the database file using the system share sheet
     */
    async shareDatabase(): Promise<void> {
        try {
            const dbPath = await this.vacuumAndExport();
            if (!(await Sharing.isAvailableAsync())) {
                throw new Error('Chia sẻ không khả dụng trên thiết bị này');
            }
            await Sharing.shareAsync(dbPath, {
                mimeType: 'application/x-sqlite3',
                dialogTitle: 'Xuất Database Audiobook',
                UTI: 'public.database'
            });
        } catch (error: any) {
            console.error('[DatabaseService] Export failed:', error);
            throw error;
        }
    }
}

export const databaseService = new DatabaseService();
