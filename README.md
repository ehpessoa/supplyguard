# SupplyGuard-AI

Sistema multiagente autônomo para auditoria de custos e compras de insumos, com:

- Orquestração via **LangGraph** (`@langchain/langgraph`)
- Intervenção **Human-in-the-Loop (HITL)** antes de efetivar uma compra
- Ferramentas expostas via **Model Context Protocol (MCP)**
- Persistência multi-tenant isolada por **Row Level Security (RLS)** no **Supabase/Postgres**
- Fila assíncrona com **BullMQ + Redis** e agendamento diário via `node-cron`
- Dashboard de aprovação em **React 19 + Tailwind CSS 4 + Vite**

## Sumário

1. [Arquitetura](#arquitetura)
2. [Pré-requisitos](#pré-requisitos)
3. [1. Baixar o projeto](#1-baixar-o-projeto)
4. [2. Configurar variáveis de ambiente](#2-configurar-variáveis-de-ambiente)
5. [3. Configurar o Supabase](#3-configurar-o-supabase)
6. [4. Subir o Redis](#4-subir-o-redis)
7. [5. Instalar dependências](#5-instalar-dependências)
8. [6. Compilar (build)](#6-compilar-build)
9. [7. Rodar em desenvolvimento](#7-rodar-em-desenvolvimento)
10. [8. Deploy em produção](#8-deploy-em-produção)
11. [9. Como usar](#9-como-usar)
12. [Estrutura do projeto](#estrutura-do-projeto)
13. [Solução de problemas](#solução-de-problemas)

## Arquitetura

```
                 ┌────────────────────┐
  node-cron ───▶ │  POST /api/audit/   │
  (06:00 diário) │  trigger            │
                 └─────────┬──────────┘
                           ▼
                     BullMQ Queue (Redis)
                           ▼
                     BullMQ Worker
                           ▼
              ┌─────────────────────────┐
              │   LangGraph StateGraph   │
              │                          │
              │  cost_auditor            │──▶ chama MCP auditServer
              │        │                 │    (get_batches_and_fefo_alerts,
              │        ▼                 │     get_supplier_price_variance)
              │  supplies_drafter        │──▶ chama MCP purchasingServer
              │        │                 │    (draft_purchase_order)
              │        ▼                 │
              │  ⏸ interruptBefore       │──▶ dashboard mostra ApprovalModal
              │  (aguarda aprovação)     │
              │        ▼                 │
              │  supplies_committer      │──▶ chama MCP purchasingServer
              │                          │    (commit_purchase_order)
              └─────────────────────────┘
                           ▲
                           │ POST /api/purchases/approve
                           │ (retoma o grafo a partir do checkpoint)
                    Dashboard (React)
```

Todas as consultas ao Supabase feitas pelos servidores MCP são explicitamente
filtradas por `tenant_id` (o backend usa a service role key, que ignora RLS
por padrão — o RLS no banco protege o acesso feito com a chave `anon`/JWT de
usuário final).

## Pré-requisitos

- **Node.js 20+** e **npm**
- **Docker** e **Docker Compose** (para rodar o Redis localmente) — ou uma
  instância Redis já disponível
- Uma conta e projeto no **[Supabase](https://supabase.com)** (Postgres gerenciado)
- Uma **API key do Google Gemini** ([Google AI Studio](https://aistudio.google.com/apikey))

## 1. Baixar o projeto

```bash
git clone https://github.com/ehpessoa/supplyguard.git
cd supplyguard
```

## 2. Configurar variáveis de ambiente

Copie o arquivo de exemplo e preencha com suas credenciais:

```bash
cp .env.example .env
```

Edite `.env`:

| Variável                     | Descrição                                                                 |
| ----------------------------- | -------------------------------------------------------------------------- |
| `NODE_ENV`                    | `development` ou `production`                                              |
| `PORT`                        | Porta HTTP da API (padrão `4000`)                                          |
| `CORS_ORIGIN`                 | Origem(ns) permitida(s) para o dashboard (ex.: `http://localhost:5173`)    |
| `GEMINI_API_KEY`               | Chave de API do Google Gemini                                              |
| `GEMINI_MODEL`                 | Modelo usado (padrão `gemini-2.5-flash`)                                   |
| `SUPABASE_URL`                 | URL do projeto Supabase (`https://xxxx.supabase.co`)                       |
| `SUPABASE_SERVICE_ROLE_KEY`    | Service role key do Supabase (**mantenha em segredo**, nunca no client)    |
| `REDIS_URL`                    | URL de conexão do Redis (padrão `redis://localhost:6379`)                  |
| `AUDIT_CRON_SCHEDULE`          | Expressão cron do job diário (padrão `0 6 * * *` — 06:00)                  |
| `AUDIT_TENANT_IDS`             | Lista de `tenant_id` (UUID) separados por vírgula para o job agendado      |

## 3. Configurar o Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Abra o **SQL Editor** do projeto e execute o conteúdo de
   [`prisma/schema.sql`](./prisma/schema.sql). Isso cria:
   - as tabelas `product_batches`, `purchasing_orders` e `agent_tasks`;
   - a função `public.user_tenant_id()`, que lê o claim `tenant_id` do JWT;
   - as políticas de **Row Level Security** que isolam cada tenant.
3. Copie a **Project URL** e a **service_role key** (Project Settings → API)
   para `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no `.env`.
4. (Opcional, mas recomendado) Se os usuários finais forem autenticar-se via
   Supabase Auth, configure um **Custom Access Token Hook** para injetar o
   claim `tenant_id` no JWT — é esse claim que `user_tenant_id()` lê para
   aplicar o RLS a clientes autenticados com a chave `anon`.
5. Insira alguns registros de teste em `product_batches` para ter dados para
   o agente auditar (ajuste os UUIDs conforme seu tenant):

   ```sql
   insert into public.product_batches
     (tenant_id, product_id, product_name, supplier_id, supplier_name,
      batch_number, quantity, unit_cost, expiration_date)
   values
     ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'Leite em pó 1kg',
      gen_random_uuid(), 'Fornecedor A', 'LOTE-001', 120, 18.50, current_date + 5);
   ```

## 4. Subir o Redis

Via Docker Compose (já incluso no projeto):

```bash
docker compose up -d redis
```

Isso sobe um Redis em `localhost:6379`, compatível com `REDIS_URL` do
`.env.example`.

## 5. Instalar dependências

Backend (raiz do projeto):

```bash
npm install
```

Dashboard (client):

```bash
cd client
npm install
cd ..
```

## 6. Compilar (build)

Backend (compila `src/**/*.ts` para `dist/`):

```bash
npm run build
```

Dashboard (gera build de produção em `client/dist/`):

```bash
cd client
npm run build
cd ..
```

## 7. Rodar em desenvolvimento

Em terminais separados:

```bash
# Terminal 1 — API + worker BullMQ + agendador cron (hot reload via tsx)
npm run dev

# Terminal 2 — Dashboard
cd client && npm run dev
```

O dashboard sobe em `http://localhost:5173` e faz proxy de `/api/*` para
`http://localhost:4000` (configurado em `client/vite.config.ts`).

> Os servidores MCP (`src/mcp/auditServer.ts` e `src/mcp/purchasingServer.ts`)
> **não precisam ser iniciados manualmente**: os nós do LangGraph (`src/mcp/client.ts`)
> os iniciam automaticamente como subprocessos via stdio na primeira chamada
> de ferramenta. Os scripts `npm run mcp:audit` e `npm run mcp:purchasing`
> existem para depuração isolada de cada servidor MCP, se necessário.

## 8. Deploy em produção

1. Compile o backend e o client (passo 6).
2. Garanta que as variáveis de ambiente de produção estejam configuradas no
   seu ambiente de hospedagem (não faça commit do `.env`).
3. Suba um Redis gerenciado (ou o `docker-compose.yml` em um host próprio) e
   aponte `REDIS_URL` para ele.
4. Inicie o backend compilado:

   ```bash
   npm run start
   ```

   Isso executa `node dist/server.js`, que sobe a API Express, o worker
   BullMQ e o agendador cron no mesmo processo.

5. Sirva os arquivos estáticos de `client/dist/` (ex.: Nginx, Vercel,
   Netlify, um bucket + CDN, ou o próprio Express com `express.static`),
   apontando as chamadas `/api/*` para a URL pública do backend.
6. Rode a aplicação atrás de um processo supervisionado (systemd, PM2,
   Docker/Kubernetes) para reinício automático em caso de falha.

> **Nota sobre HITL entre reinícios:** o checkpointer do LangGraph usado por
> padrão é o `MemorySaver` (em memória), suficiente para um único processo
> de longa duração. Se o processo reiniciar enquanto houver uma compra
> aguardando aprovação, o checkpoint daquele `thread_id` se perde. Para
> produção com alta disponibilidade, substitua o `MemorySaver` em
> `src/workflow/graph.ts` por um checkpointer persistente (ex.:
> `@langchain/langgraph-checkpoint-postgres`, apontando para o mesmo
> Supabase/Postgres).

## 9. Como usar

### Disparar uma auditoria manualmente

```bash
curl -X POST http://localhost:4000/api/audit/trigger \
  -H "Content-Type: application/json" \
  -d '{"tenant_id": "00000000-0000-0000-0000-000000000001"}'
```

Isso enfileira um job no BullMQ. O worker executa o grafo:

1. **`cost_auditor`** — busca alertas de FEFO (lotes vencendo/vencidos) e de
   variação de preço de fornecedores via MCP, e pede ao Gemini 2.5 Flash um
   racional técnico sobre a ação mais urgente.
2. **`supplies_drafter`** — rascunha um pedido de compra (`draft_purchase_order`)
   para o alerta de FEFO mais urgente e marca o status como
   `input-required`.
3. O grafo **pausa** (`interruptBefore: ["supplies_committer"]`), aguardando
   decisão humana.

### Aprovar ou rejeitar no dashboard

1. Acesse `http://localhost:5173`.
2. Informe o `tenant_id` (UUID) no topo da página.
3. A lista de pedidos `pending_approval` aparece automaticamente (via
   `GET /api/purchases/pending`).
4. Clique em **Review** para abrir o modal de aprovação, que mostra insumo,
   fornecedor, variação percentual de preço e o racional gerado pela IA.
5. Clique em **Aprovar Compra** ou **Rejeitar**.

Isso chama `POST /api/purchases/approve`, que atualiza o checkpoint do
grafo (`human_approved`) e o retoma a partir do ponto de interrupção,
executando o nó **`supplies_committer`**, que efetiva (`committed`) ou
recusa (`rejected`) a compra via MCP.

### Agendamento automático

Com o servidor rodando (`npm run dev` ou `npm run start`), o job
`auditJob` roda diariamente no horário definido por `AUDIT_CRON_SCHEDULE`
(padrão `06:00`), disparando a auditoria para cada `tenant_id` listado em
`AUDIT_TENANT_IDS`.

## Estrutura do projeto

```
supplyguard-ai/
├── docker-compose.yml       # Redis para desenvolvimento/produção própria
├── .env.example              # Todas as variáveis de ambiente necessárias
├── package.json               # Scripts: build, start, dev, mcp:audit, mcp:purchasing
├── tsconfig.json
├── prisma/
│   └── schema.sql             # Tabelas, RLS e função user_tenant_id()
├── src/
│   ├── config/
│   │   ├── env.ts             # Validação de env vars com Zod
│   │   └── supabase.ts        # Cliente Supabase (service role)
│   ├── mcp/
│   │   ├── schemas.ts         # Contratos Zod compartilhados pelas tools MCP
│   │   ├── client.ts          # Clientes MCP (stdio) usados pelos nós do grafo
│   │   ├── auditServer.ts     # Tools: get_batches_and_fefo_alerts,
│   │   │                      #        get_supplier_price_variance
│   │   └── purchasingServer.ts # Tools: draft_purchase_order,
│   │                            #        commit_purchase_order
│   ├── agents/
│   │   ├── state.ts           # AgentStateAnnotation (estado do grafo)
│   │   ├── taskLog.ts          # Log de execução em agent_tasks
│   │   ├── costAuditAgent.ts   # Nó cost_auditor (+ chamada ao Gemini)
│   │   └── purchasingAgent.ts  # Nós supplies_drafter / supplies_committer
│   ├── workflow/
│   │   ├── graph.ts            # StateGraph + interruptBefore (HITL)
│   │   └── queue.ts            # Fila e worker BullMQ
│   └── server.ts               # Express + rotas + cron + bootstrap
└── client/                     # Dashboard React 19 + Tailwind 4 + Vite
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── App.tsx
        └── components/
            └── ApprovalModal.tsx
```

## Solução de problemas

- **`Invalid environment configuration` ao iniciar** — falta preencher uma
  variável obrigatória no `.env` (`GEMINI_API_KEY`, `SUPABASE_URL` ou
  `SUPABASE_SERVICE_ROLE_KEY`).
- **Worker não processa jobs** — confirme que o Redis está no ar
  (`docker compose ps`) e que `REDIS_URL` no `.env` aponta para ele.
- **Dashboard não lista pedidos** — verifique se o `tenant_id` informado no
  dashboard é o mesmo usado ao inserir dados em `product_batches` e ao
  disparar `/api/audit/trigger`.
- **Erro de RLS ao consultar do lado do client** — o backend usa a service
  role key (ignora RLS de propósito); RLS só se aplica a chamadas feitas
  com a chave `anon`/JWT de usuário, então garanta que o JWT carregue o
  claim `tenant_id`.
