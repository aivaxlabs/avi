import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { responsesApi, chatCompletionsApi } from '../src/providers/openai-compatible.js';

const timestamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-') + '-UTC';
const root = join(tmpdir(), '.avi', 'visualizations', timestamp, 'missing-media');
mkdirSync(root, { recursive: true });
const workspace = mkdtempSync(join(root, 'test-'));
try {
  for (const api of [responsesApi, chatCompletionsApi]) {
    for (const type of ['image_url', 'video_url']) {
      const mediaPath = join(workspace, `deleted-${type}.bin`);
      writeFileSync(mediaPath, 'media');
      const media = { type, [type]: { path: mediaPath } };
      const input = {
        provider: {},
        model: { id: 'test:model', modelId: 'test' },
        tools: [],
        messages: [{ role: 'user', content: [media] }],
        toolHistory: [{
          toolCalls: [],
          results: [{ callId: 'media', output: 'Media loaded', mediaContent: [media] }],
        }],
      };
      const present = await api.createBody(input);
      assert.ok((present.input ?? present.messages).some((message) => (
        Array.isArray(message.content) && message.content.some((part) => (
          part.type === type || part.type === (type === 'image_url' ? 'input_image' : 'input_video')
        ))
      )));
      rmSync(mediaPath);
      for (const missingPath of [mediaPath, join(mediaPath, 'nested.png')]) {
        media[type].path = missingPath;
        const missing = await api.createBody(input);
        const notices = (missing.input ?? missing.messages).flatMap((message) => (
          Array.isArray(message.content) ? message.content : []
        ));
        assert.equal(notices.length, 2);
        for (const notice of notices) {
          assert.equal(notice.type, api === responsesApi ? 'input_text' : 'text');
          assert.ok(notice.text.includes(missingPath));
          assert.match(notice.text, /unavailable.*no longer exists/);
        }
        assert.deepEqual(media, { type, [type]: { path: missingPath } });
      }
      await assert.rejects(api.createBody({
        ...input,
        messages: [{ role: 'user', content: [{ type, [type]: { path: workspace } }] }],
      }), /regular file/);
      const remote = { type, [type]: { url: 'https://example.com/media' } };
      const remoteBody = await api.createBody({ ...input, messages: [{ role: 'user', content: [remote] }], toolHistory: [] });
      assert.ok(JSON.stringify(remoteBody).includes('https://example.com/media'));
    }
  }
  console.log('Missing media tests passed (Responses and Chat Completions; images and videos).');
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
