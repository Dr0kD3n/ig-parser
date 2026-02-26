const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist_package');
const backendDir = path.join(rootDir, 'backend');
const frontendDir = path.join(rootDir, 'frontend');

console.log('🚀 Starting distribution build...');

try {
    // 1. Cleanup
    if (fs.existsSync(distDir)) {
        console.log('🧹 Cleaning up old dist_package...');
        fs.rmSync(distDir, { recursive: true, force: true });
    }
    fs.mkdirSync(distDir, { recursive: true });
    fs.mkdirSync(path.join(distDir, 'config'), { recursive: true });
    fs.mkdirSync(path.join(distDir, 'data'), { recursive: true });

    // 2. Build Frontend
    console.log('📦 Building Frontend...');
    execSync('npm.cmd run build', { cwd: frontendDir, stdio: 'inherit' });

    // 3. Prepare Backend (Vite builds directly to backend/public based on its config)
    console.log('📂 Preparing Backend assets...');
    const backendPublic = path.join(backendDir, 'public');
    // We don't need to manually copy here because frontend build puts it there
    if (!fs.existsSync(backendPublic)) {
        fs.mkdirSync(backendPublic, { recursive: true });
    }

    // 4. Compile Backend TS to JS
    console.log('🔨 Compiling Backend TS...');
    execSync('npm.cmd run build-only', { cwd: backendDir, stdio: 'inherit' });

    // 5. Bundle Backend with Pkg
    console.log('🚀 Bundling Backend with pkg...');
    // We target node18 Windows x64. Output to dist_package/ig-bot.exe
    // We use --no-bytecode to avoid issues with Playwright and other complex libs
    execSync('npx pkg . --targets node18-win-x64 --no-bytecode --output ../dist_package/ig-bot.exe', { cwd: backendDir, stdio: 'inherit' });

    // 6. Copy additional files
    console.log('📄 Copying helper files...');
    fs.writeFileSync(path.join(distDir, 'start.bat'), '@echo off\nig-bot.exe\npause');
    fs.writeFileSync(path.join(distDir, 'install_browsers.bat'), '@echo off\necho Installing Chromium for Playwright...\nnpx playwright install chromium\npause');
    fs.writeFileSync(path.join(distDir, 'kill_servers.bat'), '@echo off\necho Killing IG-Bot servers on port 1337...\nfor /f "tokens=5" %%a in (\'netstat -aon ^| findstr ":1337" ^| findstr "LISTENING"\') do (\n    echo Killing PID %%a\n    taskkill /F /PID %%a /T 2>NUL\n)\ntaskkill /F /IM ig-bot.exe /T 2>NUL\ntaskkill /F /IM node.exe /T 2>NUL\npause');
    fs.writeFileSync(path.join(distDir, 'config', 'database.sqlite'), '');
    fs.writeFileSync(path.join(distDir, 'README.txt'), 'IG-BOT Distribution\r\n\r\n1. Run install_browsers.bat (requires Node.js/npx)\r\n2. Run start.bat to launch the app\r\n3. Use kill_servers.bat to stop the app safely\r\n4. Open http://localhost:1337 in your browser');

    console.log('✅ Build complete! Check the dist_package folder.');

} catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
}

function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    if (isDirectory) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest);
        fs.readdirSync(src).forEach((childItemName) => {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}
