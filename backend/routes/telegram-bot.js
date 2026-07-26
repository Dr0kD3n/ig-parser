'use strict';

const { telegramBotService } = require('../lib/telegram-bot-service');

module.exports = (app) => {
  app.get('/api/telegram-bot/status', async (req, res) => {
    try {
      res.json(await telegramBotService.getStatus());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/telegram-bot/config', async (req, res) => {
    try {
      res.json(await telegramBotService.configure(req.body?.token));
    } catch (error) {
      res.status(error.statusCode || 502).json({ error: error.message });
    }
  });

  app.post('/api/telegram-bot/start', async (req, res) => {
    try {
      res.json(await telegramBotService.enable());
    } catch (error) {
      res.status(error.statusCode || 502).json({ error: error.message });
    }
  });

  app.post('/api/telegram-bot/stop', async (req, res) => {
    try {
      res.json(await telegramBotService.disable());
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.delete('/api/telegram-bot/config', async (req, res) => {
    try {
      res.json(await telegramBotService.remove());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/telegram-bot/pair', async (req, res) => {
    try {
      res.json(await telegramBotService.createPairing());
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message });
    }
  });

  app.delete('/api/telegram-bot/pair', async (req, res) => {
    try {
      res.json(await telegramBotService.unpair());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};
