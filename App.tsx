import React, { useState, useEffect } from 'react';
import { StyleSheet, View, StatusBar } from 'react-native';
import { Colors } from './src/constants/theme';
import LibraryScreen from './src/screens/LibraryScreen';
import PlayerScreen from './src/screens/PlayerScreen';
import { databaseService } from './src/services/DatabaseService';
import { bookImportService } from './src/services/BookImportService';

export default function App() {
    console.log('[App] App component rendered');
    const [currentScreen, setCurrentScreen] = useState<'library' | 'player'>('library');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const initApp = async () => {
            try {
                await databaseService.init();
                await bookImportService.importLocalEpubs();
            } catch (err) {
                console.error('[App] Init Error:', err);
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
                <View style={{ padding: 20 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: Colors.primary, borderTopColor: 'transparent' }} />
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
});
