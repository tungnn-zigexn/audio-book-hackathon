const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { XMLParser } = require('fast-xml-parser');
const Database = require('better-sqlite3');

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_"
});

const skipTitleKeywords = [
    'giới thiệu', 'mục lục', 'thông tin', 'bản quyền', 'loi mo dau', 'lời mở đầu', 'lời tựa', 'về tác giả',
    'tựa đề', 'trang tên', 'phụ lục', 'lời cảm ơn', 'loi cam on', 'chú thích', 'bia sách', 'tên ebook',
    'tác giả:', 'thể loại:', 'nhà xuất bản', 'nguồn:', 'biên tập', 'sửa lỗi', 'tâm nguyện cuối cùng',
    'cover', 'title', 'copyright', 'intro', 'preface', 'info', 'author', 'credits', 'so-thao', 'metadata', 'nav', 'frontmatter'
];

function stripHtml(html) {
    if (!html) return '';
    let clean = html
        .replace(/<head([\s\S]*?)<\/head>/gi, '')
        .replace(/<style([\s\S]*?)<\/style>/gi, '')
        .replace(/<script([\s\S]*?)<\/script>/gi, '')
        .replace(/<metadata([\s\S]*?)<\/metadata>/gi, '');

    let text = clean
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim();

    if (text.startsWith('Chưa xác định')) {
        text = text.replace(/^Chưa xác định\s*/i, '').trim();
    }
    return text;
}

function cleanChapterContent(title, content) {
    let text = content.trim();
    const cleanTitle = title.trim();

    // If content starts with the exact title, remove it
    if (text.toLowerCase().startsWith(cleanTitle.toLowerCase())) {
        text = text.substring(cleanTitle.length).trim();
    }

    // Remove leading colons or dots that might remain after title removal
    text = text.replace(/^[:.\-\s]+/, '').trim();

    return text;
}

