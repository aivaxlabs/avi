export function normalizeQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('questions must be a non-empty array.');
  }

  return questions.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`questions[${index}] must be an object.`);
    }
    if (!['single_choice', 'multiple_choice', 'free_text'].includes(item.type)) {
      throw new Error(`questions[${index}].type is invalid.`);
    }
    const question = typeof item.question === 'string' ? item.question.trim() : '';
    if (!question) {
      throw new Error(`questions[${index}].question must be a non-empty string.`);
    }
    if (item.type === 'free_text') return { type: item.type, question };

    if (item.options === undefined) {
      throw new Error(`questions[${index}].options is required for ${item.type}.`);
    }
    const maxOptions = item.type === 'multiple_choice' ? 6 : 3;
    if (!Array.isArray(item.options) || item.options.length < 1 || item.options.length > maxOptions) {
      throw new Error(`questions[${index}].options must contain one to ${maxOptions} options for ${item.type}.`);
    }
    const options = item.options.map((option, optionIndex) => {
      const isObject = option && typeof option === 'object' && !Array.isArray(option);
      const label = typeof option === 'string'
        ? option.trim()
        : isObject && typeof option.label === 'string' ? option.label.trim() : '';
      if (!label || (isObject && option.description !== undefined && typeof option.description !== 'string')) {
        throw new Error(`questions[${index}].options[${optionIndex}] must be a non-empty string or an object with a non-empty label and an optional string description.`);
      }
      return { label, description: isObject ? (option.description ?? '').trim() : '' };
    });
    if (new Set(options.map((option) => option.label)).size !== options.length) {
      throw new Error(`questions[${index}].options must have unique labels.`);
    }
    return {
      type: item.type,
      question,
      options: options.map((option) => option.label),
      ...(options.some((option) => option.description)
        ? { optionDescriptions: options.map((option) => option.description) }
        : {}),
    };
  });
}

