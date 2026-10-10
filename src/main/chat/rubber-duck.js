import { answerTextFromTextualBlocks } from '../../shared/textual-blocks.js';
import {
  forkConversation,
  getConversation,
  getMessage,
  getMessages,
  listRubberDucks,
  updateConversation,
} from '../database.js';

export const rubberDuckMethods = {
  async startRubberDuck({
    conversationId,
    context = null,
    permissionMode = 'approve_for_me',
    signal,
  }) {
    const subject = getConversation(conversationId);
    if (!subject || subject.isSideChat || subject.isSubagent) {
      throw new Error('Rubber Duck can only judge a normal or Rubber Duck thread.');
    }
    const configuredModel = this.getPreferences().defaultModels?.supervision;
    if (!configuredModel?.modelId) {
      throw new Error('Configure a Supervision Model in Settings before invoking Rubber Duck.');
    }
    const selection = this.registry.resolve(configuredModel.modelId);
    if (!selection) throw new Error('The configured Supervision Model is unavailable.');

    const result = forkConversation(subject.id, {
      rubberDuck: true,
      rubberDuckContext: context,
    });
    if (!result) throw new Error('The Rubber Duck thread could not be created.');
    const rubberDuck = updateConversation(result.conversation.id, { model: selection.model.id });
    let rootSubject = subject;
    while (rootSubject.isRubberDuck && rootSubject.parentConversationId) {
      rootSubject = getConversation(rootSubject.parentConversationId) ?? rootSubject;
      if (!rootSubject.isRubberDuck) break;
    }
    this.emit(subject.id, {
      type: 'rubber-duck-created',
      rubberDuck,
      rootConversationId: rootSubject.id,
    });
    const abortRubberDuck = () => this.stop(rubberDuck.id, { pauseGoal: false });
    signal?.addEventListener('abort', abortRubberDuck, { once: true });

    try {
      const prompt = [
        'Judge the subject agent’s execution through a focused interview.',
        context ? `Invocation focus: ${String(context).trim()}` : 'No invocation focus was provided; decide what deserves scrutiny.',
        'Ask only questions that materially improve the verdict, inspect read-only evidence when useful, then submit the report with rubber_duck_submit_report.',
      ].join('\n');
      await this.send({
        conversationId: rubberDuck.id,
        model: selection.model.id,
        reasoningEffort: configuredModel.reasoningEffort,
        permissionMode,
        text: prompt,
        fromAgent: true,
        project: { path: rubberDuck.projectPath },
      });

      const waitForRun = async () => {
        const run = this.runs.get(rubberDuck.id);
        if (run) await run.completion;
      };
      await waitForRun();
      if (signal?.aborted) throw signal.reason ?? new Error('Rubber Duck was interrupted.');
      if (!this.rubberDuckReports.has(rubberDuck.id)) {
        await this.send({
          conversationId: rubberDuck.id,
          model: selection.model.id,
          reasoningEffort: configuredModel.reasoningEffort,
          permissionMode,
          text: 'The judgment must end now. Submit the complete report immediately with rubber_duck_submit_report.',
          fromAgent: true,
          project: { path: rubberDuck.projectPath },
        });
        await waitForRun();
      }

      const report = this.rubberDuckReports.get(rubberDuck.id);
      if (!report) throw new Error('Rubber Duck ended without submitting a report.');
      this.rubberDuckReports.delete(rubberDuck.id);
      return { rubberDuck, report };
    } finally {
      signal?.removeEventListener('abort', abortRubberDuck);
    }
  },

  async askRubberDuckSubject({
    conversationId,
    question,
    permissionMode = 'approve_for_me',
    signal,
  }) {
    const rubberDuck = getConversation(conversationId);
    if (rubberDuck?.conversationType !== 'rubber_duck' || !rubberDuck.parentConversationId) {
      throw new Error('This tool is only available inside a Rubber Duck thread.');
    }
    const normalizedQuestion = String(question ?? '').trim();
    if (!normalizedQuestion) throw new Error('question is required.');
    const subject = getConversation(rubberDuck.parentConversationId);
    if (!subject) throw new Error('The subject thread no longer exists.');
    if (!this.registry.resolve(subject.model)) throw new Error('The subject agent model is unavailable.');

    // The supervisor may ask several questions in one parallel tool round; the subject thread answers them one at a time.
    const previousQuestion = this.rubberDuckInterviews.get(rubberDuck.id) ?? Promise.resolve();
    const answer = previousQuestion.catch(() => {}).then(async () => {
      if (signal?.aborted) throw signal.reason ?? new Error('Rubber Duck was interrupted.');
      let subjectThread = listRubberDucks(rubberDuck.id).find((conversation) => (
        conversation.conversationType === 'rubber_duck_subject'
        && conversation.parentConversationId === rubberDuck.id
      ));
      if (!subjectThread) {
        const sourceEnd = getMessages(rubberDuck.id).find((message) => (
          message.hidden && message.content === '<rubber-duck-source-end />'
        ));
        const result = forkConversation(rubberDuck.id, {
          rubberDuckSubject: true,
          throughMessageId: sourceEnd?.id ?? null,
        });
        if (!result) throw new Error('The Rubber Duck interview thread could not be created.');
        subjectThread = updateConversation(result.conversation.id, { model: subject.model });
        let rootSubject = subject;
        while (rootSubject.isRubberDuck && rootSubject.parentConversationId) {
          rootSubject = getConversation(rootSubject.parentConversationId) ?? rootSubject;
          if (!rootSubject.isRubberDuck) break;
        }
        this.emit(subject.id, {
          type: 'rubber-duck-created',
          rubberDuck: subjectThread,
          rootConversationId: rootSubject.id,
        });
      }

      const stopSubject = () => this.stop(subjectThread.id, { pauseGoal: false });
      signal?.addEventListener('abort', stopSubject, { once: true });
      try {
        const result = await this.send({
          conversationId: subjectThread.id,
          model: subject.model,
          reasoningEffort: getMessages(subject.id).findLast((message) => (
            message.role === 'assistant' && message.reasoningEffort
          ))?.reasoningEffort ?? null,
          permissionMode,
          text: [
            '<rubber_duck_question>',
            normalizedQuestion,
            '</rubber_duck_question>',
          ].join('\n'),
          fromAgent: true,
          project: { path: subjectThread.projectPath },
        });
        const run = this.runs.get(subjectThread.id);
        if (result.queued || !run) throw new Error('The subject agent is busy and could not answer.');
        await run.completion;
        if (signal?.aborted) throw signal.reason ?? new Error('Rubber Duck was interrupted.');

        const answerMessage = getMessage(run.assistantMessageId);
        if (answerMessage?.status !== 'completed') {
          const failure = answerMessage?.segments.findLast((segment) => segment.type === 'error')?.message;
          throw new Error(failure || 'The subject agent did not finish its answer.');
        }
        return answerTextFromTextualBlocks(answerMessage.content).trim()
          || 'The subject agent returned no answer.';
      } finally {
        signal?.removeEventListener('abort', stopSubject);
      }
    });
    this.rubberDuckInterviews.set(rubberDuck.id, answer);
    try {
      return await answer;
    } finally {
      if (this.rubberDuckInterviews.get(rubberDuck.id) === answer) {
        this.rubberDuckInterviews.delete(rubberDuck.id);
      }
    }
  },

  submitRubberDuckReport({ conversationId, report }) {
    const rubberDuck = getConversation(conversationId);
    if (!rubberDuck?.isRubberDuck) {
      throw new Error('This tool is only available inside a Rubber Duck thread.');
    }
    const normalizedReport = String(report ?? '').trim();
    if (!normalizedReport) throw new Error('report is required.');
    this.rubberDuckReports.set(conversationId, normalizedReport);
    const run = this.runs.get(conversationId);
    if (run) run.endAfterTools = true;
    return 'Rubber Duck report submitted. End the judgment now.';
  },
};
