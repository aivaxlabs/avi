export function decorateToolsForInvocation(
  tools,
  permissionMode = 'approve_for_me',
  { honorExplicitAuthorization = false } = {},
) {
  const toolNames = new Set();
  for (const tool of tools) {
    const name = String(tool?.name ?? '');
    if (!name) throw new Error('Every chat tool requires a name.');
    if (toolNames.has(name)) throw new Error(`Chat tool name "${name}" is duplicated.`);
    if (
      tool.forcedTruncationLength !== undefined
      && (!Number.isInteger(tool.forcedTruncationLength) || tool.forcedTruncationLength <= 0)
    ) {
      throw new Error(`Chat tool "${name}" forcedTruncationLength must be a positive integer.`);
    }
    toolNames.add(name);
  }

  return tools.map((tool) => ({
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        __invocation_goal: {
          type: 'string',
          description: 'A short description of the goal of this specific tool invocation.',
        },
        __requires_human_approval: {
          type: 'boolean',
          description: tool.approval === 'never'
            ? 'Set this to false because this tool does not require a separate approval.'
            : {
              ask_for_approval: 'Set this to true for every tool invocation because the user selected Ask for approval, unless explicit user guidance always allows this invocation.',
              approve_for_me: honorExplicitAuthorization
                ? 'Set this to false when the invocation is within the user’s current request, the bot owner’s recurring instructions, or a prior approval for this exact action. This includes ordinary local edits, implementation, builds, tests, regeneration, and validation needed to complete the authorized outcome. Set it to true only for a materially new, unapproved action with meaningful external, irreversible, financial, credential, privacy, production, or destructive impact. Never ask the user to approve the same decision twice.'
                : 'Set this to true only when this specific invocation needs explicit human approval, or false when it can proceed safely.',
              full_access: 'Set this to false because the user selected Full access.',
            }[permissionMode] ?? 'Set this to true only when this specific invocation needs explicit human approval.',
        },
        ...Object.fromEntries(
          Object.entries(tool.inputSchema.properties ?? {}).filter(
            ([name]) => !['__invocation_goal', '__requires_human_approval'].includes(name),
          ),
        ),
      },
      required: [
        '__invocation_goal',
        '__requires_human_approval',
        ...(tool.inputSchema.required ?? []).filter(
          (name) => !['__invocation_goal', '__requires_human_approval'].includes(name),
        ),
      ],
      additionalProperties: tool.inputSchema.additionalProperties ?? false,
    },
  }));
}
