import React, { useState, useEffect, useRef } from 'react';
import {
    StyleSheet,
    Text,
    View,
    TouchableOpacity,
    Image,
    ScrollView,
    Modal,
    Animated,
    ActivityIndicator,
    Alert
} from 'react-native';
import { Colors, Spacing } from '../constants/theme';
import {
    Play,
    Pause,
    SkipForward,
    SkipBack,
    ArrowLeft,
    Languages,
    BookOpen,
    Mic,
    Gauge,
    FileText,
    X,
    ChevronUp,
    ChevronDown,
    Zap,
    User
} from 'lucide-react-native';
import { useBookStore } from '../store/useBookStore';
import { audioService } from '../services/AudioService';
import { databaseService, Chapter } from '../services/DatabaseService';
import { OpenAIVoice } from '../services/OpenAIService';
import { voiceCommandProcessor, VoiceCommand } from '../services/VoiceCommandProcessor';
import { summarizationService } from '../services/SummarizationService';

export default function PlayerScreen({ onBack }: { onBack: () => void }) {
    const { selectedBook } = useBookStore();
    const [chapters, setChapters] = useState<Chapter[]>([]);
    const [currentChapterIndex, setCurrentChapterIndex] = useState(selectedBook?.last_chapter_index || 0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [language, setLanguage] = useState<'en' | 'vi'>('vi');
    const [speechRate, setSpeechRate] = useState(1.0);

    // AI Voice states
    const [useAIVoice, setUseAIVoice] = useState(false);
    const [selectedAIVoice, setSelectedAIVoice] = useState<OpenAIVoice>('shimmer');
    const [aiProgress, setAIProgress] = useState('');

    // Voice control states
    const [isListening, setIsListening] = useState(false);
    const [showSummary, setShowSummary] = useState<string | null>(null);
    const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
    const [lastCommand, setLastCommand] = useState<string | null>(null);

    // Sync states
    const [chunks, setChunks] = useState<string[]>([]);
    const [activeChunkIndex, setActiveChunkIndex] = useState(-1);
    const scrollViewRef = useRef<ScrollView>(null);

    // Animations
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const micScaleAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (selectedBook) {
            loadChapters();
        }
        return () => {
            audioService.stop();
        };
    }, [selectedBook]);

    // Update speech rate display
    useEffect(() => {
        const interval = setInterval(() => {
            setSpeechRate(audioService.getRate());
            setIsPlaying(audioService.getIsPlaying());
        }, 500);
        return () => clearInterval(interval);
    }, []);

    // Save progress to DB when chapter changes
    useEffect(() => {
        if (selectedBook && currentChapterIndex >= 0 && currentChapterIndex !== selectedBook.last_chapter_index) {
            databaseService.updateBookProgress(selectedBook.id, currentChapterIndex);
            useBookStore.getState().setSelectedBook({
                ...selectedBook,
                last_chapter_index: currentChapterIndex
            });
        }
    }, [currentChapterIndex, selectedBook]);

    // Pulse animation for listening
    useEffect(() => {
        if (isListening) {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.2,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                ])
            ).start();
        } else {
            pulseAnim.setValue(1);
        }
    }, [isListening]);

    const loadChapters = async () => {
        try {
            const data = await databaseService.getChapters(Number(selectedBook!.id));
            setChapters(data);
            if (data.length > 0) {
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
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Đang tải nội dung...</Text>
        </View>
    );

    const currentChapter = chapters[currentChapterIndex];

    // Validate currentChapter
    if (!currentChapter) {
        return (
            <View style={styles.container}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.loadingText}>Đang tải chương...</Text>
            </View>
        );
    }

    // Helper function to format chapter title with correct chapter number
    const getChapterDisplayTitle = (chapter: Chapter, index: number): string => {
        const chapterNumber = index + 1;
        // Remove any existing "Chương X" prefix from title and use our own numbering
        const cleanTitle = chapter.title.replace(/^Chương\s+\d+[\s\-:]*/i, '').trim();
        return `Chương ${chapterNumber}${cleanTitle ? ' - ' + cleanTitle : ''}`;
    };

    // Log để debug
    if (__DEV__) {
        console.log('[PlayerScreen] Current chapter index:', currentChapterIndex);
        console.log('[PlayerScreen] Current chapter title (original):', currentChapter.title);
        console.log('[PlayerScreen] Current chapter title (display):', getChapterDisplayTitle(currentChapter, currentChapterIndex));
        console.log('[PlayerScreen] Current chapter content length:', currentChapter.content?.length || 0);
    }

    const startPlayback = async (resumeMillis: number = 0) => {
        setIsPlaying(true);
        const state = audioService.getPlaybackState();

        // If already loaded and paused, just resume for instant response
        if (state.isPaused && state.isPlayingAI === useAIVoice) {
            console.log('[PlayerScreen] Resuming existing audio session');
            await audioService.resume();
            return;
        }

        // If mode changed while paused, we must stop and restart to change engines
        if (state.isPaused) {
            await audioService.stop();
        }

        const rIdx = activeChunkIndex === -1 ? 0 : activeChunkIndex;
        if (useAIVoice) {
            await audioService.speakWithOpenAI(
                currentChapter.content,
                selectedAIVoice,
                (idx, tot, cks) => {
                    setChunks(cks);
                    setActiveChunkIndex(idx);
                    if (scrollViewRef.current) {
                        scrollViewRef.current.scrollTo({ y: idx * 40, animated: true });
                    }
                },
                (msg) => setAIProgress(msg),
                rIdx,
                resumeMillis,
                currentChapter.id
            );
        } else {
            await audioService.speak(
                currentChapter.content,
                language,
                (idx, tot, cks) => {
                    setChunks(cks);
                    setActiveChunkIndex(idx);
                    if (scrollViewRef.current) {
                        scrollViewRef.current.scrollTo({ y: idx * 40, animated: true });
                    }
                },
                rIdx,
                speechRate
            );
        }
    };

    const handlePlayPause = async () => {
        if (isPlaying) {
            await audioService.pause();
            setIsPlaying(false);
            setAIProgress('');
        } else {
            // Ensure currentChapter exists
            if (!currentChapter || !currentChapter.content) {
                console.error('[PlayerScreen] No chapter content available');
                return;
            }
            await startPlayback();
        }
    };

    const toggleLanguage = async () => {
        const newLang = language === 'en' ? 'vi' : 'en';
        setLanguage(newLang);
        if (isPlaying) {
            await audioService.stop();
            handlePlayPause();
        }
    };

    const handleToggleAI = async () => {
        const nextMode = !useAIVoice;
        setUseAIVoice(nextMode);

        // Stop current audio to reset engines
        await audioService.stop();
        if (isPlaying) {
            setIsPlaying(false);
            setAIProgress('');
        }
    };

    const handleVoiceChange = async (voice: OpenAIVoice) => {
        // Chỉ cho phép thay đổi voice khi đang dùng AI voice
        if (!useAIVoice) {
            console.warn('[PlayerScreen] Cannot change voice when not using AI voice');
            return;
        }

        const state = audioService.getPlaybackState();
        const currentPos = state.lastPositionMillis;
        const wasPlaying = isPlaying;
        console.log(`[PlayerScreen] Voice change requested from ${selectedAIVoice} to ${voice}. Capturing pos: ${currentPos}ms`);

        // Update state first
        setSelectedAIVoice(voice);

        if (wasPlaying) {
            console.log(`[PlayerScreen] Stopping current playback and restarting with voice ${voice} from ${currentPos}ms`);
            // Stop current playback
            await audioService.stop();

            // Restart with new voice - pass voice directly to avoid state timing issues
            setIsPlaying(true);
            const rIdx = activeChunkIndex === -1 ? 0 : activeChunkIndex;
            await audioService.speakWithOpenAI(
                currentChapter.content,
                voice, // Use the new voice directly, not from state
                (idx, tot, cks) => {
                    setChunks(cks);
                    setActiveChunkIndex(idx);
                    if (scrollViewRef.current) {
                        scrollViewRef.current.scrollTo({ y: idx * 40, animated: true });
                    }
                },
                (msg) => setAIProgress(msg),
                rIdx,
                currentPos,
                currentChapter.id
            );
        }
    };

    const handleNextChapter = async () => {
        // Validate: Check if we can go to next chapter
        if (currentChapterIndex >= chapters.length - 1) {
            console.log('[PlayerScreen] Already at last chapter');
            return;
        }

        const nextIndex = currentChapterIndex + 1;
        const nextChapter = chapters[nextIndex];

        // Validate: Ensure next chapter exists and has content
        if (!nextChapter || !nextChapter.content) {
            console.error('[PlayerScreen] Next chapter not found or has no content');
            Alert.alert('Lỗi', 'Chương tiếp theo không tồn tại hoặc chưa có nội dung');
            return;
        }

        console.log(`[PlayerScreen] Moving to next chapter: ${nextIndex} - ${nextChapter.title}`);

        // Stop audio first and wait for it to fully stop
        const wasPlaying = isPlaying;
        if (wasPlaying) {
            console.log('[PlayerScreen] Stopping audio before chapter change...');
            await audioService.stop();
            setIsPlaying(false);
            // Wait a bit to ensure audio is fully stopped
            await new Promise(resolve => setTimeout(resolve, 300));
            console.log('[PlayerScreen] Audio stopped, proceeding with chapter change');
        }

        // Update chunks with new chapter content FIRST
        const newChunks = audioService.chunkText(nextChapter.content, 300);
        console.log(`[PlayerScreen] Updated chunks for chapter ${nextIndex + 1}, total chunks: ${newChunks.length}`);

        // Update state with new chapter - do this in a batch to ensure consistency
        setCurrentChapterIndex(nextIndex);
        setChunks(newChunks);
        setActiveChunkIndex(-1);
        setAIProgress('');

        // Reset scroll position - use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
            if (scrollViewRef.current) {
                scrollViewRef.current.scrollTo({ y: 0, animated: false });
            }
        });

        // If was playing, start playback of new chapter
        if (wasPlaying) {
            // Capture chapter content to avoid closure issues
            const chapterContent = nextChapter.content;
            const chapterIdx = nextIndex;
            const currentUseAIVoice = useAIVoice;
            const currentSelectedAIVoice = selectedAIVoice;
            const currentLanguage = language;
            const currentSpeechRate = speechRate;
            
            // Use longer timeout to ensure all state updates are complete
            setTimeout(async () => {
                console.log(`[PlayerScreen] Starting playback of next chapter ${chapterIdx + 1}`);
                // Use the captured chapter content instead of currentChapter from closure
                const rIdx = 0; // Start from beginning
                if (currentUseAIVoice) {
                    await audioService.speakWithOpenAI(
                        chapterContent,
                        currentSelectedAIVoice,
                        (idx, tot, cks) => {
                            setChunks(cks);
                            setActiveChunkIndex(idx);
                            if (scrollViewRef.current) {
                                scrollViewRef.current.scrollTo({ y: idx * 40, animated: true });
                            }
                        },
                        (msg) => setAIProgress(msg),
                        rIdx,
                        0
                    );
                } else {
                    await audioService.speak(
                        chapterContent, 
                        currentLanguage, 
                        (idx, tot, cks) => {
                            setChunks(cks);
                            setActiveChunkIndex(idx);
                            if (scrollViewRef.current) {
                                scrollViewRef.current.scrollTo({ y: idx * 40, animated: true });
                            }
                        }, 
                        rIdx,
                        currentSpeechRate
                    );
                }
                setIsPlaying(true);
            }, 200);
        }
    };

    const handlePrevChapter = async () => {
        // Validate: Check if we can go to previous chapter
        if (currentChapterIndex <= 0) {
            console.log('[PlayerScreen] Already at first chapter');
            return;
        }

        const prevIndex = currentChapterIndex - 1;
        const prevChapter = chapters[prevIndex];

        // Validate: Ensure previous chapter exists and has content
        if (!prevChapter || !prevChapter.content) {
            console.error('[PlayerScreen] Previous chapter not found or has no content');
            Alert.alert('Lỗi', 'Chương trước không tồn tại hoặc chưa có nội dung');
            return;
        }

        console.log(`[PlayerScreen] Moving to previous chapter: ${prevIndex} - ${prevChapter.title}`);

        // Stop audio first and wait for it to fully stop
        const wasPlaying = isPlaying;
        if (wasPlaying) {
            await audioService.stop();
            setIsPlaying(false);
            // Wait a bit to ensure audio is fully stopped
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Update chunks with new chapter content FIRST
        const newChunks = audioService.chunkText(prevChapter.content, 300);
        console.log(`[PlayerScreen] Updated chunks for chapter ${prevIndex + 1}, total chunks: ${newChunks.length}`);

        // Update state with new chapter - do this in a batch to ensure consistency
        setCurrentChapterIndex(prevIndex);
        setChunks(newChunks);
        setActiveChunkIndex(-1);
        setAIProgress('');

        // Reset scroll position - use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
            if (scrollViewRef.current) {
                scrollViewRef.current.scrollTo({ y: 0, animated: false });
            }
        });

        // If was playing, start playback of new chapter
        if (wasPlaying) {
            // Capture chapter content to avoid closure issues
            const chapterContent = prevChapter.content;
            const chapterIdx = prevIndex;
            const currentUseAIVoice = useAIVoice;
            const currentSelectedAIVoice = selectedAIVoice;
            const currentLanguage = language;
            const currentSpeechRate = speechRate;
            
            // Use longer timeout to ensure all state updates are complete
            setTimeout(async () => {
                console.log(`[PlayerScreen] Starting playback of previous chapter ${chapterIdx + 1}`);
                // Use the captured chapter content instead of currentChapter from closure
                const rIdx = 0; // Start from beginning
                if (currentUseAIVoice) {
                    await audioService.speakWithOpenAI(
                        chapterContent,
                        currentSelectedAIVoice,
                        (idx, tot, cks) => {
                            setChunks(cks);
                            setActiveChunkIndex(idx);
                            if (scrollViewRef.current) {
                                scrollViewRef.current.scrollTo({ y: idx * 40, animated: true });
                            }
                        },
                        (msg) => setAIProgress(msg),
                        rIdx,
                        0
                    );
                } else {
                    await audioService.speak(
                        chapterContent, 
                        currentLanguage, 
                        (idx, tot, cks) => {
                            setChunks(cks);
                            setActiveChunkIndex(idx);
                            if (scrollViewRef.current) {
                                scrollViewRef.current.scrollTo({ y: idx * 40, animated: true });
                            }
                        }, 
                        rIdx,
                        currentSpeechRate
                    );
                }
                setIsPlaying(true);
            }, 200);
        }
    };

    // Voice command handler
    const handleVoiceCommand = async () => {
        setIsListening(true);
        setLastCommand(null);

        try {
            const command = await voiceCommandProcessor.processVoiceCommand(3000);
            setIsListening(false);

            if (!command || command.intent === 'unknown') {
                setLastCommand('Không nhận diện được lệnh. Vui lòng thử lại.');
                setTimeout(() => setLastCommand(null), 3000);
                return;
            }

            setLastCommand(`Đã thực hiện lệnh!`);
            setTimeout(() => setLastCommand(null), 3000);

            // Đảm bảo audio mode được restore trước khi execute command
            await new Promise(resolve => setTimeout(resolve, 200));

            await executeCommand(command);
        } catch (error: any) {
            setIsListening(false);
            console.error('[PlayerScreen] Voice command error:', error);
            Alert.alert('Lỗi', error.message || 'Không thể xử lý lệnh giọng nói. Vui lòng kiểm tra kết nối mạng và API key.');
        }
    };

    const executeCommand = async (command: VoiceCommand) => {
        // Sync isPlaying state với audioService
        const actuallyPlaying = audioService.getIsPlaying();

        switch (command.intent) {
            case 'play':
                if (!actuallyPlaying) {
                    await handlePlayPause();
                }
                break;

            case 'pause':
                if (actuallyPlaying) {
                    // Dừng trực tiếp bằng audioService
                    await audioService.stop();
                    setIsPlaying(false);
                    setActiveChunkIndex(-1);
                }
                break;

            case 'speed':
                if (command.action === 'increase') {
                    audioService.increaseRate(command.value as number);
                    setSpeechRate(audioService.getRate());
                } else if (command.action === 'decrease') {
                    audioService.decreaseRate(Math.abs(command.value as number));
                    setSpeechRate(audioService.getRate());
                } else if (command.action === 'set') {
                    audioService.setRate(command.value as number);
                    setSpeechRate(audioService.getRate());
                }
                // Restart với tốc độ mới nếu đang phát (chỉ cho system TTS, không phải AI)
                if (isPlaying && !useAIVoice) {
                    await audioService.restartWithNewRate((index, total, currentChunks) => {
                        setChunks(currentChunks);
                        setActiveChunkIndex(index);
                        if (scrollViewRef.current) {
                            scrollViewRef.current.scrollTo({ y: index * 40, animated: true });
                        }
                    }, activeChunkIndex >= 0 ? activeChunkIndex : 0);
                }
                break;

            case 'summarize':
                setIsGeneratingSummary(true);
                try {
                    if (command.action === 'chapter') {
                        const summary = await summarizationService.summarizeChapter(
                            currentChapter.content,
                            language
                        );
                        setShowSummary(summary);
                    } else if (command.action === 'book') {
                        const summary = await summarizationService.summarizeBook(
                            chapters.map(ch => ({ title: ch.title, content: ch.content })),
                            language
                        );
                        setShowSummary(summary);
                    }
                } catch (error: any) {
                    Alert.alert('Lỗi', error.message || 'Không thể tạo tóm tắt');
                } finally {
                    setIsGeneratingSummary(false);
                }
                break;

            case 'navigation':
                if (command.action === 'next') {
                    await handleNextChapter();
                } else if (command.action === 'previous') {
                    await handlePrevChapter();
                } else if (command.action === 'goto') {
                    const chapterIndex = command.value as number;
                    console.log(`[PlayerScreen] Goto command: target chapter index ${chapterIndex} (chương ${chapterIndex + 1}), current index: ${currentChapterIndex} (chương ${currentChapterIndex + 1})`);
                    
                    // Validate: Check if chapter index is valid
                    if (chapterIndex < 0 || chapterIndex >= chapters.length) {
                        console.error(`[PlayerScreen] Invalid chapter index: ${chapterIndex} (valid range: 0-${chapters.length - 1})`);
                        Alert.alert('Lỗi', `Chương ${chapterIndex + 1} không tồn tại`);
                        return;
                    }

                    const targetChapter = chapters[chapterIndex];

                    // Validate: Ensure chapter exists and has content
                    if (!targetChapter || !targetChapter.content) {
                        console.error('[PlayerScreen] Target chapter not found or has no content');
                        Alert.alert('Lỗi', 'Chương không tồn tại hoặc chưa có nội dung');
                        return;
                    }

                    // Don't do anything if already at target chapter (but still update to ensure UI is fresh)
                    if (currentChapterIndex === chapterIndex) {
                        console.log('[PlayerScreen] Already at target chapter, refreshing UI');
                        // Still update chunks and reset scroll to ensure UI is fresh
                        setChunks(audioService.chunkText(targetChapter.content, 300));
                        setActiveChunkIndex(-1);
                        if (scrollViewRef.current) {
                            scrollViewRef.current.scrollTo({ y: 0, animated: false });
                        }
                        return;
                    }

                    console.log(`[PlayerScreen] Moving to chapter: ${chapterIndex} - ${targetChapter.title}`);

                    // Stop audio first and wait for it to fully stop
                    const wasPlaying = actuallyPlaying;
                    if (wasPlaying) {
                        console.log('[PlayerScreen] Stopping audio before chapter change...');
                        await audioService.stop();
                        setIsPlaying(false);
                        // Wait a bit to ensure audio is fully stopped
                        await new Promise(resolve => setTimeout(resolve, 300));
                        console.log('[PlayerScreen] Audio stopped, proceeding with chapter change');
                    }

                    // Update chunks with new chapter content FIRST
                    const newChunks = audioService.chunkText(targetChapter.content, 300);
                    console.log(`[PlayerScreen] Updated chunks for chapter ${chapterIndex + 1}, total chunks: ${newChunks.length}`);

                    // Update state with new chapter - do this in a batch to ensure consistency
                    setCurrentChapterIndex(chapterIndex);
                    setChunks(newChunks);
                    setActiveChunkIndex(-1);
                    setAIProgress('');

                    // Reset scroll position - use requestAnimationFrame to ensure DOM is updated
                    requestAnimationFrame(() => {
                        if (scrollViewRef.current) {
                            scrollViewRef.current.scrollTo({ y: 0, animated: false });
                        }
                    });

                    // If was playing, start playback of new chapter after state is updated
                    if (wasPlaying) {
                        // Use longer timeout to ensure all state updates are complete
                        // Also capture the chapter content to avoid closure issues
                        const chapterContent = targetChapter.content;
                        const chapterIdx = chapterIndex;
                        setTimeout(async () => {
                            console.log(`[PlayerScreen] Starting playback of new chapter ${chapterIdx + 1}`);
                            // Use the captured chapter content instead of currentChapter from closure
                            const rIdx = 0; // Start from beginning
                            if (useAIVoice) {
                                await audioService.speakWithOpenAI(
                                    chapterContent,
                                    selectedAIVoice,
                                    (idx, tot, cks) => {
                                        setChunks(cks);
                                        setActiveChunkIndex(idx);
                                        if (scrollViewRef.current) {
                                            scrollViewRef.current.scrollTo({ y: idx * 40, animated: true });
                                        }
                                    },
                                    (msg) => setAIProgress(msg),
                                    rIdx,
                                    0
                                );
                            } else {
                                await audioService.speak(
                                    chapterContent, 
                                    language, 
                                    (idx, tot, cks) => {
                                        setChunks(cks);
                                        setActiveChunkIndex(idx);
                                        if (scrollViewRef.current) {
                                            scrollViewRef.current.scrollTo({ y: idx * 40, animated: true });
                                        }
                                    }, 
                                    rIdx,
                                    speechRate
                                );
                            }
                            setIsPlaying(true);
                        }, 200);
                    } else {
                        console.log(`[PlayerScreen] Chapter changed to ${chapterIndex + 1}, not playing`);
                    }
                }
                break;
        }
    };

    // Manual speed controls (chỉ cho system TTS)
    const handleSpeedIncrease = () => {
        if (useAIVoice) return; // AI voice không hỗ trợ speed control
        audioService.increaseRate(0.25);
        setSpeechRate(audioService.getRate());
        if (isPlaying) {
            audioService.restartWithNewRate((index, total, currentChunks) => {
                setChunks(currentChunks);
                setActiveChunkIndex(index);
            }, activeChunkIndex >= 0 ? activeChunkIndex : 0);
        }
    };

    const handleSpeedDecrease = () => {
        if (useAIVoice) return; // AI voice không hỗ trợ speed control
        audioService.decreaseRate(0.25);
        setSpeechRate(audioService.getRate());
        if (isPlaying) {
            audioService.restartWithNewRate((index, total, currentChunks) => {
                setChunks(currentChunks);
                setActiveChunkIndex(index);
            }, activeChunkIndex >= 0 ? activeChunkIndex : 0);
        }
    };

    const handleManualSummarize = async (type: 'chapter' | 'book') => {
        setIsGeneratingSummary(true);
        try {
            if (type === 'chapter') {
                const summary = await summarizationService.summarizeChapter(
                    currentChapter.content,
                    language
                );
                setShowSummary(summary);
            } else {
                const summary = await summarizationService.summarizeBook(
                    chapters.map(ch => ({ title: ch.title, content: ch.content })),
                    language
                );
                setShowSummary(summary);
            }
        } catch (error: any) {
            Alert.alert('Lỗi', error.message || 'Không thể tạo tóm tắt');
        } finally {
            setIsGeneratingSummary(false);
        }
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={onBack}>
                    <ArrowLeft color={Colors.text} size={28} />
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle}>Đang nghe</Text>
                    {aiProgress !== '' && <Text style={styles.aiStatusText}>{aiProgress}</Text>}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity
                        onPress={handleToggleAI}
                        style={[styles.miniBtn, useAIVoice && styles.activeMiniBtn]}
                    >
                        <Zap color={useAIVoice ? Colors.background : Colors.primary} size={20} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={toggleLanguage} style={styles.langButton}>
                        <Languages color={Colors.primary} size={20} />
                        <Text style={styles.langText}>{language.toUpperCase()}</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {useAIVoice && (
                <View style={styles.voiceSelector}>
                    {['alloy', 'shimmer', 'nova', 'echo', 'onyx'].map((v) => (
                        <TouchableOpacity
                            key={v}
                            onPress={() => handleVoiceChange(v as OpenAIVoice)}
                            style={[styles.voiceOption, selectedAIVoice === v && styles.activeVoiceOption]}
                        >
                            <User color={selectedAIVoice === v ? Colors.background : Colors.textSecondary} size={16} />
                            <Text style={[styles.voiceName, selectedAIVoice === v && { color: Colors.background }]}>
                                {v.charAt(0).toUpperCase() + v.slice(1)}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            )}

            <View style={styles.content}>
                {/* Compact Header with Cover and Info */}
                <View style={styles.topSection}>
                    <Animated.View
                        style={[
                            styles.coverContainer,
                            isPlaying && { transform: [{ scale: 1.05 }] },
                            isListening && { transform: [{ scale: pulseAnim }] }
                        ]}
                    >
                        {selectedBook.cover_uri && selectedBook.cover_uri.trim() !== '' ? (
                            <Image source={{ uri: selectedBook.cover_uri }} style={styles.cover} />
                        ) : (
                            <View style={[styles.cover, { backgroundColor: Colors.surface, justifyContent: 'center', alignItems: 'center' }]}>
                                <BookOpen color={Colors.textSecondary} size={40} />
                            </View>
                        )}
                    </Animated.View>

                    <View style={styles.infoContainer}>
                        <Text style={styles.title} numberOfLines={2}>{selectedBook.title}</Text>
                        <Text style={styles.author} numberOfLines={1}>{selectedBook.author}</Text>
                        <Text style={styles.chapterTitle} numberOfLines={1}>{getChapterDisplayTitle(currentChapter, currentChapterIndex)}</Text>

                        {/* Speed Control - Compact */}
                        <View style={styles.speedControl}>
                            <TouchableOpacity onPress={handleSpeedDecrease} style={styles.speedButton}>
                                <ChevronDown color={Colors.textSecondary} size={16} />
                            </TouchableOpacity>
                            <View style={styles.speedDisplay}>
                                <Gauge color={Colors.primary} size={14} />
                                <Text style={styles.speedText}>{speechRate.toFixed(2)}x</Text>
                            </View>
                            <TouchableOpacity onPress={handleSpeedIncrease} style={styles.speedButton}>
                                <ChevronUp color={Colors.textSecondary} size={16} />
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>

                {/* Expanded Text Reader */}
                <View style={styles.readerWrapper}>
                    <ScrollView
                        ref={scrollViewRef as any}
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

                {/* Command Feedback */}
                {lastCommand && (
                    <View style={styles.commandFeedback}>
                        <Text style={styles.commandText}>{lastCommand}</Text>
                    </View>
                )}

                <View style={styles.controls}>
                    <View style={styles.progressBar}>
                        <View style={[styles.progressFill, { width: `${((currentChapterIndex + 1) / chapters.length) * 100}%` }]} />
                    </View>

                    <View style={styles.btnRow}>
                        <TouchableOpacity onPress={handlePrevChapter} style={styles.navButton}>
                            <SkipBack color={Colors.text} size={32} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.playBtn, isPlaying && styles.playBtnActive]}
                            onPress={handlePlayPause}
                        >
                            {isPlaying ? (
                                <Pause color={Colors.background} size={40} fill={Colors.background} />
                            ) : (
                                <Play color={Colors.background} size={40} fill={Colors.background} />
                            )}
                        </TouchableOpacity>

                        <TouchableOpacity onPress={handleNextChapter} style={styles.navButton}>
                            <SkipForward color={Colors.text} size={32} />
                        </TouchableOpacity>
                    </View>

                    {/* Voice Control & Summary Buttons */}
                    <View style={styles.actionRow}>
                        <TouchableOpacity
                            style={[styles.voiceButton, isListening && styles.voiceButtonActive]}
                            onPress={handleVoiceCommand}
                            disabled={isListening}
                        >
                            {isListening ? (
                                <ActivityIndicator size="small" color={Colors.error} />
                            ) : (
                                <Mic
                                    color={isListening ? Colors.error : Colors.text}
                                    size={24}
                                />
                            )}
                            <Text style={[styles.actionButtonText, isListening && styles.actionButtonTextActive]}>
                                {isListening ? 'Đang nghe...' : 'Giọng nói'}
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.summaryButton}
                            onPress={() => handleManualSummarize('chapter')}
                            disabled={isGeneratingSummary}
                        >
                            {isGeneratingSummary ? (
                                <ActivityIndicator size="small" color={Colors.primary} />
                            ) : (
                                <FileText color={Colors.primary} size={24} />
                            )}
                            <Text style={styles.actionButtonText}>Tóm tắt</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            {/* Summary Modal */}
            <Modal
                visible={!!showSummary}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowSummary(null)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Tóm tắt</Text>
                            <TouchableOpacity onPress={() => setShowSummary(null)}>
                                <X color={Colors.text} size={24} />
                            </TouchableOpacity>
                        </View>
                        <ScrollView style={styles.modalBody}>
                            <Text style={styles.summaryText}>{showSummary}</Text>
                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: Colors.background,
        paddingTop: 60,
    },
    loadingText: {
        color: Colors.text,
        marginTop: 20,
        fontSize: 16,
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
    headerTitleContainer: {
        alignItems: 'center',
    },
    aiStatusText: {
        color: Colors.primary,
        fontSize: 10,
        fontWeight: 'bold',
        marginTop: 2,
    },
    miniBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: Colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 8,
    },
    activeMiniBtn: {
        backgroundColor: Colors.primary,
    },
    voiceSelector: {
        flexDirection: 'row',
        justifyContent: 'center',
        paddingVertical: 10,
        backgroundColor: 'rgba(255,255,255,0.05)',
        marginBottom: 10,
    },
    voiceOption: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.surface,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 15,
        marginHorizontal: 4,
    },
    activeVoiceOption: {
        backgroundColor: Colors.primary,
    },
    voiceName: {
        color: Colors.textSecondary,
        fontSize: 12,
        marginLeft: 4,
        fontWeight: '500',
    },
    langButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.surface,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 20,
        gap: 6,
    },
    langText: {
        color: Colors.primary,
        marginLeft: 4,
        fontWeight: 'bold',
        fontSize: 12,
    },
    content: {
        flex: 1,
        paddingHorizontal: Spacing.lg,
    },
    topSection: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: Spacing.md,
        gap: Spacing.md,
    },
    coverContainer: {
        width: 100,
        height: 140,
        borderRadius: 12,
        overflow: 'hidden',
        elevation: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        flexShrink: 0,
    },
    cover: {
        width: '100%',
        height: '100%',
        resizeMode: 'cover',
    },
    infoContainer: {
        flex: 1,
        justifyContent: 'flex-start',
        paddingTop: Spacing.xs,
    },
    title: {
        color: Colors.text,
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 4,
        lineHeight: 24,
    },
    author: {
        color: Colors.textSecondary,
        fontSize: 13,
        marginBottom: 6,
    },
    chapterTitle: {
        color: Colors.primary,
        fontSize: 11,
        fontWeight: '600',
        marginBottom: Spacing.sm,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    speedControl: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        backgroundColor: Colors.surface,
        paddingHorizontal: Spacing.sm,
        paddingVertical: 4,
        borderRadius: 16,
        alignSelf: 'flex-start',
        gap: Spacing.xs,
        marginTop: 4,
    },
    speedButton: {
        padding: 2,
    },
    speedDisplay: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: Spacing.xs,
    },
    speedText: {
        color: Colors.primary,
        fontSize: 13,
        fontWeight: 'bold',
    },
    readerWrapper: {
        flex: 1,
        width: '100%',
        marginBottom: Spacing.md,
        backgroundColor: Colors.surface,
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(56, 189, 248, 0.1)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 3,
    },
    textContainer: {
        flex: 1,
        padding: Spacing.lg,
    },
    scrollContent: {
        paddingBottom: 60,
    },
    contentText: {
        color: Colors.text,
        fontSize: 18,
        lineHeight: 32,
        marginBottom: 16,
        letterSpacing: 0.3,
    },
    activeText: {
        color: Colors.primary,
        fontWeight: '700',
        backgroundColor: 'rgba(56, 189, 248, 0.2)',
        padding: 12,
        borderRadius: 8,
        borderLeftWidth: 3,
        borderLeftColor: Colors.primary,
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 2,
    },
    commandFeedback: {
        backgroundColor: Colors.surface,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        borderRadius: 8,
        marginBottom: Spacing.sm,
        width: '100%',
    },
    commandText: {
        color: Colors.success,
        fontSize: 12,
        textAlign: 'center',
    },
    controls: {
        width: '100%',
        paddingBottom: 20,
    },
    progressBar: {
        height: 8,
        backgroundColor: Colors.surface,
        borderRadius: 4,
        marginBottom: Spacing.lg,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(56, 189, 248, 0.2)',
    },
    progressFill: {
        height: '100%',
        backgroundColor: Colors.primary,
        borderRadius: 4,
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 4,
    },
    btnRow: {
        flexDirection: 'row',
        justifyContent: 'space-evenly',
        alignItems: 'center',
        marginBottom: Spacing.md,
    },
    navButton: {
        padding: Spacing.sm,
    },
    playBtn: {
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: Colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 8,
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.5,
        shadowRadius: 12,
        borderWidth: 3,
        borderColor: 'rgba(56, 189, 248, 0.3)',
    },
    playBtnActive: {
        backgroundColor: Colors.accent,
        borderColor: 'rgba(129, 140, 248, 0.3)',
        transform: [{ scale: 1.05 }],
    },
    actionRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        gap: Spacing.md,
    },
    voiceButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: Colors.surface,
        paddingVertical: Spacing.sm,
        paddingHorizontal: Spacing.md,
        borderRadius: 12,
        gap: 6,
        borderWidth: 1,
        borderColor: 'rgba(56, 189, 248, 0.2)',
    },
    voiceButtonActive: {
        backgroundColor: 'rgba(239, 68, 68, 0.15)',
        borderWidth: 2,
        borderColor: Colors.error,
        shadowColor: Colors.error,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
    },
    summaryButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: Colors.surface,
        paddingVertical: Spacing.sm,
        paddingHorizontal: Spacing.md,
        borderRadius: 12,
        gap: 6,
        borderWidth: 1,
        borderColor: 'rgba(56, 189, 248, 0.2)',
    },
    actionButtonText: {
        color: Colors.text,
        fontSize: 12,
        fontWeight: '600',
    },
    actionButtonTextActive: {
        color: Colors.error,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: Colors.surface,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: '80%',
        paddingTop: Spacing.lg,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: Colors.background,
    },
    modalTitle: {
        color: Colors.text,
        fontSize: 20,
        fontWeight: 'bold',
    },
    modalBody: {
        padding: Spacing.lg,
        maxHeight: 500,
    },
    summaryText: {
        color: Colors.text,
        fontSize: 16,
        lineHeight: 24,
    },
});
