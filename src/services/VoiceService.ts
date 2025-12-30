import { Audio } from 'expo-av';

class VoiceService {
    private recording: Audio.Recording | null = null;

    async startRecording() {
        try {
            console.log('[VoiceService] Requesting permissions...');
            const permission = await Audio.requestPermissionsAsync();
            if (permission.status !== 'granted') return;

            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
            });

            console.log('[VoiceService] Starting recording..');
            const { recording } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.HIGH_QUALITY
            );
            this.recording = recording;
            console.log('[VoiceService] Recording started');
        } catch (err) {
            console.error('[VoiceService] Failed to start recording', err);
        }
    }

    async stopRecording() {
        console.log('[VoiceService] Stopping recording..');
        if (!this.recording) return null;

        await this.recording.stopAndUnloadAsync();
        const uri = this.recording.getURI();
        this.recording = null;
        console.log('[VoiceService] Recording stopped and stored at', uri);
        return uri;
    }
}

export const voiceService = new VoiceService();
