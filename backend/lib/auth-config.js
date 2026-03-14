const path = require('path');
// require('dotenv').config({ path: path.join(__dirname, '../.env') });

module.exports = {
    JWT_SECRET: process.env.JWT_SECRET || 'super_secret_fallback_key',
    JWT_PUBLIC_KEY: process.env.JWT_PUBLIC_KEY || null,
    IS_ASYMMETRIC: process.env.IS_ASYMMETRIC === 'true'
};
