"""
Microserviço de notificações - Sistema de Requisição de Materiais
==================================================================

Responsabilidade única: receber um webhook do Supabase (disparado por um
trigger no Postgres, ver database/schema.sql seção 10) sempre que uma nova
solicitação é inserida, e notificar o time do almoxarifado via Telegram
e/ou E-mail.

Este serviço NÃO guarda estado e NÃO serve o formulário do colaborador -
por isso pode rodar no plano gratuito do Render (que "dorme" após 15 min de
inatividade) sem prejudicar a experiência do colaborador de campo: o pior
cenário é a notificação chegar alguns segundos mais tarde.

Como hospedar gratuitamente (resumo - detalhes completos no README.md):
  1. Suba esta pasta "backend/" em um repositório GitHub (pode ser o mesmo
     repositório do frontend, em uma subpasta).
  2. Crie um Web Service gratuito em https://render.com apontando para
     este repositório, com Build Command "pip install -r requirements.txt"
     e Start Command "uvicorn main:app --host 0.0.0.0 --port $PORT".
  3. Configure as variáveis de ambiente (ver .env.example).
  4. Copie a URL pública gerada pelo Render e cole no trigger do banco
     (database/schema.sql, função trg_notificar_nova_solicitacao).
"""

import os
import logging
from typing import Optional

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("notificacoes")

# ----------------------------------------------------------------------------
# Configuração (via variáveis de ambiente - nunca hardcode segredos no código)
# ----------------------------------------------------------------------------
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "TROQUE_ESTE_SEGREDO")

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")  # https://resend.com (100 e-mails/dia grátis)
EMAIL_DESTINATARIO = os.getenv("EMAIL_DESTINATARIO", "")
EMAIL_REMETENTE = os.getenv("EMAIL_REMETENTE", "onboarding@resend.dev")

PAINEL_ADMIN_URL = os.getenv("PAINEL_ADMIN_URL", "https://SEU-USUARIO.github.io/requisicoes/admin/")

app = FastAPI(title="Notificações - Requisição de Materiais", version="1.0.0")

# CORS: este endpoint só é chamado pelo Supabase (servidor a servidor),
# então não precisamos liberar origens de navegador aqui.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_methods=["POST"],
    allow_headers=["*"],
)


TIPO_LABEL = {
    "combustivel": "⛽ Combustível",
    "manutencao_veiculo": "🔧 Manutenção de Veículo",
    "uniformes_epis": "🦺 Uniformes e EPIs",
    "materiais_ferramentas": "🧰 Materiais e Ferramentas",
}


class NovaSolicitacaoPayload(BaseModel):
    id: str
    protocolo: str
    nome_completo: str
    equipe: str
    cidade: str
    tipo: str
    created_at: str


@app.get("/")
def raiz():
    """Endpoint de health-check, útil para o Render verificar se o serviço está de pé."""
    return {"status": "ok", "servico": "notificacoes-requisicao-materiais"}


@app.post("/webhook/nova-solicitacao")
async def receber_nova_solicitacao(
    payload: NovaSolicitacaoPayload,
    x_webhook_secret: Optional[str] = Header(None),
):
    """
    Recebido automaticamente pelo trigger do Postgres (pg_net) sempre que
    uma linha é inserida na tabela `solicitacoes`.
    """
    if x_webhook_secret != WEBHOOK_SECRET:
        logger.warning("Tentativa de chamada ao webhook com segredo inválido.")
        raise HTTPException(status_code=401, detail="Segredo inválido")

    tipo_formatado = TIPO_LABEL.get(payload.tipo, payload.tipo)

    mensagem = (
        f"📢 *Nova solicitação recebida!*\n\n"
        f"*Protocolo:* {payload.protocolo}\n"
        f"*Tipo:* {tipo_formatado}\n"
        f"*Colaborador:* {payload.nome_completo}\n"
        f"*Equipe:* {payload.equipe}\n"
        f"*Cidade:* {payload.cidade}\n\n"
        f"👉 Acesse o painel: {PAINEL_ADMIN_URL}"
    )

    resultados = {}

    if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID:
        resultados["telegram"] = await enviar_telegram(mensagem)

    if RESEND_API_KEY and EMAIL_DESTINATARIO:
        resultados["email"] = await enviar_email(payload, tipo_formatado)

    if not resultados:
        logger.info("Nenhum canal de notificação configurado; apenas registrando no log.")
        logger.info(mensagem)

    return {"status": "recebido", "notificacoes": resultados}


async def enviar_telegram(mensagem: str) -> str:
    """
    Envia notificação via Telegram Bot API (100% gratuito, sem limites práticos).

    Como configurar (ver README.md para o passo a passo completo):
      1. Fale com @BotFather no Telegram e crie um bot -> gera o TELEGRAM_BOT_TOKEN
      2. Adicione o bot a um grupo com o time do almoxarifado
      3. Descubra o chat_id do grupo (via https://api.telegram.org/bot<TOKEN>/getUpdates)
    """
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json={
                "chat_id": TELEGRAM_CHAT_ID,
                "text": mensagem,
                "parse_mode": "Markdown",
            })
            resp.raise_for_status()
        return "enviado"
    except Exception as exc:  # noqa: BLE001
        logger.error("Falha ao enviar Telegram: %s", exc)
        return f"falhou: {exc}"


async def enviar_email(payload: NovaSolicitacaoPayload, tipo_formatado: str) -> str:
    """
    Envia notificação por e-mail via Resend (https://resend.com), que possui
    plano gratuito de 100 e-mails/dia - suficiente para este cenário.
    """
    url = "https://api.resend.com/emails"
    corpo_html = f"""
        <h2>Nova solicitação recebida</h2>
        <p><strong>Protocolo:</strong> {payload.protocolo}</p>
        <p><strong>Tipo:</strong> {tipo_formatado}</p>
        <p><strong>Colaborador:</strong> {payload.nome_completo}</p>
        <p><strong>Equipe:</strong> {payload.equipe}</p>
        <p><strong>Cidade:</strong> {payload.cidade}</p>
        <p><a href="{PAINEL_ADMIN_URL}">Acessar painel administrativo</a></p>
    """
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
                json={
                    "from": EMAIL_REMETENTE,
                    "to": [EMAIL_DESTINATARIO],
                    "subject": f"Nova solicitação: {payload.protocolo}",
                    "html": corpo_html,
                },
            )
            resp.raise_for_status()
        return "enviado"
    except Exception as exc:  # noqa: BLE001
        logger.error("Falha ao enviar e-mail: %s", exc)
        return f"falhou: {exc}"
