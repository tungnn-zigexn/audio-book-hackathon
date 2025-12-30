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
            let title = 'Unknown Title';
            if (metadata["dc:title"]) {
                const dcTitle = metadata["dc:title"];
                if (typeof dcTitle === 'string') {
                    title = dcTitle;
                } else if (dcTitle["#text"]) {
                    title = String(dcTitle["#text"]);
                } else if (Array.isArray(dcTitle)) {
                    title = String(dcTitle[0]["#text"] || dcTitle[0]);
                } else {
                    title = String(dcTitle);
                }
            }

            let author = 'Unknown Author';
            if (metadata["dc:creator"]) {
                const creator = metadata["dc:creator"];
                if (typeof creator === 'string') {
                    author = creator;
                } else if (creator["#text"]) {
                    author = String(creator["#text"]);
                } else if (Array.isArray(creator)) {
                    author = String(creator[0]["#text"] || creator[0]);
                } else {
                    author = String(creator);
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

            // 4. Get spine (order of chapters)
            const itemrefs = Array.isArray(opfData.package.spine.itemref)
                ? opfData.package.spine.itemref
                : [opfData.package.spine.itemref];
            const spine = itemrefs.map((ref: any) => ref["@_idref"]);

            // 5. Extract content from spine items
            const epubChapters: { title: string; content: string }[] = [];

            for (let i = 0; i < spine.length; i++) {
                const itemId = spine[i];
                const href = manifestItems[itemId];
                const contentPath = opfDir + href;

                const htmlContent = await zip.file(contentPath)?.async('text');
                if (htmlContent) {
                    const cleanText = this.stripHtml(htmlContent);
                    if (cleanText.trim().length > 50) { // Skip very short/empty files
                        epubChapters.push({
                            title: `Chương ${epubChapters.length + 1}`,
                            content: cleanText.slice(0, 100000) // Cap at 100k chars for stability
                        });
                    }
                }
            }

            return { title, author, chapters: epubChapters };
        } catch (error) {
            console.error('[EpubParser] Parse error:', error);
            throw error;
        }
    }

    private stripHtml(html: string): string {
        // Simple HTML stripping logic for React Native
        return html
            .replace(/<style([\s\S]*?)<\/style>/gi, '')
            .replace(/<script([\s\S]*?)<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .trim();
    }
}

export const epubParser = new EpubParser();
