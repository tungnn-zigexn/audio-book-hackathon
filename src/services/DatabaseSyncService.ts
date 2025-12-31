import { deviceService } from './DeviceService';
import { supabaseService } from './SupabaseService';
import * as FileSystem from 'expo-file-system/legacy';
import { databaseService } from './DatabaseService';

const DB_FILENAME = 'audiobook_v2.db';
const LOCAL_DB_PATH = FileSystem.documentDirectory + 'SQLite/' + DB_FILENAME;

class DatabaseSyncService {
    private isSyncing = false;

    /**
     * Single entry point for startup sync.
     * 1. If local DB exists -> Upload to Cloud (Backup)
     * 2. If local DB missing -> Download from Cloud (Restore)
     * 3. Handle errors gracefully for new users
     */
    async syncOnStartup(onStatusChange?: (msg: string) => void): Promise<void> {
        if (this.isSyncing) return;
        this.isSyncing = true;

        try {
            const deviceId = await deviceService.getDeviceId();
            const cloudPath = `databases/${deviceId}/${DB_FILENAME}`;

            // Check if local DB exists
            const localInfo = await FileSystem.getInfoAsync(LOCAL_DB_PATH);

            if (localInfo.exists) {
                // CASE 1: Local exists -> BACKUP UP TO CLOUD
                console.log('[DatabaseSyncService] Local DB exists. Backing up to Cloud...');
                onStatusChange?.('Đang sao lưu lên đám mây...');

                // Create snapshot for upload
                const dbPath = await databaseService.getSyncSnapshot();

                // Log size
                const fileInfo = await FileSystem.getInfoAsync(dbPath);
                if (fileInfo.exists) {
                    const sizeMB = (fileInfo.size / (1024 * 1024)).toFixed(2);
                    console.log(`[DatabaseSyncService] Database size to backup: ${sizeMB} MB`);
                }

                await supabaseService.uploadFile(dbPath, cloudPath);
                console.log('[DatabaseSyncService] Backup success.');
            } else {
                // CASE 2: Local missing -> TRY TO RESTORE FROM CLOUD
                console.log('[DatabaseSyncService] Local DB missing. Checking Cloud...');
                onStatusChange?.('Đang kiểm tra đám mây...');

                const remoteExists = await supabaseService.fileExists(cloudPath);
                if (remoteExists) {
                    console.log('[DatabaseSyncService] Remote found. Restoring...');
                    onStatusChange?.('Đang khôi phục dữ liệu...');

                    // Ensure directory exists
                    const dbDir = FileSystem.documentDirectory + 'SQLite/';
                    await FileSystem.makeDirectoryAsync(dbDir, { intermediates: true });

                    const success = await supabaseService.downloadFile(cloudPath, LOCAL_DB_PATH);
                    if (success) {
                        console.log('[DatabaseSyncService] Restore success.');
                    }
                } else {
                    console.log('[DatabaseSyncService] No local and no remote. Fresh start.');
                }
            }
        } catch (error) {
            console.warn('[DatabaseSyncService] Startup sync skipped/failed (silent):', error);
            // Don't throw, let app continue as fallback
        } finally {
            this.isSyncing = false;
        }
    }
}

export const databaseSyncService = new DatabaseSyncService();
