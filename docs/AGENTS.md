# Agentes do Cognito AI Backend

Guia de referência dos subagentes do Claude Code configurados neste repo
(`.claude/agents/*.md`) e da rotina de mercado agendada na nuvem. Se você
mudar algum agente, atualize este guia também.

## Visão geral

```
Você (pede uma tarefa de dev)
        │
        ▼
     master  ──────────────► delega implementação
        │                          │
        │                          ▼
        │                    backend-dev (escreve código)
        │                          │
        │                          ▼
        └──────────────────► code-reviewer (audita o diff)
                                    │
                         achado CONFIRMED? ── sim ──► volta pro backend-dev (até 2 rodadas)
                                    │
                                   não
                                    ▼
                          relatório final + entrada em docs/AGENT_LOG.md
```

Fora desse ciclo, roda separadamente:

```
[nuvem, toda segunda 08h BRT] ──► rotina "Radar de Mercado e Concorrentes"
                                       │
                                       ▼
                            Artifact (dashboard) + notificação push
```

## Como acionar cada um

Você não precisa nomear o agente explicitamente — o Claude Code escolhe pela
`description` de cada um. Mas para forçar um agente específico, peça por
nome:

| Agente            | Quando aciona sozinho (auto)                                                                       | Como pedir explicitamente                                         |
| ----------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **master**        | Qualquer tarefa de dev no backend (feature, bugfix, refactor em `src/modules/**`, workers, config) | "peça pro **master** implementar/corrigir X"                      |
| **backend-dev**   | Raramente sozinho — normalmente via master                                                         | "usa o **backend-dev** direto pra..." (pula a revisão automática) |
| **code-reviewer** | Depois de qualquer mudança de código, antes de dar por concluído                                   | "roda o **code-reviewer** nesse diff"                             |

Recomendado: sempre passar pelo `master` para trabalho real de feature/bugfix,
para garantir que a revisão aconteça. Usar `backend-dev` ou `code-reviewer`
isolados é útil só para tarefas pontuais (ex: só quer uma segunda opinião
sobre um trecho já pronto).

## Onde ver o que os agentes fizeram

- **`docs/AGENT_LOG.md`** — histórico de rodadas do `master`: o que foi
  pedido, o que o `backend-dev` mudou, o veredito do `code-reviewer` e quantas
  rodadas de correção rolaram. Atualizado automaticamente pelo próprio
  `master` ao final de cada tarefa.
- **Transcript da sessão** — enquanto uma tarefa roda, o Claude Code mostra
  ao vivo cada subagente sendo acionado e seu resultado (isso já é nativo da
  ferramenta, não precisa de nada extra).
- **Rotina de mercado** — roda na nuvem (Anthropic), não aparece no terminal
  local. Veja o resumo por notificação push, ou o dashboard publicado como
  Artifact. Gerenciar/rodar manualmente em
  https://claude.ai/code/routines.

## Arquivos

- `.claude/agents/master.md` — orquestrador
- `.claude/agents/backend-dev.md` — implementação
- `.claude/agents/code-reviewer.md` — revisão
- `docs/AGENT_LOG.md` — histórico de rodadas (gerado)
