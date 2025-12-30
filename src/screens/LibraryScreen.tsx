import React from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, Image } from 'react-native';
import { Colors, Spacing } from '../constants/theme';
import { BookOpen, Mic, MicOff } from 'lucide-react-native';
import { databaseService, Book } from '../services/DatabaseService';
import { voiceService } from '../services/VoiceService';
import { useBookStore } from '../store/useBookStore';

export default function LibraryScreen({ onSelectBook }: { onSelectBook: () => void }) {
    console.log('[LibraryScreen] LibraryScreen rendered');
    const { setSelectedBook } = useBookStore();
    const [dbBooks, setDbBooks] = React.useState<Book[]>([]);
    const [isRecording, setIsRecording] = React.useState(false);
    const [isProcessing, setIsProcessing] = React.useState(false);

    React.useEffect(() => {
        loadBooks();
    }, []);

    const loadBooks = async () => {
        try {
            const books = await databaseService.getBooks();
            setDbBooks(books);
        } catch (err) {
            console.error('[LibraryScreen] Load Books Error:', err);
        }
    };

    const handlePress = (book: Book) => {
        setSelectedBook(book);
        onSelectBook();
    };

    const handleVoiceCommand = async () => {
        alert('Tính năng điều khiển bằng giọng nói AI hiện đang tạm bảo trì.');
        return;

        // Temporarily disabled OpenAI Whisper
        /*
        if (isRecording) {
            setIsRecording(false);
            setIsProcessing(true);
            try {
                const uri = await voiceService.stopRecording();
                if (uri) {
                    const transcription = await openAIService.transcribeAudio(uri);
                    console.log('[LibraryScreen] Recognized command:', transcription);
                    processCommand(transcription);
                }
            } catch (error) {
                console.error('[LibraryScreen] Voice Command Error:', error);
            } finally {
                setIsProcessing(false);
            }
        } else {
            await voiceService.startRecording();
            setIsRecording(true);
        }
        */
    };

    const processCommand = (text: string) => {
        const query = text.toLowerCase();
        console.log('[LibraryScreen] Processing query:', query);

        // Simple command parsing: "đọc sách [tên]" or "read book [name]"
        const bookToRead = dbBooks.find(book =>
            query.includes(book.title.toLowerCase()) ||
            query.includes('đọc sách') ||
            query.includes('read book')
        );

        if (bookToRead) {
            console.log('[LibraryScreen] Command matched book:', bookToRead.title);
            handlePress(bookToRead);
        } else {
            alert(`Không tìm thấy sách phù hợp với lệnh: "${text}"`);
        }
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Thư viện của bạn</Text>
                <TouchableOpacity
                    style={[
                        styles.micButton,
                        isRecording && styles.micButtonActive,
                        isProcessing && { opacity: 0.5 }
                    ]}
                    disabled={isProcessing}
                    onPress={handleVoiceCommand}
                >
                    {isRecording ? (
                        <MicOff color={Colors.error} size={28} />
                    ) : (
                        <Mic color={isProcessing ? Colors.textSecondary : Colors.primary} size={28} />
                    )}
                </TouchableOpacity>
            </View>

            <FlatList
                data={dbBooks}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={styles.list}
                renderItem={({ item }) => (
                    <TouchableOpacity
                        style={styles.bookCard}
                        onPress={() => handlePress(item)}
                    >
                        {item.cover_uri ? (
                            <Image source={{ uri: item.cover_uri }} style={styles.coverImage} />
                        ) : (
                            <View style={styles.coverPlaceholder}>
                                <BookOpen color={Colors.textSecondary} size={32} />
                            </View>
                        )}
                        <View style={styles.bookInfo}>
                            <Text style={styles.bookTitle}>{item.title}</Text>
                            <Text style={styles.bookAuthor}>{item.author}</Text>
                        </View>
                    </TouchableOpacity>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingTop: 60,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        marginBottom: Spacing.lg,
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        color: Colors.text,
    },
    micButton: {
        backgroundColor: Colors.surface,
        padding: Spacing.sm,
        borderRadius: 20,
    },
    micButtonActive: {
        backgroundColor: '#450a0a', // Dark red background
        borderWidth: 1,
        borderColor: Colors.error,
    },
    list: {
        paddingHorizontal: Spacing.lg,
    },
    bookCard: {
        flexDirection: 'row',
        backgroundColor: Colors.surface,
        borderRadius: 12,
        padding: Spacing.md,
        marginBottom: Spacing.md,
    },
    coverImage: {
        width: 60,
        height: 80,
        borderRadius: 8,
    },
    coverPlaceholder: {
        width: 60,
        height: 80,
        backgroundColor: Colors.background,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    bookInfo: {
        marginLeft: Spacing.md,
        justifyContent: 'center',
    },
    bookTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: Colors.text,
        marginBottom: 4,
    },
    bookAuthor: {
        fontSize: 14,
        color: Colors.textSecondary,
    },
});
