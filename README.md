# Sistema de Requisição de Materiais - Rio+ Saneamento (Metro I)

Sistema web para equipes de campo solicitarem materiais, combustível, manutenção de veículos, uniformes e EPIs pelo celular — com painel administrativo em tempo real para o almoxarifado.

---

## Índice

1. [Arquitetura](#1-arquitetura)
2. [Estrutura do projeto](#2-estrutura-do-projeto)
3. [Passo a passo de instalação](#3-passo-a-passo-de-instalação)
4. [Como executar localmente](#4-como-executar-localmente)
5. [Como publicar no GitHub Pages](#5-como-publicar-no-github-pages)
6. [Como publicar o backend Python](#6-como-publicar-o-backend-python)
7. [Como conectar frontend, banco e backend](#7-como-conectar-frontend-banco-e-backend)
8. [Configurar domínio próprio](#8-configurar-domínio-próprio)
9. [Notificações (Telegram / E-mail)](#9-notificações-telegram--e-mail)
10. [Painel administrativo - primeiro acesso](#10-painel-administrativo---primeiro-acesso)
11. [Como atualizar o sistema](#11-como-atualizar-o-sistema)
12. [Backup e restauração](#12-backup-e-restauração)
13. [Como adicionar um novo tipo de solicitação](#13-como-adicionar-um-novo-tipo-de-solicitação)
14. [Segurança implementada](#14-segurança-implementada)
15. [Limitações do plano gratuito](#15-limitações-do-plano-gratuito)
16. [Roadmap / melhorias futuras](#16-roadmap--melhorias-futuras)

---

## 1. Arquitetura

```
┌─────────────────────┐         ┌──────────────────────────────┐
│   COLABORADOR DE     │  HTTPS  │                              │
│   CAMPO (celular)    │────────▶│                              │
│  frontend/index.html │         │                              │
└─────────────────────┘         │                              │
                                 │        SUPABASE               │
┌─────────────────────┐         │  (Postgres + API REST auto    │
│  ALMOXARIFADO        │  HTTPS  │   + Realtime + Storage +      │
│  (painel admin)       │────────▶│   Auth + RLS)                │
│  frontend/admin/      │  WSS   │                              │
└─────────────────────┘ (realtime)└─────────────┬────────────────┘
                                                 │ webhook (pg_net)
                                                 ▼
                                    ┌──────────────────────────┐
                                    │  BACKEND PYTHON (FastAPI) │
                                    │  Render (free tier)       │
                                    │  Só envia notificações     │
                                    │  Telegram / E-mail         │
                                    └──────────────────────────┘
```

### Por que essa arquitetura (e não um backend Python tradicional)?

| Componente | Onde roda | Por quê |
|---|---|---|
| **Frontend** (2 apps: colaborador + admin) | GitHub Pages | Gratuito, HTTPS automático, CDN global, deploy via `git push` |
| **Banco de dados + API + Realtime + Storage + Auth** | Supabase (Postgres gerenciado) | Substitui a necessidade de escrever e hospedar um backend CRUD inteiro. Não "dorme" (diferente de backends free em Render/Railway). Realtime nativo via WebSocket para o painel atualizar sozinho. RLS garante segurança em nível de banco. Free tier: 500MB de banco, 1GB de storage, 50 mil usuários de autenticação |
| **Backend Python** | Render (free tier) | Único papel: receber webhook do banco e mandar Telegram/e-mail. Como não guarda estado, o "sleep" do free tier do Render não prejudica o colaborador (só atrasa a notificação em segundos) |

Essa combinação entrega tudo que foi pedido (formulário mobile, gravação imediata, visualização em tempo real, mudança de status, dashboard, notificações, upload de fotos) **100% em camadas gratuitas**, com um componente Python de verdade no backend.

### Fluxo de dados

1. Colaborador preenche o formulário em `frontend/index.html`.
2. O JavaScript (`frontend/js/app.js`) grava diretamente no Supabase via biblioteca `supabase-js` (chave pública "anon", protegida por Row Level Security — colaboradores só conseguem **inserir**, nunca **ler** a lista de outros).
3. Se houver foto, ela é enviada ao Supabase Storage (bucket `anexos`).
4. Um **trigger no Postgres** dispara automaticamente uma chamada HTTP (webhook) para o backend Python no Render.
5. O backend Python manda a notificação (Telegram/e-mail) para o time do almoxarifado.
6. O almoxarifado abre `frontend/admin/index.html`, faz login (Supabase Auth) e vê a lista **em tempo real** (WebSocket / Realtime do Supabase) — sem precisar dar F5.
7. Ao mudar o status de uma solicitação, a alteração é gravada no Postgres e propagada em tempo real para qualquer outra pessoa com o painel aberto.

### Escalabilidade

- Postgres suporta facilmente dezenas de milhares de solicitações no plano free; se a operação crescer muito, o upgrade para o plano pago do Supabase (US$25/mês) mantém o mesmo código, só aumenta os limites.
- GitHub Pages serve o frontend via CDN — suporta qualquer volume de acessos simultâneos.
- Cada município/equipe pode ser filtrado no painel sem impacto de performance graças aos índices criados no schema.

### Custos

| Item | Custo |
|---|---|
| GitHub Pages (frontend) | R$ 0 |
| Supabase (banco, API, auth, storage, realtime) | R$ 0 até 500MB / 1GB storage |
| Render (backend de notificação) | R$ 0 (free tier, 750h/mês) |
| Telegram Bot API | R$ 0 (ilimitado) |
| Resend (e-mail) | R$ 0 até 100 e-mails/dia |
| **Total** | **R$ 0/mês** para o volume de uma operação regional como a Metro I |

---

## 2. Estrutura do projeto

```
requisicoes-materiais/
├── frontend/
│   ├── index.html                 # Formulário do colaborador de campo
│   ├── minhas-solicitacoes.html    # Consulta de protocolo
│   ├── css/
│   │   └── style.css               # Estilos mobile-first
│   ├── js/
│   │   ├── supabaseClient.js       # Configuração da conexão com Supabase
│   │   ├── formularios.js          # Definição dos campos de cada tipo
│   │   └── app.js                  # Navegação, validação, envio
│   └── admin/
│       ├── index.html              # Painel administrativo (login + dashboard + lista)
│       ├── css/
│       │   └── admin.css
│       └── js/
│           └── admin.js            # Autenticação, filtros, realtime, gráficos
├── backend/
│   ├── main.py                     # Microserviço FastAPI (notificações)
│   ├── requirements.txt
│   ├── render.yaml                 # Deploy automático no Render
│   └── .env.example
├── database/
│   └── schema.sql                  # Schema completo do Postgres (Supabase)
└── README.md
```

---

## 3. Passo a passo de instalação

### 3.1 Criar o projeto no Supabase

1. Acesse [supabase.com](https://supabase.com) e crie uma conta gratuita.
2. Clique em **New Project**. Escolha uma senha forte para o banco (guarde-a).
3. Aguarde ~2 minutos até o projeto ficar pronto.
4. Vá em **SQL Editor > New query**, cole todo o conteúdo de `database/schema.sql` e clique em **Run**.
   - Isso cria todas as tabelas, políticas de segurança (RLS), o bucket de upload de fotos e a view do dashboard.
5. Vá em **Project Settings > API** e copie:
   - **Project URL**
   - **anon public key**

### 3.2 Configurar o frontend

1. Abra `frontend/js/supabaseClient.js` e `frontend/admin/js/` (usa o mesmo arquivo) e substitua:
   ```js
   const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
   const SUPABASE_ANON_KEY = 'SUA_CHAVE_ANON_PUBLICA_AQUI';
   ```
   pelos valores copiados no passo anterior.

### 3.3 Criar o primeiro usuário do painel administrativo

1. No Supabase, vá em **Authentication > Users > Add user**.
2. Crie um usuário com e-mail e senha para o responsável pelo almoxarifado.
3. Vá em **SQL Editor** e rode (substituindo o e-mail e o UUID do usuário criado):
   ```sql
   insert into perfis_admin (id, nome, papel)
   values ('UUID_DO_USUARIO_CRIADO', 'Nome do Responsável', 'admin');
   ```
   O UUID aparece na lista de usuários em **Authentication > Users**.

---

## 4. Como executar localmente

Como o frontend é HTML/CSS/JS puro (sem build step), basta servir os arquivos estaticamente:

```bash
cd frontend
python3 -m http.server 8080
```

Acesse:
- Formulário do colaborador: `http://localhost:8080`
- Painel administrativo: `http://localhost:8080/admin`

Para rodar o backend de notificações localmente:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # edite com seus valores
uvicorn main:app --reload --port 8000
```

---

## 5. Como publicar no GitHub Pages

1. Crie um repositório no GitHub, por exemplo `requisicoes`.
2. Suba todo o conteúdo deste projeto:
   ```bash
   git init
   git add .
   git commit -m "Sistema de requisição de materiais"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/requisicoes.git
   git push -u origin main
   ```
3. No GitHub, vá em **Settings > Pages**.
4. Em **Source**, selecione a branch `main` e a pasta `/frontend` (GitHub Pages permite servir de uma subpasta) — se essa opção não aparecer, use a pasta raiz `/` e mova o conteúdo de `frontend/` para a raiz do repositório, ou use uma **GitHub Action** simples para publicar apenas `frontend/` (exemplo abaixo).
5. Aguarde 1-2 minutos. O link público será:
   ```
   https://SEU-USUARIO.github.io/requisicoes/
   ```
   E o painel administrativo:
   ```
   https://SEU-USUARIO.github.io/requisicoes/admin/
   ```

### (Opcional) GitHub Action para publicar apenas a pasta `frontend/`

Crie `.github/workflows/deploy.yml`:
```yaml
name: Deploy GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: frontend
      - uses: actions/deploy-pages@v4
        id: deployment
permissions:
  pages: write
  id-token: write
```
Depois, em **Settings > Pages > Source**, selecione **GitHub Actions**.

---

## 6. Como publicar o backend Python

1. Crie uma conta gratuita em [render.com](https://render.com).
2. Clique em **New > Web Service** e conecte o mesmo repositório do GitHub.
3. Configure:
   - **Root Directory:** `backend`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Plan:** Free
4. Em **Environment**, adicione as variáveis de `backend/.env.example` com os valores reais.
5. Clique em **Create Web Service**. O Render vai gerar uma URL pública, por exemplo:
   ```
   https://requisicoes-materiais-notificacoes.onrender.com
   ```

> Alternativa ao Render: [Railway](https://railway.app) ou [Fly.io](https://fly.io) também têm planos gratuitos compatíveis com FastAPI, com passos equivalentes.

---

## 7. Como conectar frontend, banco e backend

1. No **Supabase**, vá em **SQL Editor** e edite a função `trg_notificar_nova_solicitacao` (dentro de `database/schema.sql`, seção 10), substituindo:
   ```sql
   url := 'https://SEU-BACKEND.onrender.com/webhook/nova-solicitacao',
   ```
   pela URL real gerada pelo Render, e o segredo:
   ```sql
   'X-Webhook-Secret', 'TROQUE_ESTE_SEGREDO'
   ```
   pelo mesmo valor configurado na variável de ambiente `WEBHOOK_SECRET` do backend.
2. Rode novamente esse trecho no SQL Editor para atualizar a função.
3. Pronto — ao criar uma solicitação de teste pelo formulário, o backend deve receber o webhook e disparar a notificação.

---

## 8. Configurar domínio próprio

1. No GitHub, vá em **Settings > Pages > Custom domain** e digite seu domínio (ex: `requisicoes.suaempresa.com.br`).
2. No provedor de DNS da sua empresa, crie um registro:
   - **Tipo CNAME** apontando `requisicoes` para `SEU-USUARIO.github.io`.
3. Aguarde a propagação (até 24h) e ative **Enforce HTTPS** nas configurações do GitHub Pages.

---

## 9. Notificações (Telegram / E-mail)

### Telegram (recomendado - gratuito e instantâneo)

1. No Telegram, converse com **@BotFather** e envie `/newbot`. Siga as instruções e copie o **token** gerado.
2. Crie um grupo no Telegram com o time do almoxarifado e adicione o bot criado.
3. Envie qualquer mensagem no grupo, depois acesse no navegador:
   ```
   https://api.telegram.org/bot<SEU_TOKEN>/getUpdates
   ```
4. Procure o campo `"chat":{"id": -1001234567890 ...}` — esse número é o `TELEGRAM_CHAT_ID`.
5. Configure `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` nas variáveis de ambiente do Render.

### E-mail (via Resend, 100 e-mails/dia grátis)

1. Crie uma conta em [resend.com](https://resend.com).
2. Gere uma **API Key** em **API Keys**.
3. Configure `RESEND_API_KEY` e `EMAIL_DESTINATARIO` nas variáveis de ambiente do Render.

Ambos os canais podem ficar ativos simultaneamente.

---

## 10. Painel administrativo - primeiro acesso

1. Acesse `https://SEU-USUARIO.github.io/requisicoes/admin/`.
2. Faça login com o e-mail/senha criado no passo [3.3](#33-criar-o-primeiro-usuário-do-painel-administrativo).
3. Você verá o dashboard com indicadores, gráficos e a lista de solicitações em tempo real.

Para adicionar mais usuários do almoxarifado, repita o passo 3.3 para cada novo colaborador autorizado.

---

## 11. Como atualizar o sistema

Como o frontend é estático, qualquer alteração nos arquivos e um `git push` para a branch `main` atualiza o site automaticamente (GitHub Pages republica em ~1 minuto):

```bash
git add .
git commit -m "Descrição da alteração"
git push
```

Para alterações no banco (novas colunas, tabelas), edite/adicione um novo arquivo `.sql` e rode no **SQL Editor** do Supabase. Nunca edite dados de produção diretamente sem antes testar em um projeto Supabase separado de homologação.

Para alterações no backend Python, um `git push` também dispara redeploy automático no Render.

---

## 12. Backup e restauração

### Backup do banco

O Supabase faz backups automáticos diários no plano free (retenção de alguns dias) e sob demanda:
1. **Database > Backups** no painel do Supabase.
2. Também é possível exportar manualmente via `pg_dump`:
   ```bash
   pg_dump "postgresql://postgres:[SENHA]@[HOST]:5432/postgres" > backup.sql
   ```
   (a string de conexão fica em **Project Settings > Database**).

### Restauração

```bash
psql "postgresql://postgres:[SENHA]@[HOST]:5432/postgres" < backup.sql
```

### Backup das fotos (Storage)

Use a CLI do Supabase (`supabase storage`) ou baixe manualmente pelo painel **Storage > anexos**.

---

## 13. Como adicionar um novo tipo de solicitação

Graças ao uso de `jsonb` para campos específicos, adicionar um novo tipo (ex: "Equipamento de Informática") não exige alterar a estrutura de tabelas:

1. **Banco:** adicione o novo valor ao enum:
   ```sql
   alter type tipo_solicitacao add value 'equipamento_ti';
   ```
2. **Frontend:** em `frontend/index.html`, adicione um novo `<button class="card-tipo" data-tipo="equipamento_ti">`.
3. **Frontend:** em `frontend/js/formularios.js`, adicione uma nova entrada em `CONFIG_FORMULARIOS`:
   ```js
   equipamento_ti: {
     titulo: 'Equipamento de TI',
     permiteMultiplosItens: false,
     renderCamposHtml: () => `
       <legend>Detalhes do equipamento</legend>
       <label class="campo">
         <span>Equipamento *</span>
         <input type="text" name="equipamento" required>
       </label>
     `
   }
   ```
4. Publique (`git push`). Pronto — nenhuma outra alteração de código é necessária.

---

## 14. Segurança implementada

- **Row Level Security (RLS)** no Postgres: colaboradores de campo (chave pública "anon") só podem **inserir** solicitações — nunca leem dados de outros colaboradores. Apenas usuários autenticados e cadastrados em `perfis_admin` podem visualizar/alterar.
- **Autenticação real** (Supabase Auth) para o painel administrativo, com sessão e logout.
- **Validação de campos** obrigatórios tanto no HTML5 (`required`, tipos de campo) quanto em JavaScript antes do envio.
- **Sanitização básica** de todos os campos de texto (remoção de tags HTML) antes de gravar no banco.
- **Proteção contra envio duplicado**: o botão de envio é desabilitado durante o processamento (trava de estado `enviando`), evitando duplo clique/duplo submit.
- **Upload seguro de imagens**: bucket privado, com limite de 5MB e tipos MIME permitidos restritos a imagens, reforçado tanto no frontend quanto na configuração do bucket no Supabase.
- **URLs assinadas e temporárias** (5 minutos) para visualização de fotos no painel administrativo — as imagens nunca ficam publicamente acessíveis.
- **Segredo compartilhado** (`X-Webhook-Secret`) entre o trigger do Postgres e o backend Python, evitando que terceiros disparem notificações falsas.
- **CORS restrito** no backend Python (o endpoint de webhook não aceita chamadas de navegadores).

---

## 15. Limitações do plano gratuito

| Serviço | Limite gratuito | Impacto prático |
|---|---|---|
| Supabase | 500MB de banco, 1GB de storage, projeto pausado após 7 dias sem uso | Para reativar um projeto pausado, basta acessar o painel do Supabase uma vez |
| GitHub Pages | 100GB de banda/mês, 1GB por site | Mais que suficiente para uso interno |
| Render (backend) | "Dorme" após 15 min de inatividade, 750h/mês | Só atrasa notificações em alguns segundos na primeira chamada após o "sono" — não afeta o formulário do colaborador |
| Resend (e-mail) | 100 e-mails/dia | Suficiente; Telegram é ilimitado como alternativa/complemento |

---

## 16. Roadmap / melhorias futuras

A arquitetura já foi desenhada para suportar, sem retrabalho estrutural:

- Login com Microsoft (Azure AD/Entra ID) — Supabase Auth suporta provedores OIDC/SAML customizados.
- Assinatura eletrônica e aprovação em múltiplos níveis — adicionar tabela `aprovacoes` referenciando `solicitacoes`.
- Controle de estoque e gestão de almoxarifado — nova tabela `estoque_itens` relacionada a `solicitacao_itens`.
- Controle de veículos e histórico de entregas — reaproveita os campos `veiculo`/`placa` já gravados em `dados` (jsonb).
- Dashboard Power BI — Power BI pode conectar diretamente ao Postgres do Supabase via connection string.
- Integração com Microsoft Teams — usar o mesmo webhook do backend Python, adicionando um conector para Teams.
- API para ERP — o backend FastAPI já está pronto para receber novos endpoints REST.
- PWA (instalável no Android/iPhone) e funcionamento offline — adicionar `manifest.json` e um `service worker` com fila de sincronização (IndexedDB) para reenvio automático quando a conexão voltar.
- QR Code para retirada de materiais e leitura de código de barras — bibliotecas JS leves (`qrcode.js`, `html5-qrcode`) podem ser adicionadas sem alterar a arquitetura.
- Registro de entrega com foto e assinatura — reaproveita o mesmo mecanismo de upload já implementado para o Storage.
- Exportação para Excel/PDF — pode ser feita no próprio navegador (bibliotecas `SheetJS`/`jsPDF`) a partir dos dados já carregados no painel.

---

**Desenvolvido para a Rio+ Saneamento — Metro I (Itaguaí, Seropédica, Paracambi).**
