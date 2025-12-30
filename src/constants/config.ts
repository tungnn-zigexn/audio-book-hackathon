// OpenAI API Configuration
// Lấy API key từ: https://platform.openai.com/api-keys
// Tạo file .env trong thư mục gốc với nội dung:
// EXPO_PUBLIC_OPENAI_API_KEY=your_api_key_here

export const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY || '';

// Debug: Log để kiểm tra API key (chỉ log 4 ký tự đầu để bảo mật)
if (__DEV__) {
    if (OPENAI_API_KEY) {
        console.log('[Config] OpenAI API key loaded:', OPENAI_API_KEY.substring(0, 10) + '...');
    } else {
        console.warn('[Config] ⚠️ OpenAI API key NOT found!');
        console.warn('[Config] Please create .env file with: EXPO_PUBLIC_OPENAI_API_KEY=your_key');
    }
}
