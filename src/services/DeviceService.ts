import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system/legacy';

const ID_FILE = FileSystem.documentDirectory + 'device_id.json';

class DeviceService {
    private deviceId: string | null = null;

    async getDeviceId(): Promise<string> {
        if (this.deviceId) return this.deviceId;

        try {
            // 1. Try to read existing ID from file
            const info = await FileSystem.getInfoAsync(ID_FILE);
            if (info.exists) {
                const data = await FileSystem.readAsStringAsync(ID_FILE);
                const { id } = JSON.parse(data);
                if (id) {
                    this.deviceId = id;
                    console.log('[DeviceService] Existing Device ID:', id);
                    return id;
                }
            }
        } catch (err) {
            console.warn('[DeviceService] Error reading ID file:', err);
        }

        // 2. Generate new ID if not found
        // Use combination of device name and random string for some uniqueness if native ID is missing
        const name = Device.deviceName || 'unknown';
        const model = Device.modelName || 'device';
        const random = Math.random().toString(36).substring(2, 10);
        const newId = `${model}_${name}_${random}`.replace(/\s+/g, '_').toLowerCase();

        this.deviceId = newId;

        try {
            await FileSystem.writeAsStringAsync(ID_FILE, JSON.stringify({ id: newId }));
            console.log('[DeviceService] Generated & Saved New Device ID:', newId);
        } catch (err) {
            console.error('[DeviceService] Error saving ID file:', err);
        }

        return newId;
    }
}

export const deviceService = new DeviceService();
