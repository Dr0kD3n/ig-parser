module.exports = function mountRoutes(app, middleware) {
  const { authLimiter, apiLimiter, verifyToken, isAdmin, onClearLogs } = middleware;
  app.use('/api', apiLimiter);
  require('./auth')(app, { authLimiter });
  require('./public')(app);
  app.use('/api', verifyToken);
  app.use('/api/bot/start', authLimiter);
  app.get('/api/admin/users', isAdmin, async (req, res) => {
    res.status(501).json({ error: 'Managed by main server' });
  });
  require('./profiles')(app);
  require('./settings')(app);
  require('./messaging')(app);
  require('./schedule')(app);
  require('./accounts')(app);
  require('./proxy')(app);
  require('./presets')(app);
  require('./donors')(app);
  require('./admin')(app, { onClearLogs });
};
