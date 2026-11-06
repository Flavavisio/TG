# Pesquisa e scroll no formulário de serviço — 6 de novembro de 2026

A pesquisa de clientes criava a lista em posição absoluta dentro do cabeçalho, que tem `overflow:hidden`. Os resultados podiam ficar cortados. A seleção era feita em `mousedown`, antes de distinguir um toque de um gesto para percorrer os nomes.

A lista passa a ocupar espaço no formulário, logo abaixo da pesquisa, com altura limitada, scroll próprio e nomes extensos repartidos por linhas. Seleciona apenas no clique concluído, conservando o mapa de clientes, o campo oculto e o callback já existentes. Os rótulos são inseridos como texto. A pesquisa continua por nome ou número e não altera os clientes guardados.

O campo de cliente tem texto e cursor escuros sobre o fundo claro. A lista de funcionários também recebe uma área de scroll tátil própria. O modal de OS usa a altura e o deslocamento de `visualViewport`; ao abrir o teclado, mantém o campo ativo na área visível sem alterar o seu conteúdo, seleção ou zoom. O ajuste de altura só se aplica ao modal que contém o formulário da OS, e as novas regras de apresentação são apenas para ecrã.

## Verificação

20 testes passaram: quatro novos casos de pesquisa, pressão sem seleção prematura, seleção de resultado posterior, nomes longos/literais, preservação e limpeza da escolha, callback, alteração simulada do viewport e alinhamento das versões de assets; incluem regressões de zoom, atualização da intervenção e visita sem sucesso. Sintaxe JavaScript e `git diff --check` passaram.

A verificação visual não ficou disponível: o navegador não conseguiu alcançar o servidor de pré-visualização e bloqueou ficheiros locais por política do ambiente. Não houve criação ou alteração de OS em contas reais durante os testes.
