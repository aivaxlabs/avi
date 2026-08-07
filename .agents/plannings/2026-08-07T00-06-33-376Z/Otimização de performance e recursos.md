# Plano consolidado de otimização de performance do Avi

## Objetivo

Reduzir o custo de CPU, RAM, I/O, renderização e distribuição do Avi sem alterar os contratos públicos de IPC, a ordem dos eventos de chat, a durabilidade dos estados finais ou o comportamento funcional das janelas principal e Quick Chat.

A execução será incremental e mensurada. Cada grupo de mudanças terá benchmark isolado antes de avançar, evitando atribuir ganhos ou regressões a várias otimizações simultâneas.

## Baseline confirmado

### Binário

- Instalador Windows x64 NSIS atual: **101.888.705 bytes**, aproximadamente **97,17 MiB**. #file:./artifacts/latest.yml:1-8
- Electron: **43.2.0**.
- `asar: true`.
- O pacote inclui `dist`, fontes do processo main, providers, preload, prompts, shared, assets e dependências de produção. #file:./package.json:67-114
- O catálogo `src/prompts/context` está duplicado:
  - dentro do ASAR por `src/prompts/**/*`;
  - fora do ASAR por `extraResources`.
- Em produção, o runtime utiliza a cópia externa em `resources/context`. #file:./src/main/context-injection.js:502-519

### RAM e CPU observadas no trace

Janela analisada: aproximadamente **2026-08-06 23:39:41Z–2026-08-07 00:01Z**, com reinicialização às 23:56:38Z. O nível estava em `verbose`.

O snapshot atual mede somente o processo main, não a árvore completa do Electron.

Primeira instância:

- RSS: **158–173 MB**
- Heap: **20–23 MB**
- External: **5–7 MB**
- CPU por janela de aproximadamente 60 segundos: **1.171–2.125 ms**, cerca de 2–3,5% de um core

Segunda instância:

- RSS observado: **133–163 MB**
- Uma janela apresentou **17.547 ms de CPU em 60 segundos**, aproximadamente 29% de um core
- O pico coincidiu com múltiplos subagentes e scans concorrentes de contexto

Outros timings observados:

- Inicialização de sete MCPs globais: aproximadamente **1.990–2.020 ms**
- `conversations:list`: **370–590 ms**
- Injeção de contexto simples: **34–76 ms**
- Injeção em workspace com instruções: **289–566 ms**
- Cinco injeções concorrentes foram observadas durante spawn de subagentes

Esses números não incluem renderer, GPU, workers ou subprocessos MCP.

## Prioridade consolidada

### P1 — Primeira onda

1. Instrumentar a árvore completa de processos e os caminhos quentes.
2. Reutilizar o contexto descoberto entre rounds do mesmo run.
3. Reduzir write amplification da persistência de streaming.
4. Expirar terminais concluídos e impedir retenção indefinida de output.
5. Coalescer atualizações visuais do streaming no renderer.
6. Evitar rerenderização e reprocessamento das mensagens finalizadas.
7. Remover a duplicação de `src/prompts/context` no pacote.
8. Separar o bundle da janela principal e do Quick Chat.

### P2 — Segunda onda

1. Tornar inspeção Git assíncrona e cacheada.
2. Substituir o N+1 do dashboard de orquestração por consultas SQL específicas.
3. Consolidar auto-scroll e reduzir medições de layout.
4. Adicionar lazy loading e decodificação assíncrona às imagens históricas.
5. Carregar Files, Settings e Orchestration sob demanda.
6. Retirar o catálogo completo de file icons do chunk inicial.
7. Limitar retenção de conversas não ativas no renderer.
8. Encerrar explicitamente o worker de busca no shutdown.
9. Reduzir atividade contínua do shader WebGPU em idle.

### P3 ou condicionado a métricas

