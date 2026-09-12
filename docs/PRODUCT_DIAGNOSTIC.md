# Rimuru-Bot — diagnóstico de produto e engenharia

Verificação do repositório em 2026-09-12.

| Recurso | Estado real | Problema | Impacto | Solução | Prioridade |
|---|---|---|---|---|---|
| Transporte WhatsApp | Implementado, validado em serviço real | Baileys é transporte não-oficial e sujeito a mudanças do WhatsApp | Reconexão/LID podem regredir | Adaptador isolado, uma sessão, deduplicação e testes de identidade | P0 |
| Identidade JID/LID | Implementado, mas historicamente instável | WhatsApp pode entregar PN, LID e aliases diferentes | Dono/VIP pode ser negado ou usuário duplicado | Canonicalização e testes de permissão | P0 |
| Autorização de grupos | Implementada | Regras espalhadas no legado | Risco de bypass/regressão | Registro central + checagem no backend V2 | P0 |
| Persistência | Implementada em JSON no volume Railway | Escritas fragmentadas e sem transação entre módulos | Risco de inconsistência em concorrência/restart | V2 adiciona store transacional e suporte PostgreSQL | P0 |
| PostgreSQL | Código/migração implementados; não validado em produção | Projeto Railway ainda não possui serviço PostgreSQL/DATABASE_URL | V2 continua usando fallback JSON | Provisionar Postgres e executar migração 001 | P0 |
| Comandos legados | Implementados | `src/index.js` é monolítico e vários patches alteram fonte no startup | Alto custo de manutenção | Migração gradual para registry/router modular | P0 |
| Cinema TMDB | Implementado e usado pelo legado | Resolução de ambiguidade limitada | Pode escolher título errado | V2 adiciona IDs TMDB e escolha explícita | P1 |
| Alertas de streaming | Implementados, não são tempo real | Dependem de varredura e dados do provedor | Atrasos/duplicatas possíveis | Baseline, evento persistente e resumo configurável | P1 |
| Economia | V2 implementado em código | Ainda não validado com Postgres real | Garantias dependem do store ativo | Ledger idempotente, saldo inteiro e mutação serial/transacional | P1 |
| Sessões e votação | V2 implementado em código | Fluxo ainda simples | Engajamento sem agenda completa | Evoluir agenda, prazos e encerramento persistente | P1 |
| NOX | Implementado no legado | Economia e NOX ainda fragmentados | Progressão não conversa com comunidade | Adapter determinístico de recompensas em fase C | P1/P3 |
| VIP | Implementado no legado | Ativação e economia vivem em stores diferentes | Risco de falha parcial | Ponte idempotente + compensação; migrar VIP para transação única no Postgres | P0/P2 |
| IA/transcrição/imagem/voz | Ausente/bloqueado por provedor | Não há credenciais verificadas | Não pode ser anunciado como funcional | Adapters por provedor, fila, quotas e custo antes de ativar | P2 |
| Mídia | Implementada para stickers/conversões | Jobs rodam no processo principal | CPU/memória podem afetar comandos | Fila persistente e limites | P2 |
| Inatividade/limpeza | V2 implementado em código | Histórico anterior à observação do bot é incompleto | Falso positivo se tratado como abandono | Mostrar “dados insuficientes”, simulação e revalidação | P0/E |
| Privacidade | V2 implementado em código | Legado expõe alguns dados de perfil por número | Risco de excesso de dados | Minimização, self-service e anonimização de ledger | P0 |

## Retenção e fragmentação

O bot já tem cinema, mídia, moderação, VIP e NOX, mas esses recursos foram adicionados em camadas separadas. O maior problema de retenção não é falta de comandos: é que uma ação em cinema quase não altera perfil, economia ou NOX. A fase V2 liga check-in, carteira, acompanhamentos, sessões e atividades, sem pagar por mensagens.

Alertas coletivos devem priorizar resumos e não notificações por evento. O monitor atual não deve ser descrito como tempo real. A economia usa regras previsíveis, idempotência e limites globais; não há cassino, aposta ou recompensa por volume de mensagens.

## Simulação econômica de 30 dias

Hipóteses de configuração, não promessa comercial: check-in = 25 créditos; quiz correto planejado = 10; presença confirmada em sessão planejada = 20; missão NOX planejada = 15; VIP 7 dias = 1.200 créditos; VIP 30 dias = 4.000 créditos.

Usuário casual hipotético: 15 check-ins, 8 acertos de quiz, 4 sessões e 8 missões NOX = **655 créditos/mês**. Usuário ativo hipotético: 30 check-ins, 120 acertos, 12 sessões e 30 missões = **2.640 créditos/mês**. Com esses valores, o VIP de 7 dias exige aproximadamente 1,8 mês para o casual e menos de meio mês para o ativo; o VIP de 30 dias exige cerca de 6,1 meses para o casual e 1,5 mês para o ativo. Como quiz/sessão/NOX ainda não estão todos creditando no runtime atual, a emissão real inicialmente é menor que essa simulação.

## Ordem de execução

P0: estabilizar runtime V2, permissões, identidade, persistência e backup. P1: completar cinema/sessões/alertas e conectar economia ao NOX. P2: colocar mídia e IA em fila e validar custo/quotas. P3: expandir mundo NOX, facções, reputação e personalização.
