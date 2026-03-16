const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Handles automatic updates by fetching the latest zip from GitHub
 */
class Updater {
    constructor(repo = 'Dr0kD3n/ig-parser') {
        this.repo = repo;
        this.currentDir = process.cwd();
    }

    async checkForUpdates() {
        console.log('[UPDATER] Checking for updates...');
        try {
            const latest = await this.getLatestRelease();
            // In a real scenario, compare versions here. 
            // For now, we'll just check if a flag --force-update is passed or use a simple version file
            return latest;
        } catch (error) {
            console.error('[UPDATER] Update check failed:', error.message);
            return null;
        }
    }

    getLatestRelease() {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                path: `/repos/${this.repo}/releases/latest`,
                headers: { 'User-Agent': 'node.js' }
            };

            https.get(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode !== 200) return reject(new Error('Failed to fetch release info'));
                    resolve(JSON.parse(data));
                });
            }).on('error', reject);
        });
    }

    async performUpdate(release) {
        const asset = release.assets.find(a => a.name === 'ig-bot-update.zip');
        if (!asset) {
            console.error('[UPDATER] No update asset found in latest release');
            return;
        }

        const zipPath = path.join(this.currentDir, 'update.zip');
        console.log(`[UPDATER] Downloading update from ${asset.browser_download_url}...`);

        await this.downloadFile(asset.browser_download_url, zipPath);

        console.log('[UPDATER] Extracting update...');
        // Using PowerShell for extraction to avoid extra dependencies like adm-zip
        const extractCmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${this.currentDir}' -Force"`;

        try {
            execSync(extractCmd);
            console.log('[UPDATER] Update extracted successfully.');
            fs.unlinkSync(zipPath); // Clean up

            // Note: Since we didn't include database.sqlite and data in the zip, they are preserved.
            // node_modules are also preserved since they are not in the zip.

            console.log('[UPDATER] Update complete. Please restart the application.');
            process.exit(0);
        } catch (error) {
            console.error('[UPDATER] Extraction failed:', error.message);
        }
    }

    downloadFile(url, dest) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(dest);
            https.get(url, (response) => {
                if (response.statusCode === 302) { // Handle redirects
                    return this.downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                }
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(dest, () => { });
                reject(err);
            });
        });
    }
}

module.exports = new Updater();