1. Bundlar o processo main e podar a árvore transitiva do SDK MCP.
2. Adicionar FTS5 à busca.
3. Aplicar virtualização de mensagens com altura variável.
4. Restringir locales do Electron.
5. Usar `compression: maximum`.
6. Migrar anexos persistidos de data URLs para arquivos/protocolo seguro.
7. Tornar a gravação do trace verbose assíncrona ou bufferizada.

Essas mudanças só serão executadas se o baseline físico ou profiling demonstrar ganho material. A restrição de locales fica fora da primeira implementação porque o projeto não documenta os idiomas oficialmente suportados.

## Arquivos afetados

### Instrumentação e recursos

- #file:./src/main/runtime.js
- #file:./src/main/trace-log.js
- #file:./src/preload/preload.cjs
- #file:./src/renderer/App.jsx
- Possível módulo pequeno de replay/benchmark em `scripts/`, somente se reutilizado por benchmarks de backend e renderer

### Contexto e backend

- #file:./src/main/chat-runner.js
- #file:./src/main/provider-api.js
- #file:./src/main/context-injection.js
- #file:./src/providers/openai-compatible.js
- #file:./src/main/streaming.js
- #file:./src/main/database.js
- #file:./src/main/client-tools.js
- #file:./src/main/runtime.js
- #file:./src/main/search-worker.js
- #file:./src/main/search-core.js

### Renderer

- #file:./src/renderer/main.jsx
- #file:./src/renderer/App.jsx
- #file:./src/renderer/components/ChatView.jsx
- #file:./src/renderer/components/Message.jsx
- #file:./src/renderer/components/Sidebar.jsx
- #file:./src/renderer/components/AuxiliaryPanel.jsx
- #file:./src/renderer/components/FilesPanel.jsx
- #file:./src/renderer/components/SettingsPage.jsx
- #file:./src/renderer/components/OrchestrationPage.jsx
- #file:./src/renderer/components/Composer.jsx
- #file:./src/styles/components/chat.xcss
- #file:./src/styles/components/message.xcss

### Build e empacotamento

- #file:./package.json
- #file:./vite.config.js
- #file:./scripts/build-renderer.mjs
- #file:./scripts/package.mjs

Não serão editados `.env`, `.env.*` ou `appservice.ini`.

## Contratos públicos preservados

- `window.chatApp` e os canais expostos pelo preload permanecem compatíveis.
- O envelope IPC `avi:invoke` não muda.
- O formato de `chat:event` não muda na primeira onda.
- Perguntas, aprovações, erros, stop e eventos terminais continuam imediatos.
- Deltas não podem ser perdidos ou reordenados.
- O snapshot final persistido de uma mensagem deve permanecer byte-equivalente no conteúdo lógico.
- `orchestration:overview` mantém o shape atual.
- `read_terminal_output` continua funcionando para terminais ativos e concluídos recentes.
- Após o TTL, um terminal expirado retorna o erro normal de recurso inexistente.
- Links `#file`, Markdown, blocos de código, tool calls, retry, fork e planos continuam funcionais.
- A descoberta de contexto continua incluindo instalação, global e workspace.
- O contexto é congelado apenas durante um run; um novo run sempre obtém um snapshot novo.

## Decisões confirmadas e trade-offs aceitos

1. **Instrumentar antes de otimizar.**  
   O trace atual subestima RAM e CPU porque mede apenas o main. Nenhuma meta de memória total será considerada válida antes da instrumentação da árvore de processos.

2. **Snapshot de contexto por run, sem watcher global.**  
   O contexto será descoberto uma vez no início de cada run e reutilizado nos rounds seguintes. Alterações feitas por ferramentas em arquivos de contexto invalidarão o snapshot. Alterações externas durante um run poderão aparecer somente no run seguinte. Esse trade-off evita watchers e infraestrutura desnecessária.

3. **Reduzir persistência intermediária, preservar durabilidade final.**  
   Snapshots intermediários terão cadência menor e caminho de banco mais barato. Conclusão, erro, abort e boundaries relevantes continuam forçando persistência integral.

