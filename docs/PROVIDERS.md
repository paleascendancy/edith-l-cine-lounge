# Provedores e capacidades — Rimuru-Bot

Verificado em 2026-09-12. Esta matriz separa integração real de integração planejada.

| Provedor/camada | Uso | Estado | Credencial | Custo/limite conhecido no projeto | Observações |
|---|---|---|---|---|---|
| WhatsApp via Baileys | Transporte de mensagens/grupos/mídia | Ativo em produção | Sessão persistente em `AUTH_DIR` | Não há preço de API oficial associado a Baileys no projeto | Baileys é uma biblioteca WebSocket para WhatsApp Web e não é a API oficial do WhatsApp. O repositório upstream informa breaking changes na linha 7.x; o bot permanece fixado em 6.7.24 até uma migração testada. |
| TMDB API v3 | Metadados de filmes/séries, busca, tendências e provedores | Ativo em produção | `TMDB_API_KEY` ou `TMDB_TOKEN` | O projeto não fixa nem inventa um plano/preço | Região padrão BR e idioma pt-BR. |
| JustWatch via TMDB | Disponibilidade por provedor | Disponível por meio da TMDB | Mesma credencial TMDB | Não há preço definido no projeto | A documentação TMDB exige atribuição a JustWatch. A resposta não contém deep links completos de reprodução; não inventar links diretos. |
| PostgreSQL | Persistência transacional V2 | Implementado no código; não provisionado em produção | `DATABASE_URL` | Não provisionado, portanto custo não assumido | Sem `DATABASE_URL`, o V2 usa JSON atômico no volume persistente. |
| Supabase | PostgreSQL gerenciado opcional | Não conectado neste deploy | URL/credenciais de projeto | Não verificado | Se usado, continua sendo PostgreSQL; não tratar como banco concorrente. |
| Transcrição | `!transcrever`, `!resumiraudio` | Pendente de adaptador/provedor | Não configurada | Não verificado | Não anunciar como funcional até existir provedor, teste real e orçamento. |
| Geração de imagens | `!draw` | Pendente de adaptador/provedor | Não configurada | Não verificado | Deve operar com fila e quota; falha não deve consumir quota de sucesso. |
| Voz sintética | `!voz` | Pendente de adaptador/provedor | Não configurada | Não verificado | Somente estilos/vozes licenciadas ou autorizadas; áudio deve ser identificado como sintético. |
| Remoção de fundo | `!semfundo`, `!s -semfundo` | Pendente de motor de segmentação | Não configurada | Não verificado | Sharp sozinho não fornece segmentação semântica confiável de primeiro plano. |

## Fontes oficiais consultadas

- TMDB Watch Providers: https://developer.themoviedb.org/reference/movie-watch-providers
- TMDB TV/Season Watch Providers: https://developer.themoviedb.org/reference/tv-season-watch-providers
- Baileys upstream: https://github.com/WhiskeySockets/Baileys
- PostgreSQL Transaction Isolation: https://www.postgresql.org/docs/current/transaction-iso.html

## Regra de operação

Uma integração só muda de **pendente** para **ativa** quando houver: credencial real quando necessária, teste de sucesso com o fornecedor, tratamento de timeout/erro e evidência nos logs. Nenhum endpoint, preço ou cobertura é presumido.
