try {
    require("../backend/lib/state");
    console.log("state.js OK");
} catch (e) {
    console.error("state.js ERROR:", e.message);
}

// Check restore.js syntax by parsing it
const fs = require('fs');
try {
    const code = fs.readFileSync(require('path').join(__dirname, '..', 'backend', 'restore.js'), 'utf8');
    // Try to just parse it via Function (loose check)
    new Function(code);
    console.log("restore.js syntax OK");
} catch (e) {
    console.error("restore.js syntax ERROR:", e.message);
}

// Check index.js syntax
try {
    const code2 = fs.readFileSync(require('path').join(__dirname, '..', 'backend', 'index.js'), 'utf8');
    new Function(code2);
    console.log("index.js syntax OK");
} catch (e) {
    console.error("index.js syntax ERROR:", e.message);
}
