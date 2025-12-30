import * as SQLite from 'expo-sqlite';

export interface Book {
    id: number;
    title: string;
    author: string;
    cover_uri?: string;
    language: string;
    description?: string;
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

    async init() {
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            this.db = await SQLite.openDatabaseAsync('audiobook.db');
            await this.db.execAsync(`
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS books (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    author TEXT,
                    cover_uri TEXT,
                    language TEXT DEFAULT 'vi',
                    description TEXT
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
            console.log('[DatabaseService] Database initialized');
        })();

        return this.initPromise;
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
            String(book.title ?? 'Unknown Title'),
            String(book.author ?? 'Unknown Author'),
            String(book.cover_uri ?? ''),
            String(book.language ?? 'vi'),
            String(book.description ?? '')
        ];

        const result = await this.db!.runAsync(
            'INSERT INTO books (title, author, cover_uri, language, description) VALUES (?, ?, ?, ?, ?)',
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

    async clearBooks() {
        if (!this.db) await this.init();
        await this.db!.execAsync('DELETE FROM books');
        await this.db!.execAsync('DELETE FROM chapters');
    }
}

export const databaseService = new DatabaseService();
