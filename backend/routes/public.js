const fs = require('fs');
const { getLocalPhotoPath } = require('../lib/photo-cache');
module.exports = (app) => {
app.get('/profile-photos/:fileName', (req, res) => {
  const photoPath = getLocalPhotoPath(req.params.fileName);
  if (!photoPath || !fs.existsSync(photoPath)) {
    return res.status(404).send('Photo not found');
  }
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(photoPath);
});
};
