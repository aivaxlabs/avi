import { hostname } from 'node:os';
import { diagnosticFetch as fetch } from '../request-diagnostics.js';
import { requestAivax } from '../aivax-client.js';
import { getConversation, getRemoteSettings } from '../database.js';

const MAX_READ_URL_CHARS = 100_000;

export const memoryWebTools = [
  {
    name: 'memory_search',
    description: 'Search persistent AIVAX memory for files matching one or more terms.',
    forcedTruncationLength: 5_000,
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        search_terms: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
          description: 'One or more search terms describing the file or knowledge to retrieve.',
        },
        filter: {
          type: 'string',
          minLength: 1,
          description: [
            'Optional document filter applied before the semantic search; only matching memories are ranked. Use it for exact constraints (tags, names, dates) and search_terms for meaning.',
            'Fields: name, content, tags, createdAt, updatedAt, metadata.<key>. Combine conditions with and, or, not and parentheses; text values use double quotes and ignore case and accents.',
            'Examples:',
            '- tags has "decision"',
            '- tags in ("avi", "aivax") and not tags has "draft"',
            '- name startswith "avi-"',
            '- content contains "migration"',
            '- updatedAt >= now-7d',
            '- createdAt >= "2026-01-01" and createdAt < "2026-02-01"',
            '- metadata.thread_role = "subagent" and metadata.device_name = "workstation"',
            'Use has/in for tags (not =); contains needs at least 3 characters.',
            'Memories written by Avi have metadata keys directory, model_name, task_title, thread_id, thread_role, parent_thread_id, device_name, and device_id.',
            'For elaborate filters (metadata, escaping, dates, limits, common mistakes), read the bundled memory-filters skill.',
          ].join('\n'),
        },
        detailed: {
          type: 'boolean',
          description: 'When true, return a JSON array with id, name, createdAt, updatedAt, score, metadata, and content for each result.',
        },
      },
      required: ['search_terms'],
      additionalProperties: false,
    },
    execute: async ({ search_terms, filter, detailed }, { aivax, signal }) => {
      const results = await requestAivax('/api/v1/query', {
        body: {
          terms: search_terms,
          collections: [aivax.memoryCollectionId],
          top: 20,
          includeReferences: false,
          reranker: 'rrf',
          minScore: 0.2,
          ...(filter === undefined ? {} : { filter }),
        },
        responseType: 'array',
        signal,
      });
      if (detailed) {
        return JSON.stringify(results.map((result) => ({
          id: result.documentId,
          name: result.documentName,
          createdAt: result.timestamps?.createdAt ?? null,
          updatedAt: result.timestamps?.updatedAt ?? null,
          score: result.score,
          metadata: result.metadata ?? {},
          content: result.documentContent,
        })));
      }
      if (results.length === 0) return 'No memory results found.';
      return [
        'Memory results:',
        results.map(({ documentName, documentContent }) => [
          `title: ${documentName}`,
          'content:',
          documentContent,
        ].join('\n')).join('\n--------\n'),
      ].join('\n');
    },
  },
  {
    name: 'memory_write',
    description: 'Write or update a file in persistent AIVAX memory. The title is normalized into the stored name, and the current directory, model, thread, and device are recorded as metadata.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          minLength: 1,
          description: 'Human-readable document title. It is normalized into the stored name (lowercase ASCII letters, digits, and hyphens); writing the same title again updates that memory.',
        },
        contents: {
          type: 'string',
          description: 'The full content to write to the file.',
        },
        reference: {
          type: 'string',
          description: 'Optional grouping ID or source reference.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags used to categorize the file.',
        },
      },
      required: ['title', 'contents'],
      additionalProperties: false,
    },
    execute: async ({ title, contents, reference, tags }, {
      aivax,
      signal,
      workspacePath,
      model,
      models,
      conversationId,
    }) => {
      const name = String(title ?? '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 120)
        .replace(/^-+|-+$/g, '');
      if (!name) throw new Error('title must contain at least one letter or digit.');

      const conversation = conversationId ? getConversation(conversationId) : null;
      await requestAivax(
        `/api/v1/collections/${encodeURIComponent(aivax.memoryCollectionId)}/documents`,
        {
          method: 'PUT',
          body: {
            name,
            contents,
            ...(reference === undefined ? {} : { reference }),
            ...(tags === undefined ? {} : { tags }),
            metadata: {
              directory: workspacePath ?? null,
              model_name: models?.find((item) => item.id === model)?.modelId ?? model ?? null,
              task_title: conversation?.title ?? null,
              thread_id: conversationId ?? null,
              thread_role: !conversation
                ? 'quick_chat'
                : conversation.isSideChat
                  ? 'side_chat'
                  : conversation.isSubagent ? 'subagent' : 'orchestrator',
              parent_thread_id: conversation?.parentConversationId ?? null,
              device_name: hostname(),
              device_id: getRemoteSettings().relayDeviceId,
            },
          },
          responseType: 'object',
          signal,
        },
      );
      return `Memory file written: ${name}.`;
    },
  },
  {
    name: 'memory_delete',
    description: 'Delete one or more files from persistent AIVAX memory by exact stored name, as returned by memory_write or memory_search.',
    canEditFile: false,
    canPerformDestructiveActions: true,
    inputSchema: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
          description: 'One or more exact, distinct file names to delete from memory.',
        },
      },
      required: ['names'],
      additionalProperties: false,
    },
    execute: async ({ names }, { aivax, signal }) => {
      const collectionPath = `/api/v1/collections/${encodeURIComponent(aivax.memoryCollectionId)}/documents`;
      const deleted = [];
      const notFound = [];

      for (const name of new Set(names)) {
        const documents = await requestAivax(
          `${collectionPath}?filter=${encodeURIComponent(name)}`,
          { responseType: 'array', signal },
        );
        const document = documents.find((item) => item.name === name);
        if (!document) {
          notFound.push(name);
          continue;
        }
        await requestAivax(`${collectionPath}/${encodeURIComponent(document.id)}`, {
          method: 'DELETE',
          signal,
        });
        deleted.push(name);
      }

      return [
        deleted.length > 0 ? `Deleted memory files: ${deleted.join(', ')}.` : 'No memory files were deleted.',
        ...(notFound.length > 0 ? [`Memory files not found: ${notFound.join(', ')}.`] : []),
      ].join('\n');
    },
  },
  {
    name: 'web_search',
    description: 'Search the web using AIVAX with optional country, language, and domain filters.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: 'The web search query.' },
        location: {
          type: 'string',
          description: 'Optional city, region, or other location added to the search query.',
        },
        country: { type: 'string', description: 'Optional two-letter country code.' },
        language: { type: 'string', description: 'Optional language code.' },
        sites: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional domains to include in results.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async ({ query, location, country, language, sites }, { signal }) => {
      const result = await requestAivax('/api/v1/web/search', {
        body: {
          query: location ? `${query} ${location}` : query,
          topn: 10,
          ...(country ? { country } : {}),
          ...(language ? { language } : {}),
          ...(sites?.length ? { includeDomains: sites } : {}),
        },
        responseType: 'object',
        signal,
      });
      const results = result?.results ?? [];
      if (results.length === 0) return `No web results found for "${query}".`;
      return [
        `Web results for "${query}":`,
        results.map(({ title, url, text }) => [
          `title: ${title}`,
          `url: ${url}`,
          'content:',
          text,
        ].join('\n')).join('\n--------\n'),
      ].join('\n');
    },
  },
  {
    name: 'read_url',
    description: 'Read a public HTTP or HTTPS URL as LLM-friendly text using the configured extraction service.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The public HTTP or HTTPS URL to read.',
        },
      },
      required: ['url'],
    },
    execute: async ({ url }, { aivax, signal }) => {
      let target;
      try {
        target = new URL(String(url));
      } catch {
        throw new Error('url must be a valid HTTP or HTTPS URL.');
      }
      if (!['http:', 'https:'].includes(target.protocol)) {
        throw new Error('url must use HTTP or HTTPS.');
      }

      if (aivax?.connected && aivax.advancedFetchEnabled) {
        const result = await requestAivax('/api/v1/web/fetch', {
          body: { contents: [target.href], returnErrors: true },
          responseType: 'object',
          signal,
        });
        const fetched = result?.results?.[0];
        if (fetched?.error) throw new Error(fetched.error);
        const content = fetched?.extractedText ?? '';
        return [
          `URL: ${target.href}`,
          '',
          content.slice(0, MAX_READ_URL_CHARS),
          ...(content.length > MAX_READ_URL_CHARS ? ['', '[content truncated]'] : []),
        ].join('\n');
      }

      const response = await fetch(`https://r.jina.ai/${target.href}`, {
        headers: { Accept: 'text/plain' },
        signal,
      });
      const content = await response.text();
      if (!response.ok) {
        throw new Error(content || `Jina Reader returned ${response.status} ${response.statusText}.`);
      }

      return [
        `URL: ${target.href}`,
        '',
        content.slice(0, MAX_READ_URL_CHARS),
        ...(content.length > MAX_READ_URL_CHARS ? ['', '[content truncated]'] : []),
      ].join('\n');
    },
  },
];
