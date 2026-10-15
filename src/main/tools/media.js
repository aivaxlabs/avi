import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join } from 'node:path';
import { defaultMediaSizeLimit } from '../../shared/attachments.js';
import { AIVAX_LONG_INFERENCE_BASE_URL, requestAivax } from '../aivax-client.js';
import { attachmentToApiBlock } from '../database.js';
import { filePathToAttachment, materializeAttachment } from '../files.js';
import { detectImageMime } from '../json-request-body.js';
import { diagnosticFetch } from '../request-diagnostics.js';

const MEDIA_DESCRIPTIONS_SIZE_LIMIT = 20 * 1024 * 1024;
const REFERENCE_IMAGE_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const SHELL_HEADERS = { 'X-Shell-User-Id': 'avi-media-generation' };

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
  {
    name: 'generate_image',
    description: 'Generate images with the AIVAX image model selected in Settings. Optionally pass reference images as absolute local paths or public HTTP(S) URLs; the call fails when the selected model does not support reference images. Generated images are saved locally and shown in the chat.',
    canEditFile: true,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          minLength: 1,
          description: 'Complete visual instructions for the image.',
        },
        count: {
          type: 'integer',
          minimum: 1,
          maximum: 4,
          description: 'Number of images to generate. Defaults to 1.',
        },
        referenceImages: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          maxItems: 4,
          description: 'Optional reference images: absolute local paths (PNG, JPEG, WebP, or GIF) or public HTTP(S) URLs.',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    execute: async ({ prompt, count = 1, referenceImages = [] }, {
      aivax,
      requestAivax: requestImages = requestAivax,
      fetch = diagnosticFetch,
      signal,
      workspacePath,
    }) => {
      if (!aivax?.connected || !aivax.imageGenerationEnabled || !aivax.imageGenerationModel) {
        throw new Error('AIVAX image generation is not enabled. The user must enable it and select a model in Settings → AIVAX Features.');
      }
      const model = aivax.imageGenerationModel;
      if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('prompt is required.');
      if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error('count must be an integer from 1 to 4.');
      if (!Array.isArray(referenceImages) || referenceImages.length > 4) {
        throw new Error('referenceImages must be an array with at most four items.');
      }

      const uploadedPaths = [];
      try {
        const referenceUrls = [];
        if (referenceImages.length > 0) {
          const catalog = await requestImages('/api/v1/information/image-models.json', {
            responseType: 'array',
            signal,
          });
          const catalogModel = catalog.find((item) => item.name?.toLowerCase() === model.toLowerCase());
          if (!catalogModel?.flags?.includes('AllowReferenceImage')) {
            throw new Error(`The selected image generation model "${model}" does not support reference images.`);
          }

          for (const reference of referenceImages.map((value) => String(value).trim())) {
            if (/^https?:\/\//i.test(reference)) {
              referenceUrls.push(reference);
              continue;
            }
            if (!isAbsolute(reference)) {
              throw new Error(`Reference image must be an absolute path or an HTTP(S) URL: ${reference}`);
            }
            const extension = extname(reference).toLowerCase();
            const mime = REFERENCE_IMAGE_MIME_TYPES[extension];
            if (!mime) throw new Error(`Unsupported reference image type: ${reference}`);

            const sandboxPath = `image-references/${randomUUID()}${extension}`;
            await requestImages(`/api/v1/shell/io/file?path=${encodeURIComponent(sandboxPath)}`, {
              body: new Blob([await readFile(reference)], { type: mime }),
              headers: SHELL_HEADERS,
              signal,
            });
            uploadedPaths.push(sandboxPath);
            const published = await requestImages(`/api/v1/shell/io/file/public-address?path=${encodeURIComponent(sandboxPath)}`, {
              headers: SHELL_HEADERS,
              responseType: 'object',
              signal,
            });
            if (typeof published.publicUrl !== 'string') {
              throw new Error(`AIVAX did not return a public address for ${reference}.`);
            }
            referenceUrls.push(published.publicUrl);
          }
        }

        const groups = await requestImages('/api/v1/generations/images', {
          baseUrl: AIVAX_LONG_INFERENCE_BASE_URL,
          body: {
            input: prompt.trim(),
            count,
            model,
            ...(referenceUrls.length > 0 ? { referenceImages: referenceUrls } : {}),
          },
          responseType: 'array',
          signal,
        });
        const imageUrls = groups.flatMap((group) => (Array.isArray(group?.images) ? group.images : []));
        if (imageUrls.length === 0) throw new Error('AIVAX returned no images.');

        const outputDirectory = join(workspacePath || homedir(), '.aivax', 'generated-images');
        await mkdir(outputDirectory, { recursive: true });
        const attachments = [];
        for (const [index, url] of imageUrls.entries()) {
          const response = await fetch(url, { signal });
          if (!response.ok) throw new Error(`Could not download the generated image (${response.status}).`);
          const buffer = Buffer.from(await response.arrayBuffer());
          const mime = detectImageMime(buffer) ?? 'image/png';
          const extension = mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1];
          const path = join(outputDirectory, `${model.replace(/[^a-z0-9.-]/gi, '-')}-${Date.now()}-${index + 1}.${extension}`);
          await writeFile(path, buffer);
          attachments.push({
            id: randomUUID(),
            kind: 'image_url',
            source: 'generated_image',
            name: basename(path),
            path,
            mime,
            dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
          });
        }

        return {
          output: [
            `Generated ${attachments.length} image(s) with ${model}.`,
            ...attachments.map((attachment) => `Saved to: ${attachment.path}`),
          ].join('\n'),
          mediaContent: attachments.map((attachment) => ({
            type: 'image_url',
            image_url: { url: attachment.dataUrl },
          })),
          attachments,
        };
      } finally {
        await Promise.allSettled(uploadedPaths.map((sandboxPath) => requestImages(
          `/api/v1/shell/io/file?path=${encodeURIComponent(sandboxPath)}`,
          { method: 'DELETE', headers: SHELL_HEADERS },
        )));
      }
    },
  },
  {
    name: 'generate_audio',
    description: 'Synthesize speech (text-to-speech) with the AIVAX audio model selected in Settings and save the audio file locally.',
    canEditFile: true,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          minLength: 1,
          description: 'Text to speak.',
        },
        voice: {
          type: 'string',
          description: 'Optional voice name supported by the selected model, such as alloy, onyx, nova, or sage. Omit to use the model default.',
        },
        format: {
          type: 'string',
          enum: ['mp3', 'wav', 'ogg'],
          description: 'Output audio format. Defaults to mp3.',
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
    execute: async ({ text, voice, format = 'mp3' }, {
      aivax,
      requestAivax: requestSpeech = requestAivax,
      signal,
      workspacePath,
    }) => {
      if (!aivax?.connected || !aivax.audioGenerationEnabled || !aivax.audioGenerationModel) {
        throw new Error('AIVAX audio generation is not enabled. The user must enable it and select a model in Settings → AIVAX Features.');
      }
      if (typeof text !== 'string' || !text.trim()) throw new Error('text is required.');
      if (!['mp3', 'wav', 'ogg'].includes(format)) throw new Error('format must be mp3, wav, or ogg.');

      const model = aivax.audioGenerationModel;
      const result = await requestSpeech('/api/v1/generations/speech', {
        baseUrl: AIVAX_LONG_INFERENCE_BASE_URL,
        body: {
          model,
          input: text,
          ...(typeof voice === 'string' && voice.trim() ? { voice: voice.trim() } : {}),
          format,
        },
        responseType: 'object',
        signal,
      });
      if (typeof result.data !== 'string' || !result.data) throw new Error('AIVAX returned no audio.');

      const outputDirectory = join(workspacePath || homedir(), '.aivax', 'generated-audio');
      const path = join(outputDirectory, `${model.replace(/[^a-z0-9.-]/gi, '-')}-${Date.now()}.${result.format ?? format}`);
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(path, Buffer.from(result.data, 'base64'));
      return `Audio generated with ${model}.\nSaved to: ${path}`;
    },
  },
];
