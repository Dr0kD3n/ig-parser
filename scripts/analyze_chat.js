'use strict';
const fs = require('fs/promises');

async function main() {
    const data = JSON.parse(await fs.readFile('tmp/chat_structure.json', 'utf8'));
    console.log(`URL: ${data.url}`);

    // Sort items by Y axis to see flow
    const entries = data.items.sort((a, b) => a.rect.y - b.rect.y);

    const centerMessages = entries.filter(it => it.rect.x > 330 && it.text.length > 0);

    console.log(`Found ${centerMessages.length} center items.`);
    centerMessages.slice(-20).forEach(m => {
        console.log(`[X=${Math.round(m.rect.x)}, Y=${Math.round(m.rect.y)}] ${m.text.substring(0, 50)} | Class: ${m.class.split(' ')[0]}`);
    });
}
main();
