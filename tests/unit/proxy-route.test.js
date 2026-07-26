import { describe, expect, it } from 'vitest';

const { parseAllowedImageUrl } = require('../../backend/routes/proxy');

describe('image proxy URL policy', () => {
  it('allows Instagram image hosts', () => {
    expect(parseAllowedImageUrl('https://scontent.cdninstagram.com/photo.jpg').hostname).toBe(
      'scontent.cdninstagram.com'
    );
  });

  it('blocks localhost and lookalike hosts', () => {
    expect(() => parseAllowedImageUrl('http://127.0.0.1:5001/api/settings')).toThrow(
      'Image host is not allowed'
    );
    expect(() => parseAllowedImageUrl('https://cdninstagram.com.evil.example/photo.jpg')).toThrow(
      'Image host is not allowed'
    );
  });
});
