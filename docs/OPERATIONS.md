# Operação e recuperação — Rimuru-Bot

## Inicialização

Produção usa Railway com um volume persistente montado em `/app/auth`. Credenciais de WhatsApp, configurações legadas e o fallback JSON do V2 vivem nesse volume. O build executa TypeScript estrito e testes automatizados antes do deploy.

Comandos locais:

```bash
npm install
npm test
npm start
```

O V2 escolhe PostgreSQL quando `DATABASE_URL` existe. Sem ela, usa `/app/auth/rimuru-v2-state.json` com escrita por arquivo temporário + rename e fila de mutações dentro do processo.

## Backup

Prioridade de backup:

1. `/app/auth/creds.json` e demais arquivos necessários da sessão WhatsApp.
2. `/app/auth/owner-control.json`, `vip-access.json`, `group-settings.json`, `nox-rpg.json` e `rimuru-v2-state.json`.
3. Em PostgreSQL, usar backup consistente do banco e guardar as migrações do repositório junto da versão restaurada.

Nunca apagar a autenticação do WhatsApp como primeira tentativa para erros de comando. Reset de sessão é último recurso e pode exigir novo pareamento.

## Restauração

Pare o processo antes de substituir arquivos de estado no volume. Restaure um snapshot coerente e reinicie uma única instância. Para PostgreSQL, restaure o banco em uma instância compatível, aplique somente migrações posteriores ao snapshot e então defina `DATABASE_URL`.

## Concorrência

O fallback JSON é seguro para uma única réplica do processo e serializa mutações dentro dela. Para múltiplas réplicas, economia, resgates e jobs exigem PostgreSQL (ou outro store distribuído compatível). O store PostgreSQL V2 trava a linha de estado com `SELECT ... FOR UPDATE` dentro de transação para impedir gastos simultâneos contra o mesmo snapshot.

## WhatsApp

Executar somente uma sessão ativa por identidade do bot. Em reconexões, evitar criar sockets/listeners adicionais antes de encerrar o anterior. Eventos podem chegar repetidos; efeitos persistentes usam chaves de idempotência quando suportados. Não prometer entrega exatamente uma vez: o transporte não fornece essa garantia de ponta a ponta.

## Mídia e jobs

Conversões existentes continuam no processo legado. Antes de habilitar transcrição, geração de imagem, remoção de fundo ou voz em escala, mover tarefas caras para fila persistente com timeout, limite de concorrência e limpeza de temporários. Entrada de mídia e URL deve ser tratada como dado não confiável.

## Incidentes

- **Bot online, comando sem resposta:** verificar primeiro autorização do grupo, prefixo atual, logs do roteador e erros de descriptografia.
- **Bad MAC isolado no boot:** pode ser mensagem antiga em fila; observar se continua antes de resetar sessão.
- **Falha de TMDB:** cinema deve falhar de forma localizada; moderação e administração não dependem da API.
- **Falha de V2:** build bloqueia deploy se TypeScript/testes falharem. O deploy anterior continua sendo a referência estável.
- **Saldo divergente:** nunca editar saldo silenciosamente; registrar transação compensatória.

## Retenção mínima

Atividade V2 guarda somente `firstSeenAt`, `lastSeenAt` e quantidade observada por usuário/grupo, não o texto das mensagens. Mídia temporária deve ser apagada ao concluir/expirar. Logs não devem registrar conteúdo privado, tokens ou credenciais.
