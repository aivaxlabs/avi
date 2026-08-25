import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const composerSource = readFileSync(
  new URL('../src/renderer/components/Composer.jsx', import.meta.url),
  'utf8',
);

for (const commandId of ['ultra', 'plan', 'goal', 'efforts', 'models']) {
  assert.match(
    composerSource,
    new RegExp(`id: '${commandId}',[\\s\\S]*?availableInBot: false,`),
    `/${commandId} should be unavailable in bot conversations.`,
  );
}
assert.match(
  composerSource,
  /\(!botMode \|\| command\.availableInBot !== false\)/,
);
assert.match(
  composerSource,
  /if \(botMode && option\.availableInBot === false\) \{[\s\S]*?exitCommandMode\(\);[\s\S]*?return;/,
);
assert.match(
  composerSource,
  /const effectiveWorkMode = activeGoal \? 'goal' : botMode \? null : workMode;/,
);
assert.match(
  composerSource,
  /const effectiveUltraMode = botMode \? false : ultraMode;/,
);
assert.match(
  composerSource,
  /\{tasks\.length > 0 && \(\s*<ComposerStrip[^>]*className="tasks-strip"/,
);
assert.match(
  composerSource,
  /\{subagents\.length > 0 && \(\s*<ComposerStrip[\s\S]*?className="subagent-strip"/,
);
assert.doesNotMatch(composerSource, /tasks\.length > 0 && !botMode/);
assert.doesNotMatch(composerSource, /subagents\.length > 0 && !botMode/);

console.log('Bot composer strip and command availability tests passed.');
