const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, 'yt-dlp');

if (fs.existsSync(binPath)) {
    console.log('yt-dlp already exists, skipping download.');
    process.exit(0);
}

const arch = process.arch;
let url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

if (process.platform === 'linux') {
    if (arch === 'arm64') {
        url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64';
    } else if (arch === 'arm') {
        url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_armv7l';
    }
} else if (process.platform === 'win32') {
    url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
}

console.log(`Downloading yt-dlp from ${url}...`);

try {
    execSync(`curl -L "${url}" -o "${binPath}"`, { stdio: 'inherit' });
    if (process.platform !== 'win32') {
        fs.chmodSync(binPath, '755');
        console.log('Set executable permissions for yt-dlp.');
    }
    console.log('yt-dlp download complete.');
} catch (error) {
    console.error(`Error downloading yt-dlp: ${error.message}`);
    process.exit(1);
}
