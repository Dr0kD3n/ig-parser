const { getDB } = require('./backend/lib/db');

async function check() {
    const db = await getDB();
    const account = await db.get('SELECT * FROM accounts WHERE name = ?', ['AU']);
    if (account) {
        console.log('Account: ' + account.name);
        console.log('Proxy (masked): ' + (account.proxy ? account.proxy.split(':').slice(0, 2).join(':') + ':***:***' : 'None'));
        console.log('Cookies Length: ' + (account.cookies ? account.cookies.length : 0));
    } else {
        console.log('Account AU not found');
    }
    process.exit(0);
}

check();
