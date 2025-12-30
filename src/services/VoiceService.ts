import { Audio } from 'expo-av';

class VoiceService {
    private recording: Audio.Recording | null = null;
    private isRecording: boolean = false;

    async startRecording(): Promise<boolean> {
        try {
            if (this.isRecording) {
                console.log('[VoiceService] Already recording');
                return false;
            }

            console.log('[VoiceService] Requesting permissions...');
            const permission = await Audio.requestPermissionsAsync();
            if (permission.status !== 'granted') {
                console.warn('[VoiceService] Permission not granted');
                return false;
            }

            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
            });

            console.log('[VoiceService] Starting recording...');
            const { recording } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.HIGH_QUALITY
            );
            this.recording = recording;
            this.isRecording = true;
            console.log('[VoiceService] Recording started');
            return true;
        } catch (err) {
            console.error('[VoiceService] Failed to start recording', err);
            this.isRecording = false;
            return false;
        }
    }

    async stopRecording(): Promise<string | null> {
        console.log('[VoiceService] Stopping recording...');
        if (!this.recording || !this.isRecording) {
            console.warn('[VoiceService] No active recording');
            return null;
        }

        try {
            await this.recording.stopAndUnloadAsync();
            const uri = this.recording.getURI();
            this.recording = null;
            this.isRecording = false;
            
            // Restore audio mode for playback after recording
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
                staysActiveInBackground: false,
                shouldDuckAndroid: true,
            });
            
            // Thêm delay nhỏ để đảm bảo audio mode được apply hoàn toàn
            await new Promise(resolve => setTimeout(resolve, 200));
            
            console.log('[VoiceService] Recording stopped and stored at', uri);
            return uri;
        } catch (err) {
            console.error('[VoiceService] Failed to stop recording', err);
            this.isRecording = false;
            
            // Try to restore audio mode even on error
            try {
                await Audio.setAudioModeAsync({
                    allowsRecordingIOS: false,
                    playsInSilentModeIOS: true,
                    staysActiveInBackground: false,
                    shouldDuckAndroid: true,
                });
                await new Promise(resolve => setTimeout(resolve, 200));
            } catch (e) {
                console.warn('[VoiceService] Failed to restore audio mode:', e);
            }
            
            return null;
        }
    }

    isCurrentlyRecording(): boolean {
        return this.isRecording;
    }

    async cancelRecording() {
        if (this.recording && this.isRecording) {
            try {
                await this.recording.stopAndUnloadAsync();
            } catch (err) {
                console.error('[VoiceService] Error canceling recording', err);
            }
            this.recording = null;
            this.isRecording = false;
            
            // Restore audio mode for playback
            try {
                await Audio.setAudioModeAsync({
                    allowsRecordingIOS: false,
                    playsInSilentModeIOS: true,
                    staysActiveInBackground: false,
                    shouldDuckAndroid: true,
                });
                await new Promise(resolve => setTimeout(resolve, 200));
            } catch (e) {
                console.warn('[VoiceService] Failed to restore audio mode:', e);
            }
        }
    }
}

export const voiceService = new VoiceService();

