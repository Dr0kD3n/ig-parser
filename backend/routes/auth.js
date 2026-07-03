const authController = require('../lib/auth-controller');
module.exports = (app, { authLimiter }) => {
app.post('/api/auth/login', authLimiter, authController.login);
app.post('/api/auth/signup', authLimiter, authController.signup);
};