async function parseEpub(filePath) {
    const buffer = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(buffer);

    const containerXml = await zip.file('META-INF/container.xml').async('text');
    const containerData = parser.parse(containerXml);
    const opfPath = containerData.container.rootfiles.rootfile["@_full-path"];
    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

    const opfXml = await zip.file(opfPath).async('text');
    const opfData = parser.parse(opfXml);
    const metadata = opfData.package.metadata;

    let title = 'Chưa rõ tiêu đề';
    const rawTitle = metadata["dc:title"] || metadata.title;
    if (rawTitle) {
        title = typeof rawTitle === 'string' ? rawTitle : (rawTitle["#text"] || String(rawTitle));
    }

    let author = 'Chưa rõ tác giả';
    const rawAuthor = metadata["dc:creator"] || metadata.creator;
    if (rawAuthor) {
        author = typeof rawAuthor === 'string' ? rawAuthor : (rawAuthor["#text"] || String(rawAuthor));
    }

    const manifestItems = {};
    const items = Array.isArray(opfData.package.manifest.item) ? opfData.package.manifest.item : [opfData.package.manifest.item];
    items.forEach(item => { manifestItems[item["@_id"]] = item["@_href"]; });

    let epubChapters = [];

    // 1. Try ePub 3 <nav>
    const navItem = items.find(it => it["@_properties"]?.includes("nav"));
    if (navItem) {
        const navPath = opfDir + navItem["@_href"];
        const navXml = await zip.file(navPath).async('text');
        const navData = parser.parse(navXml);
        let nav = navData.html?.body?.nav || navData.nav;
        if (Array.isArray(nav)) nav = nav.find(n => n["@_epub:type"] === "toc" || n["@_type"] === "toc") || nav[0];
        let navList = nav?.ol?.li;
        if (navList) {
            if (!Array.isArray(navList)) navList = [navList];
            for (const item of navList) {
                const rawCtitle = item.a?.["#text"] || item.span?.["#text"] || item.a || "Chương không tên";
                const ctitle = stripHtml(typeof rawCtitle === 'string' ? rawCtitle : JSON.stringify(rawCtitle)).trim();
                if (skipTitleKeywords.some(kw => ctitle.toLowerCase().includes(kw))) continue;

                let src = item.a?.["@_href"];
                if (src) {
                    if (src.includes('#')) src = src.split('#')[0];
                    const contentPath = opfDir + src;
                    const htmlFile = zip.file(contentPath);
                    if (htmlFile) {
                        const html = await htmlFile.async('text');
                        let text = stripHtml(html);
                        text = cleanChapterContent(ctitle, text);
                        if (text.length > 20) {
                            epubChapters.push({ title: ctitle, content: text });
                        }
                    }
                }
            }
        }
    }

    // 2. Fallback to NCX
    if (epubChapters.length === 0) {
        const tocId = opfData.package.spine["@_toc"];
        const tocHref = manifestItems[tocId];
        if (tocHref) {
            const tocPath = opfDir + tocHref;
            const tocXml = await zip.file(tocPath).async('text');
            const tocData = parser.parse(tocXml);

            const extractNavPoints = async (points) => {
                if (!points) return;
                const pts = Array.isArray(points) ? points : [points];
                for (const point of pts) {
                    const chapterTitle = String(point.navLabel?.text || 'Chương không tên').trim();
                    const src = String(point.content?.["@_src"] || '');

                    if (src && !skipTitleKeywords.some(kw => chapterTitle.toLowerCase().includes(kw))) {
                        let cleanSrc = src;
                        if (cleanSrc.includes('#')) cleanSrc = cleanSrc.split('#')[0];
                        const contentPath = opfDir + cleanSrc;
                        const htmlFile = zip.file(contentPath);
                        if (htmlFile) {
                            const html = await htmlFile.async('text');
                            let text = stripHtml(html);
                            text = cleanChapterContent(chapterTitle, text);
                            if (text.length > 20) {
                                epubChapters.push({ title: chapterTitle, content: text });
                            }
                        }
                    }

                    // Recursive call for nested navPoints
                    if (point.navPoint) {
                        await extractNavPoints(point.navPoint);
                    }
                }
            };

            await extractNavPoints(tocData.ncx?.navMap?.navPoint);
        }
    }

    return { title, author, chapters: epubChapters };
}

async function main() {
    const epubDir = path.join(__dirname, '../assets/epub');
    const dbPath = path.join(__dirname, '../assets/audiobook-prebuilt.db');

    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const db = new Database(dbPath);

    db.exec(`
        PRAGMA page_size = 4096;
        PRAGMA journal_mode = DELETE;
        PRAGMA user_version = 777;
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
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            order_index INTEGER,
            FOREIGN KEY (book_id) REFERENCES books (id)
        );
    `);

    const files = fs.readdirSync(epubDir).filter(f => f.endsWith('.epub'));

    const insertBook = db.prepare('INSERT INTO books (title, author, description) VALUES (?, ?, ?)');
    const insertChapter = db.prepare('INSERT INTO chapters (book_id, title, content, order_index) VALUES (?, ?, ?, ?)');

    for (const file of files) {
        console.log(`Processing: ${file}`);
        const filePath = path.join(epubDir, file);
        try {
            const data = await parseEpub(filePath);

            const transaction = db.transaction((bookData) => {
                const bookResult = insertBook.run(bookData.title, bookData.author, `Bản dịch của ${bookData.title}`);
                const bookId = bookResult.lastInsertRowid;

                bookData.chapters.forEach((ch, index) => {
                    insertChapter.run(bookId, ch.title, ch.content, index);
                });
                return bookId;
            });

            const bookId = transaction(data);
            console.log(`Successfully imported: ${data.title} (${data.chapters.length} chapters)`);
        } catch (err) {
            console.error(`Error processing ${file}:`, err);
        }
    }

    console.log('Finalizing database...');
    db.exec('VACUUM;');
    db.close();
    console.log(`Database generated at: ${dbPath}`);
}

main();
