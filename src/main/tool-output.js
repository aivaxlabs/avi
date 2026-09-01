import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RECENT_ASSISTANT_TURN_COUNT = 4;
const OLDER_TOOL_OUTPUT_LIMIT_RATIO = 0.8;
const INSPECT_THREAD_TOOL_OUTPUT_LIMIT_RATIO = 0.2;
const ESTIMATED_CHARACTERS_PER_TOKEN = 4;
const MIN_JSON_PARSE_LENGTH = 32_768;
const TRUNCATION_MARKER_PATTERN = /\n\n\[\.\.\. (\d+) chars truncated, (\d+) lines total, full result available at (.+)\](?:\n\n([\s\S]*))?$/;

export function minifyToolOutputJson(output, toolOutputLimit) {
  if (
    toolOutputLimit !== null
    && output.length > Math.max(toolOutputLimit, MIN_JSON_PARSE_LENGTH)
  ) return output;

  try {
    return JSON.stringify(JSON.parse(output));
  } catch {
    return output;
  }
}

export function toolOutputLimitForTool(tool, toolOutputLimit) {
  if (tool?.forcedTruncationLength !== undefined) {
    return tool.forcedTruncationLength * ESTIMATED_CHARACTERS_PER_TOKEN;
  }
  return tool?.name === 'chat_inspect_thread' && toolOutputLimit !== null
    ? Math.floor(toolOutputLimit * INSPECT_THREAD_TOOL_OUTPUT_LIMIT_RATIO)
    : toolOutputLimit;
}

export function truncateToolOutput(output, limit, reuseExistingResult = false) {
  if (limit === null) return output;

  const existingTruncation = reuseExistingResult
    ? TRUNCATION_MARKER_PATTERN.exec(output)
    : null;
  const resultPath = existingTruncation?.[3];
  const existingEnd = existingTruncation?.[4];
  let source = output;
  let fullLength = output.length;
  let totalLines = output.replaceAll('\r\n', '\n').split('\n').length;

  if (existingTruncation) {
    const existingStart = output.slice(0, existingTruncation.index);
    fullLength = existingStart.length
      + (existingEnd?.length ?? 0)
      + Number(existingTruncation[1]);
    totalLines = Number(existingTruncation[2]);
    if (existingEnd !== undefined) {
      source = `${existingStart}${existingEnd}`;
    } else if (existsSync(resultPath)) {
      source = readFileSync(resultPath, 'utf8');
    } else {
      return output;
    }
  }
  if (source.length <= limit) return output;

  let fullResultPath = resultPath;
  if (!fullResultPath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultDirectory = join(tmpdir(), '.avi', 'toolcalls', timestamp);
    mkdirSync(resultDirectory, { recursive: true });
    fullResultPath = join(resultDirectory, `${randomUUID()}.txt`);
    writeFileSync(fullResultPath, source, 'utf8');
  }

  const startLength = Math.floor(limit / 4);
  const endLength = limit - startLength;
  const marker = `[... ${fullLength - limit} chars truncated, ${totalLines} lines total, full result available at ${fullResultPath}]`;
  return `${source.slice(0, startLength)}\n\n${marker}\n\n${source.slice(-endLength)}`;
}

export function limitToolHistoryResults(toolHistory, tools, toolOutputLimit) {
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const fullLimitStartIndex = Math.max(
    0,
    toolHistory.length - (RECENT_ASSISTANT_TURN_COUNT - 1),
  );
  const olderLimit = toolOutputLimit === null
    ? null
    : Math.floor(toolOutputLimit * OLDER_TOOL_OUTPUT_LIMIT_RATIO);

  return toolHistory.map((round, roundIndex) => ({
    ...round,
    results: round.results.map((result) => {
      const toolName = round.toolCalls.find((toolCall) => (
        toolCall.callId === result.callId
      ))?.name;
      const tool = toolsByName.get(toolName);
      const outputLimit = tool?.forcedTruncationLength !== undefined || toolName === 'chat_inspect_thread'
        ? toolOutputLimitForTool(tool ?? { name: toolName }, toolOutputLimit)
        : roundIndex < fullLimitStartIndex ? olderLimit : toolOutputLimit;
      return {
        ...result,
        output: truncateToolOutput(
          minifyToolOutputJson(result.output, outputLimit),
          outputLimit,
          true,
        ),
      };
    }),
  }));
}
