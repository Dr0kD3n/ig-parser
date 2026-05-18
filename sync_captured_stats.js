const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.resolve('config/database.sqlite');
const jsonPath = path.resolve('tmp/ig_inbox_captured.json');

if (!fs.existsSync(jsonPath)) {
    console.error('Captured JSON not found at:', jsonPath);
    process.exit(1);
}

const db = new Database(dbPath);
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

console.log(`Processing ${data.length} captured response chunks...`);

let importedCount = 0;
let threadsProcessed = new Set();
// We assume the owner ID is the one sending the first message in our patterns
const OWNER_FBID = '17842256939555836';

for (const entry of data) {
    if (!entry.data || !entry.data.data) continue;

    // Look for mailbox data
    const mailbox = entry.data.data.get_slide_mailbox_for_iris_subscription;
    if (!mailbox || !mailbox.threads_by_folder) continue;

    const threads = mailbox.threads_by_folder.edges || [];
    for (const edge of threads) {
        const node = edge.node;
        if (!node || threadsProcessed.has(node.id)) continue;
        threadsProcessed.add(node.id);

        const thread = node.as_ig_direct_thread;
        if (!thread) continue;

        const users = thread.users || [];
        const recipient = users[0] || {};
        const username = recipient.username || recipient.full_name || 'unknown';
        const url = `https://www.instagram.com/${username}/`;

        // Look for messages in this thread
        const messages = thread.slide_messages?.edges || [];
        let myLastMessage = null;
        let userReplied = false;
        let lastTimestamp = thread.last_activity_timestamp_ms;

        for (const msgEdge of messages) {
            const msg = msgEdge.node;
            if (msg.sender_fbid === OWNER_FBID) {
                if (!myLastMessage) myLastMessage = msg;
            } else {
                userReplied = true;
            }
        }

        if (myLastMessage) {
            const status = userReplied ? 'replied' : 'sent';
            const timestamp = new Date(parseInt(myLastMessage.timestamp_ms)).toISOString();

            // Upsert into messages_log
            try {
                const existing = db.prepare('SELECT id FROM messages_log WHERE url = ? AND message_text = ?').get(url, myLastMessage.text_body);
                if (!existing) {
                    db.prepare('INSERT INTO messages_log (url, username, message_text, status, timestamp) VALUES (?, ?, ?, ?, ?)')
                        .run(url, username, myLastMessage.text_body, status, timestamp);
                    importedCount++;
                } else {
                    // Update status if it changed to replied
                    if (status === 'replied') {
                        db.prepare('UPDATE messages_log SET status = ? WHERE id = ?').run(status, existing.id);
                    }
                }

                // Also update profiles table to keep them consistent
                db.prepare('UPDATE profiles SET dmSent = 1, tgTagged = ? WHERE url = ? OR username = ?')
                    .run(userReplied ? 1 : 0, url, username);

            } catch (e) {
                console.error(`Error processing msg for ${username}:`, e.message);
            }
        }
    }
}

console.log(`Successfully synced ${importedCount} new message records from captured JSON.`);
console.log(`Total threads analyzed: ${threadsProcessed.size}`);
db.close();
