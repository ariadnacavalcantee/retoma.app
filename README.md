# Retoma

SaaS para clínicas de estética recuperarem orçamentos não convertidos, com acompanhamento comercial pelo WhatsApp.

- **Site:** https://retoma-blue.vercel.app
- **App:** https://retoma-blue.vercel.app/app (demonstração com dados fictícios em `/app#demo`)

## Estrutura

```
site/
  index.html            Página de vendas (calculadora, planos, FAQ, links para o checkout da Kiwify)
  app/index.html        Casca do app (estilos)
  app/app.js            App completo: login, painel, leads, pipeline, agenda, mensagens, configurações
supabase/
  migrations/           Esquema do banco, regras de acesso (RLS) e bloqueio por assinatura
  functions/
    kiwify-webhook/     Recebe os avisos de pagamento da Kiwify e libera ou bloqueia o acesso
vercel.json             Publicação na Vercel (pasta site/, URLs limpas, cabeçalhos de segurança)
```

## Como funciona

- **Front-end:** HTML e JavaScript puros, sem etapa de build. O app usa `supabase-js` pelo CDN.
- **Dados:** Supabase (Postgres + Auth). Cada clínica só enxerga os próprios registros (RLS).
- **Demonstração:** a clínica de exemplo roda só no navegador (localStorage) e não cria conta.
- **Pagamento:** checkout da Kiwify. O webhook confere a assinatura HMAC com o segredo `KIWIFY_WEBHOOK_TOKEN` e grava em `subscriptions`. Sem assinatura ativa para o e-mail do dono da clínica, o banco não libera leitura nem gravação.
- **WhatsApp:** o MVP não envia mensagens. Ele prepara o texto e abre a conversa no WhatsApp; o histórico registra a ação com entrega "não confirmada".

## Segredos

Nenhum segredo fica neste repositório. A chave do Supabase em `site/app/app.js` é a chave pública (anon), protegida pelas regras de RLS. O token do webhook da Kiwify e a service role key ficam apenas nos segredos das Edge Functions do Supabase.

## Publicar

- **Site e app:** importe este repositório na Vercel. O `vercel.json` já aponta para a pasta `site/`.
- **Banco:** aplique os arquivos de `supabase/migrations/` em ordem.
- **Webhook:** `supabase functions deploy kiwify-webhook --no-verify-jwt` e cadastre o segredo `KIWIFY_WEBHOOK_TOKEN`.
