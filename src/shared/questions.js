export const QUESTION_TYPES = Object.freeze(['single_choice', 'multiple_choice', 'free_text']);
export const QUESTION_OPTION_LIMITS = Object.freeze({ single_choice: 10, multiple_choice: 30 });

export const QUESTIONS_SCHEMA = Object.freeze({
  type: 'array',
  minItems: 1,
  items: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: [...QUESTION_TYPES],
        description: 'single_choice: radio buttons, exactly one answer. multiple_choice: checkboxes, the user may select several options. free_text: open answer without options.',
      },
      question: {
        type: 'string',
        minLength: 1,
      },
      options: {
        type: 'array',
        minItems: 1,
        maxItems: QUESTION_OPTION_LIMITS.multiple_choice,
        description: `Required for single_choice (up to ${QUESTION_OPTION_LIMITS.single_choice}) and multiple_choice (up to ${QUESTION_OPTION_LIMITS.multiple_choice}). Omit for free_text. Answers are returned as option labels.`,
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
});

export function normalizeQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('questions must be a non-empty array.');
  }

  return questions.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`questions[${index}] must be an object.`);
    }
    if (!QUESTION_TYPES.includes(item.type)) {
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
    const maxOptions = QUESTION_OPTION_LIMITS[item.type];
    if (!Array.isArray(item.options) || item.options.length < 1 || item.options.length > maxOptions) {
      throw new Error(`questions[${index}].options must contain one to ${maxOptions} options for ${item.type}.`);
    }
    const descriptions = Array.isArray(item.optionDescriptions) ? item.optionDescriptions : [];
    const options = item.options.map((option, optionIndex) => {
      const isObject = option && typeof option === 'object' && !Array.isArray(option);
      const label = typeof option === 'string'
        ? option.trim()
        : isObject && typeof option.label === 'string' ? option.label.trim() : '';
      const description = isObject ? option.description : descriptions[optionIndex];
      if (!label || (description !== undefined && typeof description !== 'string')) {
        throw new Error(`questions[${index}].options[${optionIndex}] must be a non-empty string or an object with a non-empty label and an optional string description.`);
      }
      return { label, description: (description ?? '').trim() };
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

export function normalizeQuestionAnswers(questions, answers) {
  if (!Array.isArray(answers) || answers.length !== questions.length) {
    throw new Error('Every question must have exactly one answer.');
  }

  return questions.map((question, index) => {
    const answer = answers[index];
    if (
      !answer
      || typeof answer !== 'object'
      || Array.isArray(answer)
      || answer.question !== question.question
    ) {
      throw new Error(`Answer ${index + 1} does not match its question.`);
    }
    if (question.type === 'multiple_choice') {
      if (
        !Array.isArray(answer.answer)
        || answer.answer.length === 0
        || answer.answer.some((option) => typeof option !== 'string' || !option.trim())
      ) {
        throw new Error(`Answer ${index + 1} must contain selected options.`);
      }
      return {
        question: question.question,
        answer: [...new Set(answer.answer.map((option) => option.trim()))],
      };
    }
    const value = typeof answer.answer === 'string' ? answer.answer.trim() : '';
    if (!value) {
      throw new Error(`Answer ${index + 1} must be non-empty.`);
    }
    return { question: question.question, answer: value };
  });
}

export function formatQuestionAnswers(answers) {
  return [
    'User answers:',
    ...answers.map(({ question, answer }) => (
      `- ${question}: ${Array.isArray(answer) ? answer.join(', ') : answer}`
    )),
  ].join('\n');
}
