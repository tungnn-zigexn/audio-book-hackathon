import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';

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
                if (count?.c === 0) {
                     // Try a direct query to see if the table is truly empty
                     const raw = await database.getAllAsync('SELECT * FROM books');
                     console.log(`[DatabaseService] Raw books check count: ${raw.length}`);
                }
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
            [bookId]
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
}

export const databaseService = new DatabaseService();
