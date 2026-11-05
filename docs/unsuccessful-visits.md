# Visita sem sucesso — 5 de novembro de 2026

Na saída de uma OS, «Visita sem sucesso» permite indicar cliente ausente, falta de acesso, pedido de reagendamento, falta de condições, falta de material ou outro motivo. «Outro» exige uma descrição. Até três fotografias JPEG comprimidas ficam no registo da tentativa, dentro dos dados da OS (não são publicadas num bucket público).

Cada tentativa é identificada pela picagem e conserva técnico, data/hora, motivo, observações e fotografias. Fecha apenas essa picagem. Não cria folha de obra ou relatório, não exige assinatura, não altera pagamentos, não resolve assistências e não conta como uma visita concluída de manutenção. As horas registadas continuam disponíveis aos cálculos existentes. Outro técnico em serviço conserva a sua entrada aberta.

O estado persistido mantém os valores existentes: pendente ou em andamento. A pendência «Por reagendar» é derivada das tentativas por tratar, aparece na lista/calendário e no Resumo do Dia/alertas da administração, incluindo dias anteriores. O técnico que declarou a visita aguarda decisão antes de voltar a iniciar a mesma OS.

Admin/sub-admin pode reagendar com nova data, hora e equipa, cancelar a OS ou manter o serviço e tratar a pendência. Reagendar/cancelar exige ausência de outros técnicos ainda em serviço. O histórico conserva as tentativas e decisões. A cobrança é uma decisão registada (por decidir, cobrar com valor, ou não cobrar); nenhuma fatura, recebimento ou cobrança é emitida automaticamente.

## Persistência

Os registos usam o namespace `checklist.__tgVisitasSemSucesso` da coluna JSON existente. Não há migração, nova tabela, política RLS ou chave privilegiada. As gravações usam o cliente autenticado existente, filtros de empresa/OS e confirmação das linhas retornadas. Atualizações condicionais comparam checklist/estado e juntam tentativas de outros dispositivos. Uma falha ou resposta vazia não é apresentada como sucesso. Registos por sincronizar mantêm o mesmo identificador e o formulário permite repetir sem duplicar. O campo checklist nunca é retirado silenciosamente como fallback de coluna inexistente.

A autorização no servidor continua a ser a das tabelas existentes. Os controlos do cliente reforçam empresa, perfil e atribuição; não substituem RLS. Sessões antigas do sistema devem atualizar a aplicação para usar o fluxo e preservar o novo histórico.

## Verificação

55 testes passaram: regras/validações, empresas e perfis distintos, idempotência, falhas de API e respostas vazias, concorrência simulada, saída real sem folha/assinatura/pagamento, round-trip dos mapeamentos Supabase, cancelar/repetir formulário, relatório em rascunho, conclusão individual, contadores, alertas e cálculo de horas/custos.

Verificação visual e funcional no navegador com dados fictícios: saída → motivo/observação → guardar → pendência do admin → reagendar/trocar equipa → conservar histórico. Formulário sem transbordo a 390 e 320 px.

Limites: a gravação contra a base de dados de produção não foi exercitada. A ligação de gestão disponível não tem permissão de leitura desse projeto. Não foram criados registos ou notificações em contas reais. Dois testes antigos de `technician-personal-ui.test.cjs` já falham na versão anterior: expectativa de fonte literal 16px perante `max(...)`, e versão de asset fixada em 1.9.0. As duas falhas foram reproduzidas no código anterior e não resultam desta alteração.

## Contador e modais uniformizados

A lista de OS apresenta o contador «Por reagendar», separado de Pendentes, com uma contagem por OS, mesmo quando existem várias tentativas. Ao clicar, abre diretamente o agendamento se existir uma OS; com várias, permite escolher a OS e abre o respetivo formulário. Depois de tratada a pendência, a OS sai desse contador.

Os formulários de registo e reagendamento reutilizam o modal genérico do TG, com os mesmos campos, botões e cruz de fecho. O histórico fica recolhido para dar prioridade à nova data, hora e equipa. O modal devolve os controlos ao estado normal quando é fechado, para os restantes ecrãs continuarem a funcionar. Verificados no navegador a 390 e 320 px com dados fictícios.