4. **Coalescer somente apresentação visual.**  
   O renderer preserva todo o conteúdo recebido, mas aplica atualizações visuais de mensagens incrementais no máximo uma vez por frame ou em intervalo de até 50 ms. Eventos críticos não entram no throttle.

5. **Memoização antes de virtualização.**  
   A lista continuará sem virtualização na primeira onda. Primeiro serão eliminados rerenders desnecessários e reparses de mensagens antigas. Virtualização só será considerada se o profiling ainda mostrar DOM/layout como gargalo.

6. **Code splitting não será contabilizado automaticamente como redução do instalador.**  
   Separar chunks melhora startup e memória inicial, mas pode não reduzir o total distribuído. Ganhos de bundle inicial e instalador serão reportados separadamente.

7. **Bundling do main será condicionado ao ASAR físico.**  
   O main só será bundlado se a inspeção demonstrar que `app.asar/node_modules` representa parcela material do pacote. Isso evita introduzir riscos em workers, transports MCP, paths de prompts e licenças sem ganho comprovado.

8. **Locales não serão removidos por suposição.**  
   A implementação inicial apenas medirá o tamanho dos locales. A poda dependerá de uma lista oficial de idiomas suportados.

9. **Benchmarks de streaming serão sintéticos.**  
   Não serão feitas chamadas pagas a modelos para validar performance.

## Sequência de execução

### Fase 1 — Criar baseline reproduzível

1. Adicionar instrumentação verbose em #file:./src/main/runtime.js usando:
   - `app.getAppMetrics()`;
   - `process.getProcessMemoryInfo()` quando suportado;
   - `performance.eventLoopUtilization()`;
   - histograma resumido de atraso do event loop;
   - contadores de janelas, Quick Chats, runs, filas, approvals, questions, workers e MCPs.
2. Registrar métricas por tipo de processo, sem paths, comandos, prompts, variáveis de ambiente ou credenciais.
3. Instrumentar context injection com:
   - scans iniciados;
   - cache hit/miss;
   - scans coalescidos;
   - diretórios e arquivos visitados;
   - timeout;
   - bytes lidos, quando disponível.
4. Instrumentar streaming com contadores de:
   - snapshots intermediários;
   - snapshots forçados;
   - bytes serializados;
   - statements SQLite executados;
   - eventos IPC emitidos.
5. No renderer, adicionar medição de desenvolvimento/replay para:
   - commits;
   - long tasks;
   - mensagens e conversas retidas;
   - atividade do shader;
   - cache estimado em bytes.
6. Gerar um baseline físico novo do pacote com `electron-builder --dir`.
7. Extrair `app.asar` e medir:
   - `dist`;
   - `node_modules`;
   - `src/prompts/context`;
   - `resources/context`;
   - file icons;
   - locales;
   - assets da aplicação.

### Fase 2 — Cache de contexto por run

1. Alterar #file:./src/main/chat-runner.js para preparar o contexto no início do run.
2. Permitir que #file:./src/main/provider-api.js receba o snapshot já resolvido.
3. Reutilizar o snapshot em todos os `provider.stream()` do mesmo run.
4. Invalidar o snapshot quando uma ferramenta do próprio Avi editar:
   - `AGENTS.md`;
   - `MEMORY.md`;
   - `SKILL.md`;
   - workflows;
   - arquivos de instrução reconhecidos.
5. Não compartilhar snapshots indefinidamente entre runs.
6. Adicionar testes com cinco rounds e mutação de contexto entre rounds.

### Fase 3 — Persistência eficiente do streaming

1. Alterar #file:./src/main/streaming.js para manter incrementalmente o conteúdo consolidado.
2. Separar em #file:./src/main/database.js:
   - atualização intermediária da mensagem;
   - atualização/touch da conversa;
   - releitura somente quando necessária.
