# Atualização do estado da intervenção — 6 de novembro de 2026

O funcionário podia conservar o botão «Iniciar intervenção» depois de a picagem ter sido gravada e já estar visível ao administrador. O painel dependia da atualização geral da interface e não verificava autonomamente as picagens locais ao regressar do segundo plano.

O módulo do técnico passa a atualizar o painel logo após uma chamada nativa a `guardarDados` e quando essa chamada termina, com sucesso ou erro. A promise original continua a ser devolvida, incluindo a sua rejeição; não se altera a persistência nem se apresenta uma falha como confirmação de gravação. As picagens locais continuam disponíveis para o fluxo nativo de sincronização.

Ao regressar ao primeiro plano, e a cada três segundos enquanto a página está visível, uma verificação local compara a identidade, o dia, as picagens pessoais e os estados/atribuições de serviços e obras. Só reconstrói o painel quando deteta mudança. Não faz pedidos de rede, cria picagens ou altera tempos/custos. Os formulários e rascunhos abertos conservam os seus campos. O cache do painel também deteta quando outro renderizador substituiu os seus nós.

## Verificação

- Seis novos testes passaram: entrada pela função real da OS sem evento de atualização geral, gravação pendente ou falhada, identidade da promise, regresso ao primeiro plano, recuperação periódica, cache de HTML substituído, saída, obras, isolamento por pessoa/empresa e preservação de campos abertos.
- Cinco testes comportamentais falham com o módulo anterior e passam com a correção.
- No conjunto de 70 testes relacionados, 68 passam. Mantêm-se duas falhas anteriores em `technician-personal-ui.test.cjs`: fonte literal `16px` perante `max(...)` e versão de asset antiga fixada no teste. Foram identificadas antes desta alteração.
- Sintaxe JavaScript e `git diff --check` passaram.
- A verificação no navegador ficou bloqueada pela indisponibilidade do encaminhamento da pré-visualização nesta sessão. Nenhuma picagem foi criada em contas reais.
