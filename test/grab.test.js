import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grabScreenThumbnail } from '../src/recorder.js';
import { checkFfmpeg } from '../src/health.js';

const HAS_FFMPEG = checkFfmpeg();

// Exercises the full grab -> rawvideo -> half-block render pipeline against a
// synthetic lavfi source, so it needs no real display or capture permission.
test(
  'grabScreenThumbnail renders a synthetic source to half-block lines',
  { skip: !HAS_FFMPEG },
  async () => {
    const thumb = await grabScreenThumbnail({
      inputFormat: 'lavfi',
      inputSpec: 'testsrc=size=320x180:rate=30',
      width: 24,
      height: 12,
    });
    assert.ok(thumb, 'expected a thumbnail');
    assert.equal(thumb.width, 24);
    assert.equal(thumb.height, 12);
    assert.equal(thumb.lines.length, 6); // 12px tall / 2 rows-per-cell
    assert.equal((thumb.lines[0].match(/▀/g) || []).length, 24);
  },
);

test('grabScreenThumbnail resolves null when ffmpeg is missing', async () => {
  const thumb = await grabScreenThumbnail({
    ffmpegPath: '/nonexistent/ffmpeg-binary',
    inputFormat: 'lavfi',
    inputSpec: 'testsrc=size=320x180',
  });
  assert.equal(thumb, null);
});
