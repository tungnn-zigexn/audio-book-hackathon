import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

export interface EpubBook {
    title: string;
    author: string;
    chapters: { title: string; content: string }[];
}

class EpubParser {
    private parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_"
    });

    async parse(fileUri: string): Promise<EpubBook> {
        try {
            console.log(`[EpubParser] Starting parse: ${fileUri}`);

            // Read file as base64 and convert to buffer
            const base64 = await FileSystem.readAsStringAsync(fileUri, {
                encoding: 'base64',
            });
            const buffer = Buffer.from(base64, 'base64');

            // Load zip
            const zip = await JSZip.loadAsync(buffer);

            // 1. Find container.xml to locate .opf file
            const containerXml = await zip.file('META-INF/container.xml')?.async('text');
            if (!containerXml) throw new Error('Invalid ePUB: META-INF/container.xml not found');

            const containerData = this.parser.parse(containerXml);
            const opfPath = containerData.container.rootfiles.rootfile["@_full-path"];
            const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

            // 2. Parse .opf file for metadata and spine
            const opfXml = await zip.file(opfPath)?.async('text');
            if (!opfXml) throw new Error('Invalid ePUB: .opf file not found');

            const opfData = this.parser.parse(opfXml);
            const metadata = opfData.package.metadata;

            // Extract title and author handle different possible structures in OPF
            let title = 'Chưa rõ tiêu đề';
            const rawTitle = metadata["dc:title"] || metadata.title;
            if (rawTitle) {
                if (typeof rawTitle === 'string') {
                    title = rawTitle;
                } else if (rawTitle["#text"]) {
                    title = String(rawTitle["#text"]);
                } else if (Array.isArray(rawTitle)) {
                    title = String(rawTitle[0]["#text"] || rawTitle[0]);
                } else {
                    title = String(rawTitle);
                }
            }

            let author = 'Chưa rõ tác giả';
            const rawAuthor = metadata["dc:creator"] || metadata.creator;
            if (rawAuthor) {
                if (typeof rawAuthor === 'string') {
                    author = rawAuthor;
                } else if (rawAuthor["#text"]) {
                    author = String(rawAuthor["#text"]);
                } else if (Array.isArray(rawAuthor)) {
                    author = String(rawAuthor[0]["#text"] || rawAuthor[0]);
                } else {
                    author = String(rawAuthor);
                }
            }

            // 3. Get manifest items
            const manifestItems: any = {};
            const items = Array.isArray(opfData.package.manifest.item)
                ? opfData.package.manifest.item
                : [opfData.package.manifest.item];

            items.forEach((item: any) => {
                manifestItems[item["@_id"]] = item["@_href"];
            });

            // 4. Find TOC (NCX or Navigation)
            const epubChapters: { title: string; content: string }[] = [];
            const skipTitleKeywords = [
                'giới thiệu', 'mục lục', 'thông tin', 'bản quyền', 'loi mo dau', 'lời mở đầu', 'lời tựa', 'về tác giả',
                'tựa đề', 'trang tên', 'phụ lục', 'lời cảm ơn', 'loi cam on', 'chú thích', 'bia sách', 'tên ebook',
                'tác giả:', 'thể loại:', 'nhà xuất bản', 'nguồn:', 'biên tập', 'sửa lỗi', 'tâm nguyện cuối cùng',
                'cover', 'title', 'copyright', 'intro', 'preface', 'info', 'author', 'credits', 'so-thao', 'metadata', 'nav', 'frontmatter'
            ];

            // Try ePub 3 <nav> first
            const navItem = items.find((it: any) => it["@_properties"]?.includes("nav"));
            if (navItem) {
                const navPath = opfDir + navItem["@_href"];
                const navXml = await zip.file(navPath)?.async('text');
                if (navXml) {
                    const navData = this.parser.parse(navXml);
                    // Support different nav structures
                    let nav = navData.html?.body?.nav || navData.nav;
                    if (Array.isArray(nav)) nav = nav.find((n: any) => n["@_epub:type"] === "toc" || n["@_type"] === "toc") || nav[0];

                    let navList = nav?.ol?.li;
                    if (navList) {
                        if (!Array.isArray(navList)) navList = [navList];
                        for (const item of navList) {
                            try {
                                const rawTitle = item.a?.["#text"] || item.span?.["#text"] || item.a || "Chương không tên";
                                const title = this.stripHtml(typeof rawTitle === 'string' ? rawTitle : JSON.stringify(rawTitle)).trim();

                                if (skipTitleKeywords.some(kw => title.toLowerCase().includes(kw))) continue;

                                let src = item.a?.["@_href"];
                                if (src) {
                                    const [purePath, anchor] = src.includes('#') ? src.split('#') : [src, null];
                                    const contentPath = opfDir + purePath;
                                    const html = await zip.file(contentPath)?.async('text');
                                    if (html) {
                                        let text = anchor ? this.extractContentByAnchor(html, anchor) : this.stripHtml(html);
                                        text = this.cleanChapterContent(title, text);
                                        if (text.length > 20) {
                                            epubChapters.push({ title, content: text.slice(0, 100000)});
                                        }
                                    }
                                }
                            } catch (e) {}
                        }
                    }
                }
            }

            // Fallback to ePub 2 <ncx>
            if (epubChapters.length === 0) {
                const tocId = opfData.package.spine["@_toc"];
                const tocHref = manifestItems[tocId];
                if (tocHref) {
                    const tocPath = opfDir + tocHref;
                    const tocXml = await zip.file(tocPath)?.async('text');
                    if (tocXml) {
                        const tocData = this.parser.parse(tocXml);
                        let navPoints = tocData.ncx?.navMap?.navPoint;
                        if (navPoints) {
                            if (!Array.isArray(navPoints)) navPoints = [navPoints];
                            for (const point of navPoints) {
                                try {
                                    const title = String(point.navLabel?.text || 'Chương không tên').trim();
                                    if (skipTitleKeywords.some(kw => title.toLowerCase().includes(kw))) continue;

                                    let src = String(point.content?.["@_src"] || '');
                                    const [purePath, anchor] = src.includes('#') ? src.split('#') : [src, null];

                                    const contentPath = opfDir + purePath;
                                    const html = await zip.file(contentPath)?.async('text');
                                    if (html) {
                                        let text = anchor ? this.extractContentByAnchor(html, anchor) : this.stripHtml(html);
                                        text = this.cleanChapterContent(title, text);
                                        if (text.length > 20) {
                                            epubChapters.push({ title, content: text.slice(0, 100000)});
                                        }
                                    }
                                } catch (e) {}
                            }
                        }
                    }
                }
            }

            // Fallback to Spine (Generic extraction)
            if (epubChapters.length === 0) {
                console.warn('[EpubParser] TOC parsing failed or empty, falling back to spine');
                const itemrefsFallback = Array.isArray(opfData.package.spine.itemref)
                    ? opfData.package.spine.itemref
                    : [opfData.package.spine.itemref];
                const spineFallback = itemrefsFallback.map((ref: any) => ref["@_idref"]);

                const skipKeywords = ['cover', 'title', 'copyright', 'author', 'bia', 'thong-tin', 'ban-quyen', 'intro'];

                for (const itemId of spineFallback) {
                    const href = manifestItems[itemId];
                    if (!href) continue;
                    const fileName = href.toLowerCase();
                    if (skipKeywords.some(kw => fileName.includes(kw))) continue;

                    const contentPath = opfDir + href;
                    const html = await zip.file(contentPath)?.async('text');
                    if (html) {
                        const text = this.stripHtml(html);
                        if (text.length > 100) { // Keep slightly higher for guessing
                            const title = this.extractTitle(html);
                            if (title && skipTitleKeywords.some(kw => title.toLowerCase().includes(kw))) continue;

                            epubChapters.push({
                                title: title || `Chương ${epubChapters.length + 1}`,
                                content: text.slice(0, 100000)
                            });
                        }
                    }
                }
            }

            // Final cleanup of chapter list: remove duplicates and very short entries
            // Final cleanup: Only deduplicate if BOTH title and content start match
            const uniqueChapters = epubChapters.filter((ch, index, self) =>
                index === self.findIndex((t) => t.title === ch.title && t.content.slice(0, 100) === ch.content.slice(0, 100))
            );

            return { title, author, chapters: uniqueChapters };
        } catch (error) {
            console.error('[EpubParser] Parse error:', error);
            throw error;
        }
    }

    private extractTitle(html: string): string | null {
        // Try to find text within <h1>, <h2>, <h3> or <p class="chapter">
        const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (h1Match) return this.stripHtml(h1Match[1]).trim();

        const h2Match = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
        if (h2Match) return this.stripHtml(h2Match[1]).trim();

        const chapterMatch = html.match(/class=["'][^"']*chapter[^"']*["'][^>]*>([\s\S]*?)</i);
        if (chapterMatch) return this.stripHtml(chapterMatch[1]).trim();

        return null;
    }

    private stripHtml(html: string): string {
        // Remove content that shouldn't be read
        let clean = html
            .replace(/<head([\s\S]*?)<\/head>/gi, '')
            .replace(/<style([\s\S]*?)<\/style>/gi, '')
            .replace(/<script([\s\S]*?)<\/script>/gi, '')
            .replace(/<metadata([\s\S]*?)<\/metadata>/gi, '');

        // Simple HTML stripping logic for React Native
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

        // Remove common garbage prepended by some tools
        if (text.startsWith('Chưa xác định')) {
            text = text.replace(/^Chưa xác định\s*/i, '').trim();
        }

        return text;
    }

    private cleanChapterContent(title: string, content: string): string {
        let text = content.trim();
        const cleanTitle = title.trim();
        if (text.toLowerCase().startsWith(cleanTitle.toLowerCase())) {
            text = text.substring(cleanTitle.length).trim();
        }
        return text.replace(/^[:.\-\s]+/, '').trim();
    }

    /**
     * Attempts to extract content starting from an anchor ID.
     * Simple implementation: find the ID, and take everything after it (up to 100k chars).
     * This is better than taking the whole file every time.
     */
    private extractContentByAnchor(html: string, anchor: string): string {
        // Find various forms of anchor declarations
        const patterns = [
            new RegExp(`id=["']${anchor}["']`, 'i'),
            new RegExp(`name=["']${anchor}["']`, 'i')
        ];

        let foundIdx = -1;
        for (const p of patterns) {
            const match = html.match(p);
            if (match && match.index !== undefined) {
                foundIdx = match.index;
                break;
            }
        }

        if (foundIdx === -1) return this.stripHtml(html);

        // Instead of starting exactly at 'id=', find the end of the tag '>'
        // to avoid leaking things like id='p175' into the text
        const endOfTagIdx = html.indexOf('>', foundIdx);
        const startIdx = endOfTagIdx !== -1 ? endOfTagIdx + 1 : foundIdx;

        // Take from the end of that tag onwards
        const slicedHtml = html.substring(startIdx);
        return this.stripHtml(slicedHtml);
    }
}

export const epubParser = new EpubParser();
