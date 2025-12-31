import { createClient } from '@supabase/supabase-js';
import * as FileSystem from 'expo-file-system/legacy';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

const BUCKET_NAME = 'book-database';

class SupabaseService {
    /**
     * Uploads a file from local FileSystem to Supabase Storage using streaming (uploadAsync)
     */
    async uploadFile(localUri: string, cloudPath: string): Promise<string> {
        try {
            console.log(`[SupabaseService] Uploading (Stream): ${localUri} -> ${cloudPath}`);
            const uploadUrl = `${supabaseUrl}/storage/v1/object/${BUCKET_NAME}/${cloudPath}`;

            const result = await FileSystem.uploadAsync(uploadUrl, localUri, {
                httpMethod: 'POST',
                headers: {
                    'Authorization': `Bearer ${supabaseAnonKey}`,
                    'apikey': supabaseAnonKey,
                    'x-upsert': 'true',
                },
                uploadType: 0 as any, // 0 is BINARY_CONTENT
            });

            if (result.status >= 300) {
                throw new Error(`Upload failed with status ${result.status}: ${result.body}`);
            }

            console.log('[SupabaseService] Upload successful:', cloudPath);
            return cloudPath;
        } catch (error) {
            console.warn('[SupabaseService] Upload error (silent):', error);
            throw error;
        }
    }

    /**
     * Downloads a file from Supabase Storage using streaming (downloadAsync)
     */
    async downloadFile(cloudPath: string, localUri: string): Promise<boolean> {
        try {
            console.log(`[SupabaseService] Downloading (Streaming): ${cloudPath} -> ${localUri}`);
            const downloadUrl = `${supabaseUrl}/storage/v1/object/${BUCKET_NAME}/${cloudPath}`;

            // Check if file exists first (using SDK)
            const exists = await this.fileExists(cloudPath);
            if (!exists) {
                console.log('[SupabaseService] Remote file not found.');
                return false;
            }

            const result = await FileSystem.downloadAsync(downloadUrl, localUri, {
                headers: {
                    'Authorization': `Bearer ${supabaseAnonKey}`,
                    'apikey': supabaseAnonKey,
                }
            });

            if (result.status >= 300) {
                throw new Error(`Download failed with status ${result.status}`);
            }

            console.log('[SupabaseService] Download successful!');
            return true;
        } catch (error) {
            console.warn('[SupabaseService] Download error (silent):', error);
            return false;
        }
    }

    /**
     * Checks if a file exists on Supabase Storage
     */
    async fileExists(cloudPath: string): Promise<boolean> {
        try {
            const { data, error } = await supabase.storage
                .from(BUCKET_NAME)
                .list(cloudPath.substring(0, cloudPath.lastIndexOf('/')), {
                    search: cloudPath.substring(cloudPath.lastIndexOf('/') + 1)
                });

            if (error) return false;
            return data && data.length > 0;
        } catch (err) {
            return false;
        }
    }
}

export const supabaseService = new SupabaseService();