3. Aumentar ou adaptar a janela de persistência intermediária com base no benchmark.
4. Manter flush forçado em:
   - conclusão;
   - erro;
   - abort;
   - retry;
   - mudança de boundary;
   - tool call/tool result quando necessário para recuperação.
5. Evitar `JSON.stringify` e reconstrução de conteúdo quando nenhum campo persistível mudou.
6. Preservar exatamente o snapshot final e a recuperação após encerramento.

### Fase 4 — Lifecycle de terminais

1. Substituir a concatenação repetida por armazenamento em chunks limitados.
2. Materializar a string somente na criação do snapshot de terminal.
3. Introduzir:
   - TTL para terminais concluídos;
   - limite global de concluídos;
   - remoção dos registros mais antigos.
4. Preservar terminais ativos independentemente do limite.
5. Limpar o mapa no shutdown após parar os processos ativos.
6. Testar comandos verbosos e consultas antes/depois do TTL.

### Fase 5 — Coalescing e memoização do renderer

1. Em #file:./src/renderer/App.jsx, enfileirar eventos incrementais de mensagem por conversa.
2. Aplicar os eventos em ordem no máximo uma vez por `requestAnimationFrame`.
3. Processar imediatamente eventos terminais, erros, perguntas e aprovações.
4. Evitar atualizações de `running` e `conversations` quando o valor semântico não mudou.
5. Isolar o cálculo de status de subagentes para não percorrer todos os históricos em cada delta.
6. Em #file:./src/renderer/components/ChatView.jsx:
   - memoizar derivados de `currentMessages`;
   - estabilizar handlers por ID;
   - evitar múltiplas passagens equivalentes;
   - criar item de lista memoizado.
7. Em #file:./src/renderer/components/Message.jsx:
   - manter mensagens finalizadas memoizadas;
   - coalescer parsing do segmento corrente;
   - impedir reparsing de Markdown e timeline antigos.
8. Não adicionar comparadores profundos; preservar referências estáveis.
9. Medir novamente antes de considerar virtualização.

### Fase 6 — Scroll, imagens e idle

1. Consolidar todas as solicitações de auto-scroll em um único ciclo de frame.
2. Manter em ref se o usuário está no fim.
3. Não medir nem escrever `scrollTop` quando o usuário estiver consultando o histórico.
4. Adicionar `loading="lazy"` e `decoding="async"` às miniaturas históricas.
5. Medir `content-visibility: auto` em mensagens antigas; aplicar somente se não causar saltos.
6. Parar completamente a animação WebGPU quando:
   - janela estiver escondida;
   - app estiver no tray;
   - `prefers-reduced-motion` estiver ativo.
7. Avaliar uma cadência menor em idle visível somente após medir o custo.

### Fase 7 — Consultas e operações do main

1. Trocar `spawnSync('git')` por execução assíncrona sem shell.
2. Cachear resultado por path com TTL curto.
3. Deduplicar inspeções simultâneas do mesmo path.
4. Substituir `orchestration:overview` por consultas SQL focadas:
   - última mensagem/status;
   - usage no intervalo;
   - tarefas;
   - ongoing/attention/recent.
5. Não carregar `content`, `segments`, attachments ou edits quando não usados.
6. Manter o shape IPC atual.
7. Encerrar explicitamente o worker de busca no shutdown.
8. Coalescer buscas obsoletas antes de avaliar FTS5.

### Fase 8 — Bundle e pacote

1. Em #file:./package.json, excluir `src/prompts/context/**/*` do ASAR, mantendo a cópia em `extraResources`.
2. Em #file:./src/renderer/main.jsx, escolher `App` ou `QuickChatApp` por `import()`.
3. Carregar Settings, Orchestration e Files sob demanda.
4. Remover o glob eager de todos os file icons:
   - preferir catálogo determinístico com somente os ícones referenciados;
   - usar glob lazy apenas se o catálogo gerado não for prático.
