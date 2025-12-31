import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, StatusBar, Text, Animated, Easing } from 'react-native';
import { Colors } from './src/constants/theme';
import LibraryScreen from './src/screens/LibraryScreen';
import PlayerScreen from './src/screens/PlayerScreen';
import { databaseService } from './src/services/DatabaseService';
import { bookImportService } from './src/services/BookImportService';
import { databaseSyncService } from './src/services/DatabaseSyncService';

export default function App() {
    console.log('[App] App component rendered');
    const [currentScreen, setCurrentScreen] = useState<'library' | 'player'>('library');
    const [isLoading, setIsLoading] = useState(true);
    const [loadingMessage, setLoadingMessage] = useState('Đang khởi động...');
    const spinValue = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (isLoading) {
            Animated.loop(
                Animated.timing(spinValue, {
                    toValue: 1,
                    duration: 1000,
                    easing: Easing.linear,
                    useNativeDriver: true,
                })
            ).start();
        }
    }, [isLoading]);

    const spin = spinValue.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    });

    // Cloud Sync on Startup only (Removing Background Listener as requested)
    useEffect(() => {
        const initApp = async () => {
            try {
                // 1. Unified Sync on Startup (Upload if exists, Download if missing)
                // Added a timeout (20s) to ensure app doesn't hang if network is slow
                const syncTask = databaseSyncService.syncOnStartup((msg) => setLoadingMessage(msg));
                const timeoutTask = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Sync Timeout')), 20000)
                );

                try {
                    await Promise.race([syncTask, timeoutTask]);
                } catch (timeoutErr) {
                    console.warn('[App] Sync timed out or failed, proceeding to local init.');
                }

                // 2. Initialize local DB
                setLoadingMessage('Đang chuẩn bị bộ nhớ...');
                await databaseService.init();

                // 3. Import local assets
                setLoadingMessage('Đang nhập dữ liệu...');
                await bookImportService.importLocalEpubs();
            } catch (err) {
                console.warn('[App] Init Warning:', err);
            } finally {
                setIsLoading(false);
            }
        };
        initApp();
    }, []);

    if (isLoading) {
        return (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                <StatusBar barStyle="light-content" />
                <View style={{ alignItems: 'center' }}>
                    <Animated.View style={[styles.loader, { transform: [{ rotate: spin }] }]} />
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" />
            {currentScreen === 'library' ? (
                <LibraryScreen onSelectBook={() => setCurrentScreen('player')} />
            ) : (
                <PlayerScreen onBack={() => setCurrentScreen('library')} />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: Colors.background,
    },
    loader: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 3,
        borderColor: Colors.primary,
        borderTopColor: 'transparent',
        marginBottom: 20,
    },
    loadingText: {
        color: Colors.text,
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: 0.5,
        marginBottom: 8,
    },
    brandText: {
        color: Colors.primary,
        fontSize: 12,
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: 2,
        opacity: 0.6,
    }
});