export const taskTools = [
  {
    name: 'update_tasks',
    description: 'Replace the current thread task list with the complete provided snapshot. Use optionally for substantial multi-step work, not trivial tasks. Send an empty list to clear it.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          maxItems: 100,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', minLength: 1, maxLength: 200 },
              description: { type: 'string', maxLength: 2000 },
              done: { type: 'boolean' },
              status: {
                type: 'string',
                enum: ['pending', 'completed', 'inconclusive'],
                description: 'Use inconclusive only when a concrete blocker prevents completion.',
              },
              result: { type: 'string', maxLength: 4000, description: 'Empty string when there is no result yet.' },
            },
            required: ['title', 'description', 'done', 'result'],
            additionalProperties: false,
          },
        },
      },
      required: ['tasks'],
      additionalProperties: false,
    },
    execute: async ({ tasks }, { chatRunner, conversationId, workMode }) => {
      if (workMode === 'plan') throw new Error('update_tasks is unavailable in Plan mode.');
      const persisted = chatRunner.replaceTasks(conversationId, tasks);
      return persisted.length === 0
        ? 'Task list cleared.'
        : `Task list updated: ${persisted.length} task(s).`;
    },
  },
  {
    name: 'start_goal',
    description: 'Start a Goal only when explicitly requested by the user or system/developer instructions; do not infer Goals from ordinary tasks. Fails if an unfinished Goal exists; use update_goal_status only for status.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        specification: {
          type: 'string',
          minLength: 1,
          description: 'The complete objective, acceptance terms, constraints, and conditions for authentic completion.',
        },
      },
      required: ['specification'],
      additionalProperties: false,
    },
    execute: async (
      { specification },
      {
        chatRunner,
        conversationId,
        model,
        reasoningEffort,
        permissionMode,
        ultraMode,
      },
    ) => {
      const normalizedSpecification = String(specification ?? '').trim();
      if (!normalizedSpecification) throw new Error('specification is required.');
      const result = await chatRunner.startGoal({
        conversationId,
        model,
        specification: normalizedSpecification,
        reasoningEffort,
        permissionMode,
        ultraMode,
      });
      return [
        'Goal started.',
        `ID: ${result.goal.id}`,
        `Status: ${result.goal.status}`,
        `Started: ${result.goal.startedAt}`,
        'Specification:',
        result.goal.specification,
      ].join('\n');
    },
  },
  {
    name: 'update_goal_status',
    description: 'Classify the active Goal as completed only after verifying every acceptance term, including follow-up criteria. Use blocked as a last resort only when no permitted approach can advance remaining work, after investigating alternatives and completing independent work. Otherwise keep executing the Goal.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['completed', 'blocked'],
        },
        summary: {
          type: 'string',
          minLength: 1,
          description: 'For completed, concrete evidence that every acceptance term was met. For blocked, the exact blocker, approaches tried and their results, why remaining alternatives cannot work, and the minimum input, authority, capability, or external change needed to resume.',
        },
      },
      required: ['status', 'summary'],
      additionalProperties: false,
    },
    execute: async ({ status, summary }, { chatRunner, conversationId }) => {
      if (!['completed', 'blocked'].includes(status)) {
        throw new Error('status must be completed or blocked.');
      }
      const normalizedSummary = String(summary ?? '').trim();
      if (!normalizedSummary) throw new Error('summary is required.');
      const result = await chatRunner.changeGoal({
        conversationId,
        action: status,
        summary: normalizedSummary,
      });
      return [
        `Goal ${result.status}.`,
        `ID: ${result.goal_id}`,
        'Summary:',
        result.summary,
        `Tokens transacted: ${result.tokens_transacted}`,
        `Active time: ${result.active_time_ms} ms`,
        `Started: ${result.started_at}`,
      ].join('\n');
    },
  },
  {
    name: 'ask_question',
    description: 'Ask the user focused questions and wait for actual answers before continuing. Never infer or invent answers. single_choice shows radio buttons (one answer), multiple_choice shows checkboxes (any number of answers), and free_text shows a text box. Each option is a short label, optionally with a Markdown description that explains its consequence. The user can always type an "Other" answer for choice questions.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['single_choice', 'multiple_choice', 'free_text'],
                description: 'single_choice: radio buttons, exactly one answer. multiple_choice: checkboxes, the user may select several options. free_text: open answer without options.',
              },
              question: {
                type: 'string',
                minLength: 1,
              },
              options: {
                type: 'array',
                minItems: 1,
                maxItems: 6,
                description: 'Required for single_choice (up to 3) and multiple_choice (up to 6). Omit for free_text. Answers are returned as option labels.',
                items: {
                  type: 'object',
                  description: 'An option with a label and an optional description.',
                  properties: {
                    label: { type: 'string', minLength: 1, description: 'Short option text returned as the answer.' },
                    description: { type: 'string', description: 'Optional Markdown shown under the label.' },
                  },
                  required: ['label'],
                  additionalProperties: false,
                },
              },
            },
            required: ['type', 'question'],
            additionalProperties: false,
          },
        },
      },
      required: ['questions'],
      additionalProperties: false,
    },
    execute: async ({ questions }, { chatRunner, conversationId, signal, workMode }) => {
      const result = await chatRunner.askQuestion({
        conversationId,
        questions: normalizeQuestions(questions),
        signal,
        workMode: workMode ?? null,
      });
      if (result.cancelled) {
        if (result.afk) {
          return 'The user is away from keyboard (AFK) and did not answer within 60 seconds. No answers were collected. Decide whether to continue without the answers or stop.';
        }
        return 'Question cancelled; no answers were collected.';
      }
      return [
        'User answers:',
        ...result.answers.map(({ question, answer }) => (
          `- ${question}: ${Array.isArray(answer) ? answer.join(', ') : answer}`
        )),
      ].join('\n');
    },
  },
];