5. Reclassificar `boring-avatars` como dependência de build se a inspeção física confirmar ausência de uso no main/preload.
6. Restringir os assets de ícone empacotados aos recursos realmente usados em runtime.
7. Habilitar manifest de build para registrar composição dos chunks.
8. Não habilitar sourcemaps no release.
9. Comparar compressão normal e maximum, adotando maximum somente se o ganho justificar o tempo adicional.
10. Fixar explicitamente arquitetura nos jobs de release e manter budgets separados por target.

### Fase 9 — Otimizações condicionais

Executar somente com evidência dos benchmarks:

- virtualização de mensagens;
- FTS5;
- bundling do main/providers;
- armazenamento de anexos fora do SQLite/data URL;
- restrição de locales;
- trace assíncrono ou bufferizado.

Cada uma será implementada e medida separadamente.

## Validação

### Validação estrutural

Executar:

- `bun run syntax`
- testes existentes de contexto, plan, goal, ultra, arquivos, archive, MCP e interrupções aplicáveis
- build de produção do renderer
- smoke test do app empacotado
- revisão final do diff

Confirmar:

- nenhum canal IPC removido ou renomeado;
- nenhum arquivo de contexto ausente;
- nenhum source map no payload;
- nenhum prompt, path privado, comando, ambiente ou segredo adicionado ao trace;
- cleanup de timers, listeners, workers, terminais e janelas.

### Benchmark de backend

Replay sintético:

- resposta de 1 MiB;
- chunks pequenos;
- cenários com 1, 8 e 32 runs;
- cinco tool rounds sem mutação;
- cinco tool rounds com mutação de `AGENTS.md` entre rounds;
- 100 terminais produzindo mais de 2 MiB cada;
- dashboard com 1.000 conversas e 100.000 mensagens.

Medir:

- CPU do main;
- RSS/private working set da árvore;
- ELU e atraso do event loop;
- número de scans;
- número de statements;
- bytes serializados;
- tamanho do WAL;
- heap temporário;
- terminais retidos.

### Benchmark de renderer

Dataset local:

- 500 mensagens;
- 100 blocos de código;
- 50 tool calls;
- aproximadamente 1 MiB de texto;
- stream de 100 mil caracteres em 2.000 deltas por 20 segundos;
- cenário separado com 30 imagens grandes.

Medir:

- commits por segundo;
- duração média e p95 dos commits;
- renders de mensagem antiga e atual;
- scripting, rendering e painting;
- long tasks;
- layouts;
- p95 de frame;
- responsividade do input;
- comportamento do auto-scroll;
- memória antes/depois de trocar de conversa.

### Benchmark de recursos

Em build empacotado, máquina e SO fixos:

- três repetições por cenário;
- cinco minutos de estabilização;
- dez minutos de observação.

Cenários:

1. startup e idle com conversa existente;
2. idle com chat vazio;
3. janela escondida/tray;
4. conversa longa em stream;
5. cinco runs/subagentes concorrentes;
6. abertura e fechamento repetido de Quick Chat;
7. busca;
8. restart de MCP.

Registrar medianas somente após coleta automatizada.

### Validação de pacote

Gerar unpacked determinístico:

```powershell
bun run build
bun x electron-builder --win --x64 --dir --config.directories.output="$env:TEMP\avi-package-baseline"
```

Extrair e medir o ASAR:

```powershell
bun x @electron/asar list "$env:TEMP\avi-package-baseline\win-unpacked\resources\app.asar" > app-asar-files.txt
bun x @electron/asar extract "$env:TEMP\avi-package-baseline\win-unpacked\resources\app.asar" "$env:TEMP\avi-app-asar"
```

Registrar:

- bytes do instalador;
- bytes instalados;
- ASAR total;
- `node_modules`;
- `dist`;
- chunks;
- file icons;
- context;
- locales;
- assets;
- quantidade de arquivos.

Executar smoke manual/automatizado de:

