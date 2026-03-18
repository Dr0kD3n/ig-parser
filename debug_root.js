const { getRootPath } = require('./backend/lib/utils');
const path = require('path');
console.log('getRootPath():', getRootPath());
console.log('publicDir candidate:', path.join(getRootPath(), 'public'));
