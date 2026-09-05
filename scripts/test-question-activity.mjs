import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

for (const quick of [false, true]) {
  const source = readFileSync(new URL(`../src/main/${quick ? 'quick-chat-runner' : 'chat-runner'}.js`, import.meta.url), 'utf8');
  const askStart = source.indexOf(quick ? '  askQuestion(sessionId,' : '  async askQuestion({');
  const askEnd = source.indexOf(quick ? '\n  updateAssistant(' : '\n  getPendingQuestion(', askStart);
  assert.ok(askStart > 0 && askEnd > askStart);
  const activityStart = source.indexOf('  questionActivity(');
  const activityEnd = source.indexOf('\n  answerQuestion(', activityStart);
  const timers = new Map();
  let now = 0;
  let nextTimer = 0;
  const Runner = runInNewContext(`(class {
${source.slice(askStart, askEnd)}
${source.slice(activityStart, activityEnd)}
})`, {
    Error,
    ASK_QUESTION_AFK_TIMEOUT_MS: 60_000,
    randomUUID: () => 'question',
    setTimeout: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, deadline: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  for (const workMode of quick ? ['agent'] : ['agent', 'plan']) {
    for (const ending of ['afk', 'answer', 'abort']) {
      const controller = new AbortController();
      const events = [];
      const runner = new Runner();
      runner.pendingQuestions = new Map();
      runner.runs = new Map([['owner', { controller, workMode }]]);
      runner.emit = (id, event) => events.push({ id, ...event });
      const questions = [{ type: 'free_text', question: 'Name?' }];
      const result = quick
        ? runner.askQuestion('owner', questions, controller.signal)
        : runner.askQuestion({ conversationId: 'owner', questions, signal: controller.signal });
      const scoped = { questionId: 'question', [quick ? 'sessionId' : 'conversationId']: 'owner' };
      assert.equal(timers.size, workMode === 'plan' ? 0 : 1);
      const originalTimer = [...timers.keys()][0];
      now += 59_000;
      assert.equal(runner.questionActivity({ ...scoped, [quick ? 'sessionId' : 'conversationId']: 'other' }), false);
      assert.equal([...timers.keys()][0], originalTimer);
      assert.equal(runner.questionActivity(scoped), true);
      assert.equal(runner.pendingQuestions.size, 1);
      if (workMode !== 'plan') {
        assert.equal(timers.has(originalTimer), false);
        assert.equal([...timers.values()][0].deadline, now + 60_000);
        now += 2_000;
        assert.ok([...timers.values()][0].deadline > now);
      }
      if (ending === 'abort') {
        controller.abort(new Error('Stopped'));
        await assert.rejects(result, /Stopped/);
      } else if (ending === 'answer' || workMode === 'plan') {
        const pending = runner.pendingQuestions.get('question');
        runner.pendingQuestions.delete('question');
        (quick ? pending.resolve : pending.finish)({ answers: ['Ada'] });
        assert.deepEqual((await result).answers, ['Ada']);
      } else {
        now = [...timers.values()][0].deadline;
        [...timers.values()][0].callback();
        assert.equal((await result).afk, true);
        assert.equal(events.at(-1).reason, 'afk');
      }
      assert.equal(timers.size, 0);
      assert.equal(runner.questionActivity(scoped), false);
      assert.equal(runner.pendingQuestions.size, 0);
    }
  }
}

for (const file of ['components/ChatView.jsx', 'QuickChatApp.jsx']) {
  const source = readFileSync(new URL(`../src/renderer/${file}`, import.meta.url), 'utf8');
  for (const event of ['onPointerMove', 'onPointerDown', 'onClick', 'onKeyDownCapture', 'onInput', 'onWheel']) {
    assert.match(source, new RegExp(`${event}=\\{(?:reportQuestionActivity|onActivity)\\}`));
  }
  assert.match(source, /\.questionActivity\(/);
}
const preload = readFileSync(new URL('../src/preload/preload.cjs', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../src/main/runtime.js', import.meta.url), 'utf8');
for (const channel of ['chat:question-activity', 'quick-chat:question-activity']) {
  assert.ok(preload.includes(`invoke('${channel}', payload)`));
  assert.ok(runtime.includes(`applicationIpc.handle('${channel}'`));
}
const remote = readFileSync(new URL('../src/main/remote-mcp-server.js', import.meta.url), 'utf8');
assert.ok(remote.slice(remote.indexOf('const CONVERSATION_RPC_METHODS'), remote.indexOf('const CONVERSATION_SCALAR_METHODS')).includes("'chat:question-activity'"));
console.log('Question activity regression tests passed.');
