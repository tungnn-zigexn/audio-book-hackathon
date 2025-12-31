import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, Image, TextInput, Alert } from 'react-native';
import { Colors, Spacing } from '../constants/theme';
import { BookOpen, Search, Trash2, Plus } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import { ActivityIndicator } from 'react-native';
import { databaseService, Book } from '../services/DatabaseService';
import { useBookStore } from '../store/useBookStore';
import { bookImportService } from '../services/BookImportService';
import { coverImageService } from '../services/CoverImageService';

export default function LibraryScreen({ onSelectBook }: { onSelectBook: () => void }) {
    console.log('[LibraryScreen] LibraryScreen rendered');
    const { setSelectedBook } = useBookStore();
    const [dbBooks, setDbBooks] = useState<Book[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isImporting, setIsImporting] = useState(false);

    useEffect(() => {
        const init = async () => {
            const books = await databaseService.getBooks();
            setDbBooks(books);
            triggerBatchCoverGeneration(books);
        };
        init();
    }, []);

    const triggerBatchCoverGeneration = async (books: Book[]) => {
        const booksMissingCover = books.filter(b => !b.cover_uri || b.cover_uri === '');
        if (booksMissingCover.length > 0) {
            console.log(`[LibraryScreen] Found ${booksMissingCover.length} books missing covers. Generating...`);
            for (const book of booksMissingCover) {
                // Run in sequence but don't block UI
                await coverImageService.generateForBook(book.id, book.title, book.author || 'Chưa rõ');
            }
            // Reload books to show new covers
            loadBooks();
        }
    };

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

    const handleImportFile = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: 'application/epub+zip',
                copyToCacheDirectory: true
            });

            if (result.canceled) return;

            setIsImporting(true);
            const asset = result.assets[0];
            await bookImportService.importExternalEpub(asset.uri);
            await loadBooks();
            Alert.alert("Thành công", `Đã thêm sách "${asset.name}" vào thư viện.`);
        } catch (err) {
            console.error('[LibraryScreen] Import Error:', err);
            Alert.alert("Lỗi", "Không thể bóc tách file ePub này. Vui lòng thử file khác.");
        } finally {
            setIsImporting(false);
        }
    };

    const handleReset = () => {
        Alert.alert(
            "Xóa toàn bộ dữ liệu",
            "Bạn có chắc muốn xóa toàn bộ sách và tiến trình hiện tại để nạp lại từ database gốc?",
            [
                { text: "Hủy", style: "cancel" },
                {
                    text: "Xóa",
                    style: "destructive",
                    onPress: async () => {
                        await databaseService.clearBooks();
                        // Re-import immediately so user doesn't have to reload
                        await bookImportService.importLocalEpubs();
                        await loadBooks();
                        Alert.alert("Thành công", "Thư viện đã được làm mới.");
                    }
                }
            ]
        );
    };

    const handleDeleteBook = (book: Book) => {
        Alert.alert(
            "Xóa sách",
            `Bạn có chắc chắn muốn xóa cuốn sách "${book.title}" khỏi thư viện?`,
            [
                { text: "Hủy", style: "cancel" },
                {
                    text: "Xóa",
                    style: "destructive",
                    onPress: async () => {
                        await databaseService.deleteBook(book.id);
                        await loadBooks();
                    }
                }
            ]
        );
    };

    const filteredBooks = dbBooks.filter(book =>
        (book.title?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
        (book.author?.toLowerCase() || '').includes(searchQuery.toLowerCase())
    );

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View style={styles.headerTop}>
                    <TouchableOpacity onLongPress={() => databaseService.shareDatabase()}>
                        <Text style={styles.title}>Thư viện</Text>
                    </TouchableOpacity>
                    <View style={styles.headerButtons}>
                        {isImporting ? (
                            <ActivityIndicator color={Colors.primary} size="small" style={{ marginRight: Spacing.md }} />
                        ) : (
                            <TouchableOpacity onPress={handleImportFile} style={{ marginRight: Spacing.md }}>
                                <Plus color={Colors.primary} size={28} />
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity onPress={handleReset}>
                            <Trash2 color={Colors.textSecondary} size={24} />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            <View style={styles.searchBar}>
                <Search color={Colors.textSecondary} size={20} />
                <TextInput
                    placeholder="Tìm kiếm sách hoặc tác giả..."
                    placeholderTextColor={Colors.textSecondary}
                    style={styles.searchInput}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                />
            </View>

            <FlatList
                data={filteredBooks}
                keyExtractor={(item) => item.id.toString()}
                numColumns={2}
                columnWrapperStyle={styles.columnWrapper}
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
                            <Text style={styles.bookTitle} numberOfLines={2}>{item.title}</Text>
                            <Text style={styles.bookAuthor} numberOfLines={1}>{item.author}</Text>
                        </View>
                        <TouchableOpacity
                            style={styles.deleteButton}
                            onPress={() => handleDeleteBook(item)}
                        >
                            <Trash2 color={Colors.textSecondary} size={16} />
                        </TouchableOpacity>
                    </TouchableOpacity>
                )}
            />
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
        paddingHorizontal: Spacing.lg,
        marginBottom: Spacing.md,
    },
    headerTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    headerButtons: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    title: {
        fontSize: 32,
        fontWeight: 'bold',
        color: Colors.text,
        letterSpacing: -0.5,
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.surface,
        marginHorizontal: Spacing.lg,
        paddingHorizontal: Spacing.md,
        borderRadius: 12,
        height: 48,
        marginBottom: Spacing.lg,
        borderWidth: 1,
        borderColor: Colors.border,
    },
    searchInput: {
        flex: 1,
        color: Colors.text,
        marginLeft: Spacing.sm,
        fontSize: 16,
    },
    list: {
        paddingHorizontal: Spacing.md,
        paddingBottom: 40,
    },
    columnWrapper: {
        justifyContent: 'space-between',
    },
    bookCard: {
        width: '48%',
        backgroundColor: Colors.surface,
        borderRadius: 16,
        padding: Spacing.sm,
        marginBottom: Spacing.md,
        borderWidth: 1,
        borderColor: Colors.border,
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
    },
    coverImage: {
        width: '100%',
        aspectRatio: 3 / 4,
        borderRadius: 12,
        backgroundColor: Colors.glass,
    },
    coverPlaceholder: {
        width: '100%',
        aspectRatio: 3 / 4,
        backgroundColor: Colors.glass,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    bookInfo: {
        marginTop: Spacing.sm,
        paddingHorizontal: 4,
    },
    bookTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: Colors.text,
        marginBottom: 2,
        lineHeight: 20,
    },
    bookAuthor: {
        fontSize: 12,
        color: Colors.textSecondary,
        fontWeight: '500',
    },
    deleteButton: {
        position: 'absolute',
        top: Spacing.xs,
        right: Spacing.xs,
        backgroundColor: 'rgba(15, 23, 42, 0.6)',
        padding: 6,
        borderRadius: 12,
    },
});
