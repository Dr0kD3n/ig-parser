const { execSync } = require('child_process');
const fs = require('fs');
const Database = require('better-sqlite3');

const commits = execSync('git rev-list master').toString().split('\n').filter(Boolean);
console.log(`Checking ${commits.length} commits for dmSent...`);

for (const commit of commits) {
    try {
        const fileContent = execSync(`git show ${commit}:config/database.sqlite`, { encoding: 'as-buffer', maxBuffer: 10 * 1024 * 1024 });
        fs.writeFileSync('temp_git_2.sqlite', fileContent);

        const db = new Database('temp_git_2.sqlite');
        const countSent = db.prepare("SELECT count(*) as c FROM profiles WHERE dmSent = 1").get().c;
        const countProfiles = db.prepare("SELECT count(*) as c FROM profiles").get().c;
        const countMsg = db.prepare("SELECT count(*) as c FROM sqlite_master WHERE name='messages_log'").get().c > 0
            ? db.prepare("SELECT count(*) as c FROM messages_log").get().c
            : 0;

        console.log(`COMMIT ${commit.slice(0, 7)}: Profiles=${countProfiles}, Sent=${countSent}, MsgLogs=${countMsg}`);

        if (countSent >= 100 || countMsg >= 100) {
            console.log('--- FOUND 100+ SENT DATA! ---');
            break;
        }
        db.close();
    } catch (e) { }
}
if (fs.existsSync('temp_git_2.sqlite')) fs.unlinkSync('temp_git_2.sqlite');