- janela principal;
- Quick Chat;
- Settings;
- Orchestration;
- Files;
- ícones conhecidos/desconhecidos;
- gravação MP3;
- MCP stdio, SSE, Streamable HTTP, OAuth e remoto;
- descoberta de contexto;
- tray;
- instalador e desinstalador.

## Critérios mensuráveis de sucesso

### Backend

- Pelo menos **70% de redução** no tempo de preparação de contexto a partir do segundo round.
- Um único conjunto de scans por run sem mutação.
- Contexto atualizado corretamente após mutação reconhecida.
- Pelo menos **80% de redução** em operações SQLite intermediárias e releituras durante stream.
- p95 do atraso do event loop abaixo de **50 ms** com um stream sintético.
- Snapshot final idêntico após conclusão, erro e abort.
- Memória residual de terminais não cresce linearmente com o total histórico de comandos.
- Dashboard com dataset de referência abaixo de **200 ms p95** e pelo menos **80% menos heap temporário**.
- Zero uso de `spawnSync` no refresh normal de projetos.

### Renderer

- Mensagens finalizadas antigas renderizam no máximo uma vez durante o replay completo.
- Atualizações visuais respeitam a cadência configurada.
- Zero perda ou reordenação de deltas.
- Nenhuma long task acima de **50 ms** no dataset de referência.
- p95 de frame abaixo de **16,7 ms**, ou redução mínima de 50% quando o baseline exceder esse valor.
- p95 de input abaixo de **50 ms**.
- No máximo uma operação de auto-scroll por frame.
- Zero saltos ao fim após o usuário subir no histórico.
- Quick Chat não carrega o chunk da aplicação principal.
- Redução mínima de **20%** nos bytes JS iniciais e no primeiro paint mediano do Quick Chat.

### RAM e lifecycle

- Métricas cobrem main, renderer, GPU e utility processes disponíveis.
- Após três ciclos de abrir/fechar Quick Chat e cooldown, contadores retornam ao baseline.
- Após runs, filas, approvals e questions retornam a zero.
- Nenhum crescimento monotônico não explicado após três ciclos.
- Janela escondida não mantém RAF do shader.
- Nenhuma regressão superior a **10% na mediana** ou **15% no pico** frente ao baseline, salvo ganho funcional explicitamente aprovado.

### Pacote

- Instalador Windows x64 não excede **101.888.705 bytes** sem aprovação explícita.
- Meta inicial: pelo menos **5% menor**, ou **≤ 96.794.269 bytes**.
- Zero cópias de `src/prompts/context` dentro do ASAR.
- Zero `.map` no payload de release.
- Quick Chat, Files, Settings e Orchestration ficam em chunks apropriados.
- Dependências puramente de renderer não permanecem em `app.asar/node_modules`.
- Relatório de tamanho por chunk e diretório top-level do ASAR é produzido em todo release.

## Riscos principais

- Coalescing incorreto pode perder ou atrasar eventos: mitigado por fila ordenada e bypass de eventos críticos.
- Cadência menor de persistência aumenta a janela de perda em encerramento abrupto: mitigada por flush obrigatório nos boundaries e medição explícita.
- Cache de contexto pode apresentar conteúdo externo defasado durante um run: trade-off aceito e limitado ao run corrente.
- Memoização inadequada pode ocultar mudanças funcionais: usar referências estáveis e testes de ações, não comparadores profundos.
- Code splitting pode falhar em ambiente `file://`: validar obrigatoriamente no app empacotado.
- Catálogo lazy de ícones pode introduzir flicker ou muitas leituras: preferir catálogo gerado e deduplicado.
- Bundling do main pode quebrar workers, imports dinâmicos, paths de prompts e MCP: manter condicionado à análise física e cobrir todos os transports.
- Poda de locales pode afetar usuários: não executar sem contrato oficial de idiomas.
- Virtualização pode quebrar seleção, portals, lightbox e preservação de scroll: não executar sem protótipo e profiling.
