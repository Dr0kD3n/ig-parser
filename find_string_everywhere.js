const fs = require('fs');
const path = require('path');

function searchInDir(dir, pattern) {
    try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
                if (file !== 'node_modules' && file !== '.git') searchInDir(fullPath, pattern);
            } else {
                const content = fs.readFileSync(fullPath);
                if (content.includes(pattern)) {
                    console.log(`FOUND in ${fullPath}`);
                }
            }
        }
    } catch (e) { }
}

const pattern = Buffer.from('Какие цветы любишь', 'utf8');
console.log('--- GLOBAL SEARCH FOR MESSAGES ---');
searchInDir('C:/Users/root/Documents/Projects', pattern);
