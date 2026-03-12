"use strict";

const { AppError, BrowserError, SelectorError, NetworkError } = require('../backend/lib/errors');
const { handleError } = require('../backend/lib/error-handler');

console.log('--- Testing Custom Errors ---');

try {
    throw new SelectorError('.test-selector', 'Element not found in test');
} catch (e) {
    handleError(e);
}

try {
    throw new NetworkError('Proxy connection failed', { proxy: 'http://localhost:8080' });
} catch (e) {
    handleError(e);
}

try {
    throw new AppError('General application failure');
} catch (e) {
    handleError(e);
}

console.log('\n--- Testing Unexpected Error ---');
handleError(new Error('Normal JS Error'));

console.log('\n✅ Verification complete. Check logs and console output.');
