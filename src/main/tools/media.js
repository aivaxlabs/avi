import { readFile, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute } from 'node:path';
import { defaultMediaSizeLimit } from '../../shared/attachments.js';
import { AIVAX_LONG_INFERENCE_BASE_URL, requestAivax } from '../aivax-client.js';
import { attachmentToApiBlock } from '../database.js';
import { filePathToAttachment, materializeAttachment } from '../files.js';

const MEDIA_DESCRIPTIONS_SIZE_LIMIT = 20 * 1024 * 1024;

export const mediaTools = [
  {
    name: 'get_chat_attachments',
    description: 'Get local paths and stable attachment indexes for images, audio, and videos attached by the user in the current chat. Existing files are returned directly; inference-only media is copied to temporary storage first.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async (_input, { userAttachments = [] }) => {
      const mediaAttachments = userAttachments.filter((attachment) => (
        ['image_url', 'input_audio', 'video_url'].includes(attachment?.kind)
        || ['image', 'audio', 'video'].some((type) => attachment?.mime?.startsWith(`${type}/`))
      ));
      const results = [];
      const seen = new Set();

      for (const [attachmentIndex, attachment] of mediaAttachments.entries()) {
        const identity = attachment.id
          ?? attachment.path
          ?? attachment.dataUrl
          ?? attachment.base64;
        if (identity && seen.has(identity)) continue;
        if (identity) seen.add(identity);

        const localFile = await materializeAttachment(attachment);
        if (!localFile) continue;

        results.push({
          attachmentIndex,
          name: attachment.name ?? basename(localFile.path),
          kind: attachment.kind,
          mime: attachment.mime ?? null,
          ...localFile,
        });
      }

      return { attachments: results };
    },
  },
  {
    name: 'read_media_file',
    description: 'Read local images, videos, audio, and PDFs. The selected model reads supported media directly; when connected and enabled, AIVAX Media Descriptions converts unsupported media to text and the optional extractionGuidance refines that extraction. extractionGuidance is ignored when the model reads the media directly. Text files are not supported. Media already attached to the conversation is delivered to you directly; never call this tool on attachments already in context.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          minLength: 1,
          description: 'Absolute path to the local media file.',
        },
        extractionGuidance: {
          type: 'string',
          description: 'Use this field to refine the extraction result to focus and guide extracting specific details, such as: extracting UI artifacts, extracting text from screenshots, diagnosing errors, understanding technical diagrams, analyzing information, etc.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async ({ path, extractionGuidance }, {
      aivax,
      capabilities = {},
      mediaSizeLimit = defaultMediaSizeLimit,
      requestAivax: requestMediaDescription = requestAivax,
      signal,
      userAttachments = [],
    }) => {
      if (typeof path !== 'string' || !isAbsolute(path)) {
        throw new Error('path must be an absolute file path.');
      }

      const { size } = await stat(path);
      const sizeMb = (size / 1024 / 1024).toFixed(1);
      const directReadAllowed = mediaSizeLimit === null || size <= mediaSizeLimit;
      const modelLimitMessage = `the ${mediaSizeLimit / 1024 / 1024} MB media size limit for the selected model`;

      const attachment = filePathToAttachment(path, {
        deferImageContent: capabilities.images === true,
        contentSizeLimit: Math.max(mediaSizeLimit ?? Infinity, MEDIA_DESCRIPTIONS_SIZE_LIMIT),
      });
      const supported = directReadAllowed && (
        (attachment.kind === 'image_url' && capabilities.images)
        || (attachment.kind === 'video_url' && capabilities.video)
        || (attachment.kind === 'input_audio' && capabilities.audio)
        || (
          attachment.kind === 'file'
          && attachment.mime === 'application/pdf'
          && capabilities.pdfFiles
        )
      );
      if (supported) {
        const alreadyInContext = userAttachments.some((contextAttachment) => (
          contextAttachment.kind === attachment.kind
          && contextAttachment.path === attachment.path
        ));
        if (alreadyInContext) {
          return {
            output: `This media file is already attached to this conversation and was delivered to you as direct input. Do not call read_media_file on it again; analyze the media you already received.`,
          };
        }
        return {
          output: `Media file loaded: ${attachment.path}`,
          mediaContent: [attachmentToApiBlock(attachment, capabilities)],
        };
      }
      if (attachment.kind === 'text_inline') {
        throw new Error('read_media_file does not read text files. Use read_file instead.');
      }
      if (aivax?.connected && aivax.mediaDescriptionsEnabled) {
        if (size > MEDIA_DESCRIPTIONS_SIZE_LIMIT) {
          throw new Error(`The media file is ${sizeMb} MB, which exceeds the 20 MB AIVAX Media Descriptions limit${directReadAllowed ? '' : ` and ${modelLimitMessage}`}. Reduce or compress the file before reading it.`);
        }
        const audioFormat = extname(attachment.path).slice(1).toLowerCase();
        const videoDataUrl = attachment.kind === 'video_url'
          ? `data:${attachment.mime};base64,${(await readFile(attachment.path)).toString('base64')}`
          : null;
        const input = attachment.kind === 'image_url'
          ? { type: 'image_url', image_url: { url: attachment.dataUrl } }
          : attachment.kind === 'video_url'
            ? { type: 'video_url', video_url: { url: videoDataUrl } }
            : attachment.kind === 'input_audio'
              ? {
                type: 'input_audio',
                input_audio: {
                  data: attachment.base64,
                  format: attachment.format ?? 'mp3',
                },
              }
              : ['wav', 'm4a', 'flac', 'ogg', 'webm', 'aac'].includes(audioFormat)
                ? {
                  type: 'input_audio',
                  input_audio: {
                    data: attachment.dataUrl.split(',')[1] ?? '',
                    format: audioFormat,
                  },
                }
                : attachment.kind === 'file' && attachment.mime === 'application/pdf'
                  ? {
                    type: 'file',
                    file: {
                      filename: attachment.name,
                      file_data: attachment.dataUrl,
                    },
                  }
                  : null;
        if (input) {
          const response = await requestMediaDescription('/api/v1/generations/descriptions', {
            body: {
              extractionGuidance: typeof extractionGuidance === 'string' && extractionGuidance.trim()
                ? extractionGuidance.trim()
                : undefined,
              input: [input],
            },
            includeResponseEnvelope: true,
            responseType: 'array',
            signal,
          });
          if (response.data && response.data[0]) {
            return JSON.stringify(response.data[0]);
          } else {
            return JSON.stringify(response);
          }
        }
      }
      if (!directReadAllowed) {
        throw new Error(`The media file is ${sizeMb} MB, which exceeds ${modelLimitMessage}. Reduce or compress the file before reading it.`);
      }
      if (attachment.kind === 'video_url') {
        throw new Error('The selected model does not expose video input capability.');
      }
      throw new Error(`The selected model cannot read this media type (${attachment.mime}).`);
    },
  },
  {
    name: 'aivax_teach_skill',
    description: 'Analyze one tutorial video attached in the current chat with AIVAX Teach Skill and return reusable skill instructions. Use the attachmentIndex returned by get_chat_attachments.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        attachmentIndex: {
          type: 'integer',
          minimum: 0,
          description: 'Stable index of one video returned by get_chat_attachments.',
        },
      },
      required: ['attachmentIndex'],
      additionalProperties: false,
    },
    execute: async ({ attachmentIndex }, {
      aivax,
      requestAivax: requestTeachSkill = requestAivax,
      signal,
      userAttachments = [],
    }) => {
      if (!aivax?.connected) {
        throw new Error('AIVAX is not authenticated. The user must connect an AIVAX account in Settings before using Teach Skill.');
      }

      const mediaAttachments = userAttachments.filter((attachment) => (
        ['image_url', 'input_audio', 'video_url'].includes(attachment?.kind)
        || ['image', 'audio', 'video'].some((type) => attachment?.mime?.startsWith(`${type}/`))
      ));
      const attachment = mediaAttachments[attachmentIndex];
      if (!attachment) throw new Error('The selected chat attachment is not available.');
      if (attachment.kind !== 'video_url' && !attachment.mime?.startsWith('video/')) {
        throw new Error('AIVAX Teach Skill requires a video attachment.');
      }

      const localFile = await materializeAttachment(attachment);
      if (!localFile) throw new Error('Could not create a local copy of the selected video.');
      const mime = [
        'video/mp4',
        'video/quicktime',
        'video/webm',
        'video/x-matroska',
        'video/x-msvideo',
      ].includes(attachment.mime)
        ? attachment.mime
        : {
            '.avi': 'video/x-msvideo',
            '.m4v': 'video/mp4',
            '.mkv': 'video/x-matroska',
            '.mov': 'video/quicktime',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
          }[extname(localFile.path).toLowerCase()];
      if (!mime) throw new Error('AIVAX Teach Skill requires an MP4, WebM, MOV, M4V, AVI, or MKV video.');

      const result = await requestTeachSkill('/api/v1/generations/teach-skill', {
        baseUrl: AIVAX_LONG_INFERENCE_BASE_URL,
        body: {
          videos: [{
            type: 'video_url',
            video_url: {
              url: `data:${mime};base64,${(await readFile(localFile.path)).toString('base64')}`,
            },
          }],
        },
        responseType: 'object',
        signal,
      });
      if (typeof result.resultText !== 'string' || !result.resultText.trim()) {
        throw new Error('AIVAX Teach Skill returned no skill instructions.');
      }
      return {
        resultText: result.resultText,
        usage: result.usage ?? null,
      };
    },
  },
];
