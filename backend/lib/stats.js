const { getDB } = require('./db');

/**
 * Updates or inserts a record in the messages_log table.
 * @param {string} threadId The unique ID/URL of the chat.
 * @param {string} templateText The first message sent by 'Me'.
 * @param {Array} messages Array of {text: string, isOwn: boolean}
 */
async function updateChatStats(threadId, templateText, messages) {
    if (!messages || messages.length === 0) return;
    if (!templateText) {
        const firstOwn = messages.find(m => m.isOwn);
        if (firstOwn) templateText = firstOwn.text;
    }
    if (!templateText) return;

    let hasReply = false;
    let continuedAfterReply = false;

    const firstOwnIndex = messages.findIndex(m => m.isOwn && m.text === templateText);
    const messagesAfterFirst = messages.slice(firstOwnIndex === -1 ? 0 : firstOwnIndex + 1);

    for (const m of messagesAfterFirst) {
        if (!m.isOwn) {
            hasReply = true;
        } else if (hasReply && m.isOwn) {
            continuedAfterReply = true;
        }
    }

    let finalStatus = 'sent';
    if (continuedAfterReply) finalStatus = 'continued';
    else if (hasReply) finalStatus = 'replied';

    const totalMessages = messages.length;
    const db = await getDB();

    try {
        const existing = await db.get('SELECT id, status FROM messages_log WHERE url = ? AND message_text = ?', [threadId, templateText]);

        if (existing) {
            await db.run('UPDATE messages_log SET status = ?, total_count = ? WHERE id = ?', [finalStatus, totalMessages, existing.id]);
        } else {
            await db.run('INSERT INTO messages_log (url, message_text, status, total_count, timestamp) VALUES (?, ?, ?, ?, ?)', [
                threadId,
                templateText,
                finalStatus,
                totalMessages,
                new Date().toISOString()
            ]);
        }
    } catch (e) {
        console.error(`[STATS_LIB ERROR] Failed to update stats for ${threadId}: ${e.message}`);
    }
}

module.exports = { updateChatStats };
