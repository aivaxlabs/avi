const MENTION_DIRECTIVE = /(?<![\w:]):{1,2}mention\{([^}\n]*)\}/g;
const MENTION_ATTRIBUTE = /\b(bot-id|thread-id)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'}]+))/;

export function findMentions(text) {
  const prose = String(text ?? '')
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '')
    .replace(/`[^`\n]*`/g, '');
  return [...prose.matchAll(MENTION_DIRECTIVE)].flatMap((match) => {
    const attribute = MENTION_ATTRIBUTE.exec(match[1]);
    const id = (attribute?.[2] ?? attribute?.[3] ?? attribute?.[4] ?? '').trim();
    if (!id) return [];
    return [{ type: attribute[1] === 'bot-id' ? 'bot' : 'thread', id }];
  });
}
