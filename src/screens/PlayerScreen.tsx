import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Image, ScrollView } from 'react-native';
import { Colors, Spacing } from '../constants/theme';
import { Play, Pause, SkipForward, SkipBack, ArrowLeft, Languages, BookOpen } from 'lucide-react-native';
import { useBookStore } from '../store/useBookStore';
import { audioService } from '../services/AudioService';
import { databaseService, Chapter } from '../services/DatabaseService';

export default function PlayerScreen({ onBack }: { onBack: () => void }) {
    const { selectedBook } = useBookStore();
    const [chapters, setChapters] = useState<Chapter[]>([]);
    const [currentChapterIndex, setCurrentChapterIndex] = useState(selectedBook?.last_chapter_index || 0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [language, setLanguage] = useState<'en' | 'vi'>('vi');

    // Sync states
    const [chunks, setChunks] = useState<string[]>([]);
    const [activeChunkIndex, setActiveChunkIndex] = useState(-1);
    const scrollViewRef = React.useRef<ScrollView>(null);

    useEffect(() => {
        if (selectedBook) {
            loadChapters();
        }
        return () => {
            audioService.stop();
        };
    }, [selectedBook]);

    // Save progress to DB when chapter changes
    useEffect(() => {
        if (selectedBook && currentChapterIndex >= 0 && currentChapterIndex !== selectedBook.last_chapter_index) {
            databaseService.updateBookProgress(selectedBook.id, currentChapterIndex);
            // Also update store to keep it in sync
            useBookStore.getState().setSelectedBook({
                ...selectedBook,
                last_chapter_index: currentChapterIndex
            });
        }
    }, [currentChapterIndex, selectedBook]);

    const loadChapters = async () => {
        try {
            const data = await databaseService.getChapters(Number(selectedBook!.id));
            setChapters(data);
            if (data.length > 0) {
                // Ensure index is within bounds (in case DB changed)
                const safeIndex = Math.min(currentChapterIndex, data.length - 1);
                setCurrentChapterIndex(safeIndex);
                setChunks(audioService.chunkText(data[safeIndex].content, 300));
            }
        } catch (err) {
            console.error('[PlayerScreen] Load Chapters Error:', err);
        }
    };

    if (!selectedBook || chapters.length === 0) return (
        <View style={styles.container}>
            <Text style={{ color: '#fff', textAlign: 'center', marginTop: 100 }}>Đang tải nội dung...</Text>
        </View>
    );

    const currentChapter = chapters[currentChapterIndex];

    const handlePlayPause = async () => {
        if (isPlaying) {
            await audioService.stop();
            setIsPlaying(false);
            setActiveChunkIndex(-1);
        } else {
            setIsPlaying(true);
            await audioService.speak(currentChapter.content, language, (index, total, currentChunks) => {
                setChunks(currentChunks);
                setActiveChunkIndex(index);
                // Simple auto-scroll logic
                if (scrollViewRef.current) {
                    scrollViewRef.current.scrollTo({ y: index * 40, animated: true });
                }
            });
        }
    };

    const toggleLanguage = async () => {
        const newLang = language === 'en' ? 'vi' : 'en';
        setLanguage(newLang);
        if (isPlaying) {
            await audioService.stop();
            handlePlayPause(); // Restart with new language
        }
    };

    const handleNextChapter = async () => {
        if (currentChapterIndex < chapters.length - 1) {
            const nextIndex = currentChapterIndex + 1;
            setCurrentChapterIndex(nextIndex);
            setChunks(audioService.chunkText(chapters[nextIndex].content, 300));
            setActiveChunkIndex(-1);
            if (isPlaying) {
                await audioService.stop();
                setIsPlaying(false);
                setTimeout(handlePlayPause, 100);
            }
        }
    };

    const handlePrevChapter = async () => {
        if (currentChapterIndex > 0) {
            const prevIndex = currentChapterIndex - 1;
            setCurrentChapterIndex(prevIndex);
            setChunks(audioService.chunkText(chapters[prevIndex].content, 300));
            setActiveChunkIndex(-1);
            if (isPlaying) {
                await audioService.stop();
                setIsPlaying(false);
                setTimeout(handlePlayPause, 100);
            }
        }
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={onBack}>
                    <ArrowLeft color={Colors.text} size={28} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Đang nghe</Text>
                <TouchableOpacity onPress={toggleLanguage} style={styles.langButton}>
                    <Languages color={Colors.primary} size={24} />
                    <Text style={styles.langText}>{language.toUpperCase()}</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.content}>
                <View style={[styles.coverContainer, isPlaying && { transform: [{ scale: 1.05 }] }]}>
                    {selectedBook.cover_uri && selectedBook.cover_uri.trim() !== '' ? (
                        <Image source={{ uri: selectedBook.cover_uri }} style={styles.cover} />
                    ) : (
                        <View style={[styles.cover, { backgroundColor: Colors.surface, justifyContent: 'center', alignItems: 'center' }]}>
                            <BookOpen color={Colors.textSecondary} size={80} />
                        </View>
                    )}
                </View>

                <View style={styles.infoContainer}>
                    <Text style={styles.title} numberOfLines={1}>{selectedBook.title}</Text>
                    <Text style={styles.author}>{selectedBook.author}</Text>
                    <Text style={styles.chapterTitle}>{currentChapter.title}</Text>
                </View>

                <View style={styles.readerWrapper}>
                    <ScrollView
                        ref={scrollViewRef}
                        style={styles.textContainer}
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                    >
                        {chunks.length > 0 ? chunks.map((chunk, idx) => (
                            <Text
                                key={idx}
                                style={[
                                    styles.contentText,
                                    idx === activeChunkIndex && styles.activeText
                                ]}
                            >
                                {chunk}
                            </Text>
                        )) : (
                            <Text style={styles.contentText}>{currentChapter.content}</Text>
                        )}
                    </ScrollView>
                </View>

                <View style={styles.controls}>
                    <View style={styles.progressBar}>
                        <View style={[styles.progressFill, { width: `${((currentChapterIndex + 1) / chapters.length) * 100}%` }]} />
                    </View>

                    <View style={styles.btnRow}>
                        <TouchableOpacity onPress={handlePrevChapter}>
                            <SkipBack color={Colors.text} size={32} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.playBtn}
                            onPress={handlePlayPause}
                        >
                            {isPlaying ? (
                                <Pause color={Colors.background} size={40} fill={Colors.background} />
                            ) : (
                                <Play color={Colors.background} size={40} fill={Colors.background} />
                            )}
                        </TouchableOpacity>

                        <TouchableOpacity onPress={handleNextChapter}>
                            <SkipForward color={Colors.text} size={32} />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: Colors.background,
        paddingTop: 60,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        marginBottom: Spacing.md,
    },
    headerTitle: {
        color: Colors.text,
        fontSize: 18,
        fontWeight: '600',
    },
    langButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.surface,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
    },
    langText: {
        color: Colors.primary,
        marginLeft: 6,
        fontWeight: 'bold',
    },
    content: {
        flex: 1,
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
    },
    coverContainer: {
        width: 200,
        height: 280,
        borderRadius: 16,
        overflow: 'hidden',
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 5,
        marginBottom: Spacing.lg,
    },
    cover: {
        width: '100%',
        height: '100%',
    },
    infoContainer: {
        alignItems: 'center',
        marginBottom: Spacing.lg,
    },
    title: {
        color: Colors.text,
        fontSize: 24,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    author: {
        color: Colors.textSecondary,
        fontSize: 16,
        marginTop: 4,
    },
    chapterTitle: {
        color: Colors.primary,
        fontSize: 14,
        fontWeight: 'bold',
        marginTop: 8,
        textTransform: 'uppercase',
    },
    readerWrapper: {
        flex: 1,
        width: '100%',
        marginBottom: Spacing.lg,
        backgroundColor: Colors.surface,
        borderRadius: 12,
        overflow: 'hidden',
    },
    textContainer: {
        flex: 1,
        padding: Spacing.md,
    },
    scrollContent: {
        paddingBottom: 40,
    },
    contentText: {
        color: Colors.textSecondary,
        fontSize: 18,
        lineHeight: 28,
        marginBottom: 12,
    },
    activeText: {
        color: Colors.primary,
        fontWeight: 'bold',
        backgroundColor: 'rgba(52, 199, 89, 0.1)',
        borderRadius: 4,
    },
    controls: {
        width: '100%',
        paddingBottom: 40,
    },
    progressBar: {
        height: 6,
        backgroundColor: Colors.surface,
        borderRadius: 3,
        marginBottom: Spacing.xl,
    },
    progressFill: {
        width: '30%',
        height: '100%',
        backgroundColor: Colors.primary,
        borderRadius: 3,
    },
    btnRow: {
        flexDirection: 'row',
        justifyContent: 'space-evenly',
        alignItems: 'center',
    },
    playBtn: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: Colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
});
