const fs = require('fs');

try {
  const data = fs.readFileSync('data/logs.json', 'utf8');
  const logs = JSON.parse(data);
  console.log(JSON.stringify(logs.slice(-10), null, 2));
} catch (e) {
  console.error('Error:', e.message);
}
