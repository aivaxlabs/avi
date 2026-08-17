import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv[2] !== '--worker') {
  const profile = mkdtempSync(join(tmpdir(), 'avi-openai-images-test-'));
  try {
    const electronPath = join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe');
    const result = spawnSync(electronPath, [fileURLToPath(import.meta.url), '--worker'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        USERPROFILE: profile,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    process.stdout.write(result.stdout);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
  process.exit(0);
}

const nativeFetch = globalThis.fetch;
const workspace = mkdtempSync(join(tmpdir(), 'avi-openai-images-workspace-'));
const imageBase64 = Buffer.from('generated-image').toString('base64');
const accessToken = [
  Buffer.from('{"alg":"none"}').toString('base64url'),
  Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1_000) + 3_600 })).toString('base64url'),
  'signature',
].join('.');
const services = {
  credentials: {
    get: () => ({
      accessToken,
      refreshToken: 'refresh-token',
      idToken: accessToken,
      accountId: 'account-id',
    }),
  },
};

try {
  const database = await import('../src/main/database.js');
  const { ChatRunner } = await import('../src/main/chat-runner.js');
  const { ModelProviderRegistry } = await import('../src/main/model-provider.js');
  const { openAiSubscriptionProviderType } = await import('../src/providers/openai-subscription.js');

  const registry = new ModelProviderRegistry({
    getProviders: () => [],
    providerTypes: [openAiSubscriptionProviderType],
    services,
  });
  const legacyConfig = registry.normalizeConfig({
    id: 'subscription',
    name: 'OpenAI Subscription',
    interface: 'openai-subscription',
  });
  assert.equal(legacyConfig.imageTool, 'enabled');
  const legacyProvider = registry.createProvider(legacyConfig);
  assert.equal(legacyProvider.getContributions().tools.length, 1);
  assert.deepEqual(
    legacyProvider.getContributions().auxiliaryPanels.map(({ id, title, icon }) => ({
      id,
      title,
      icon,
    })),
    [{
      id: 'usage',
      title: 'OpenAI Subscription — OpenAI usage',
      icon: 'gauge',
    }],
  );

  const duplicateToolProviderType = {
    ...openAiSubscriptionProviderType,
    descriptor: {
      ...openAiSubscriptionProviderType.descriptor,
      id: 'duplicate-tool-provider',
    },
    getContributions: () => ({
      tools: [{ name: 'duplicate_tool' }, { name: 'duplicate_tool' }],
    }),
  };
  const duplicateToolRegistry = new ModelProviderRegistry({
    getProviders: () => [],
    providerTypes: [duplicateToolProviderType],
    services,
  });
  assert.equal(
    duplicateToolRegistry.createProvider({
      id: 'duplicate-tools',
      name: 'Duplicate tools',
      interface: 'duplicate-tool-provider',
      enabled: true,
      models: [],
    }).getContributions().tools.length,
    1,
  );

  const disabledConfig = registry.normalizeConfig({
    ...legacyConfig,
    imageTool: 'disabled',
  });
  assert.deepEqual(
    registry.createProvider(disabledConfig).getContributions().tools,
    [],
  );

  const configuredRegistry = new ModelProviderRegistry({
    getProviders: () => [legacyConfig, disabledConfig],
    providerTypes: [openAiSubscriptionProviderType],
    services,
  });
  assert.equal(configuredRegistry.listGlobalTools().length, 1);

  const provider = registry.createProvider(legacyConfig);
  const tool = provider.getContributions().tools[0];
  assert.ok(tool);
  assert.equal(tool.globallyAvailable, true);
  assert.equal(tool.inputSchema.properties.referenced_image_paths.maxItems, 5);
  assert.equal('num_last_images_to_include' in tool.inputSchema.properties, false);
  await assert.rejects(
    tool.execute({ prompt: 'Edit.', referenced_image_paths: Array(6).fill('C:\\image.png') }, {
      signal: new AbortController().signal,
      workspacePath: workspace,
    }),
    /At most five/,
  );
  await assert.rejects(
    tool.execute({ prompt: 'Edit.', referenced_image_paths: ['relative.png'] }, {
      signal: new AbortController().signal,
      workspacePath: workspace,
    }),
    /must be absolute/,
  );

  const firstPath = join(workspace, 'first.png');
  const secondPath = join(workspace, 'second.png');

  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: [{ b64_json: imageBase64 }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const generated = await tool.execute({ prompt: 'Create a lighthouse.' }, {
    signal: new AbortController().signal,
    workspacePath: workspace,
  });
  assert.match(requests[0].url, /\/codex\/images\/generations$/);
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    model: 'gpt-image-2',
    prompt: 'Create a lighthouse.',
    background: 'auto',
    quality: 'auto',
    size: 'auto',
  });
  assert.match(generated.output, /^Image generated with gpt-image-2\.\nSaved to: /);
  assert.equal(generated.attachments[0].source, 'generated_image');
  assert.equal(generated.mediaContent[0].type, 'image_url');

  writeFileSync(firstPath, 'first');
  writeFileSync(secondPath, 'second');
  const edited = await tool.execute({
    prompt: 'Combine the composition.',
    referenced_image_paths: [firstPath, secondPath],
  }, {
    signal: new AbortController().signal,
    workspacePath: workspace,
  });
  assert.match(requests[1].url, /\/codex\/images\/edits$/);
  assert.equal(requests[1].init.body.get('model'), 'gpt-image-2');
  assert.equal(requests[1].init.body.get('quality'), 'auto');
  assert.equal(requests[1].init.body.get('size'), 'auto');
  const editedReferences = requests[1].init.body.getAll('image[]');
  assert.equal(editedReferences.length, 2);
  assert.ok(editedReferences.every((image) => /^[0-9a-f-]+\.png$/i.test(image.name)));
  assert.deepEqual(
    await Promise.all(editedReferences.map((image) => image.text())),
    ['first', 'second'],
  );
  assert.match(edited.output, /^Image edited with gpt-image-2\.\nSaved to: /);

  const uploadedPath = join(workspace, 'uploaded.jpg');
  writeFileSync(uploadedPath, 'uploaded');
  let executedInput = null;
  let streamRound = 0;
  const aliasEvents = [];
  const generatedAttachment = {
    id: 'generated-alias-test',
    kind: 'image_url',
    source: 'generated_image',
    name: 'generated.png',
    path: join(workspace, 'generated.png'),
    dataUrl: `data:image/png;base64,${imageBase64}`,
  };
  const aliasModel = {
    id: 'compatible:image-alias-test',
    modelId: 'image-alias-test',
    providerId: 'compatible',
    providerName: 'Compatible provider',
    interface: 'openai-compatible',
    capabilities: { images: true },
    context: { input: 100_000, output: 10_000 },
  };
  const globalImageTool = {
    name: 'openai_subscription_generate_or_edit_image',
    description: 'Test image tool.',
    inputSchema: { type: 'object', properties: {} },
    approval: 'never',
    execute: async (input) => {
      executedInput = input;
      return {
        output: JSON.stringify({ operation: 'edit', outputPath: generatedAttachment.path }),
        attachments: [generatedAttachment],
      };
    },
  };
  const aliasProvider = {
    getContributions: () => ({ tools: [] }),
    stream: async () => {
      streamRound += 1;
      return streamRound === 1
        ? {
            assistantContent: '',
            toolCalls: [{
              callId: 'edit-upload',
              name: 'openai_subscription_generate_or_edit_image',
              argumentsText: JSON.stringify({
                prompt: 'Edit the uploaded image.',
                referenced_image_paths: ['/mnt/data/0.jpg'],
                __invocation_goal: 'Edit the image attached to this turn.',
                __requires_human_approval: false,
              }),
            }],
          }
        : { assistantContent: 'Done.', toolCalls: [] };
    },
  };
  const aliasRunner = new ChatRunner({
    registry: {
      resolve: () => ({ model: aliasModel, provider: aliasProvider }),
      listModels: () => [aliasModel],
      listGlobalTools: () => [globalImageTool],
    },
    getPreferences: () => ({ defaultModels: {}, tuning: {} }),
    sendEvent: (event) => aliasEvents.push(event),
  });
  const aliasConversation = database.createConversation({
    title: 'Image alias test',
    model: aliasModel.id,
    projectPath: workspace,
  });
  await aliasRunner.send({
    conversationId: aliasConversation.id,
    model: aliasModel.id,
    text: 'Edit this image.',
    attachments: [{
      kind: 'image_url',
      name: 'uploaded.jpg',
      mime: 'image/jpeg',
      path: uploadedPath,
      dataUrl: 'data:image/jpeg;base64,dXBsb2FkZWQ=',
    }],
    hidden: true,
    project: { path: workspace },
  });
  const deadline = Date.now() + 5_000;
  while (aliasRunner.runs.has(aliasConversation.id)) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for image alias test.');
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  assert.deepEqual(executedInput.referenced_image_paths, [uploadedPath]);
  const persistedAssistant = database.getMessages(aliasConversation.id)
    .findLast((message) => message.role === 'assistant');
  assert.deepEqual(persistedAssistant.attachments, [generatedAttachment]);
  assert.deepEqual(
    aliasEvents
      .filter((event) => event.type === 'message' && event.message.role === 'assistant')
      .at(-1)
      .message
      .attachments,
    [generatedAttachment],
  );

  database.closeDatabase();
  console.log('OpenAI Subscription image tool tests passed.');
} finally {
  globalThis.fetch = nativeFetch;
  rmSync(workspace, { recursive: true, force: true });
}
process.exit(0);
