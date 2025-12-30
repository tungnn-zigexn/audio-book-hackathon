// Quick script to check if .env file exists and has the API key
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');

console.log('🔍 Checking .env file...\n');

if (!fs.existsSync(envPath)) {
    console.log('❌ File .env NOT found!');
    console.log('\n📝 Please create .env file in the root directory with:');
    console.log('EXPO_PUBLIC_OPENAI_API_KEY=your_api_key_here\n');
    process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');

if (!envContent.includes('EXPO_PUBLIC_OPENAI_API_KEY')) {
    console.log('❌ EXPO_PUBLIC_OPENAI_API_KEY not found in .env file!');
    console.log('\n📝 Please add this line to .env:');
    console.log('EXPO_PUBLIC_OPENAI_API_KEY=your_api_key_here\n');
    process.exit(1);
}

const apiKeyMatch = envContent.match(/EXPO_PUBLIC_OPENAI_API_KEY=(.+)/);
if (apiKeyMatch && apiKeyMatch[1].trim() && apiKeyMatch[1].trim() !== 'your_api_key_here') {
    const key = apiKeyMatch[1].trim();
    console.log('✅ .env file found!');
    console.log('✅ API key detected:', key.substring(0, 10) + '...' + key.substring(key.length - 4));
    console.log('\n💡 If you still see errors, try:');
    console.log('   1. Stop the server (Ctrl+C)');
    console.log('   2. Run: npm start -- --clear');
    console.log('   3. Make sure .env file is in the root directory (same level as package.json)\n');
} else {
    console.log('❌ API key is empty or not set!');
    console.log('\n📝 Please set your API key in .env file:\n');
    console.log('EXPO_PUBLIC_OPENAI_API_KEY=sk-proj-...\n');
    process.exit(1);
}

