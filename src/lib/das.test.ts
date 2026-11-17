import { describe, expect, it } from "vitest";
import { lerGuia } from "./das";

// Texto como o unpdf extrai do PDF do PGDAS-D (um rótulo por linha).
const DAS = `RECEITA FEDERAL Documento de Arrecadação
do Simples Nacional
CNPJ
38.477.169/0001-00
Razão Social
BDX ENGENHARIA E PROJETOS LTDA
Período de Apuração
Outubro/2026
Data de Vencimento
20/11/2026
Número do Documento
07.20.26314.6158392-4
Pagar este documento até
23/11/2026
Observações
Valor Total do Documento
1.585,01
Composição do Documento de Arrecadação
Código Denominação Principal Multa Juros Total
1001 IRPJ - SIMPLES NACIONAL 87,18 - - 87,18
1006 INSS - SIMPLES NACIONAL 687,89 - - 687,89
1010 ISS - SIMPLES NACIONAL - SÃO PAULO (SP) 809,94 - - 809,94
Totais 1.585,01 0,00 0,00 1.585,01
85810000015-5 85010328263-1 14070202631-4 46158392400-9`;

// Mesma guia com rótulos agrupados na linha e valores na linha de baixo (outra extração comum).
const DAS_AGRUPADO = `Documento de Arrecadação do Simples Nacional
CNPJ Razão Social
38.477.169/0001-00 BDX ENGENHARIA E PROJETOS LTDA
Período de Apuração Data de Vencimento Número do Documento
Março/2026 20/04/2026 07.20.26080.1111111-1
Pagar este documento até Observações
20/04/2026
Valor Total do Documento
250,00`;

// DARF numerado da DCTFWeb (contribuição previdenciária).
const DARF_DCTFWEB = `RECEITA FEDERAL Documento de Arrecadação de Receitas Federais
DARF
CNPJ
38.477.169/0001-00
Razão Social
BDX ENGENHARIA E PROJETOS LTDA
Período de Apuração Data de Vencimento Número do Documento
31/10/2026 20/11/2026 07.17.26314.0049210-7
Pagar este documento até Observações
20/11/2026 DCTFWeb Mensal 10/2026
Valor Total do Documento
1.396,40
Composição do Documento de Arrecadação
Código Denominação Principal Multa Juros Total
1082 CP SEGURADOS - CONTRIBUINTE INDIVIDUAL 154,00 - - 154,00
1138 CP PATRONAL - CONTRIBUINTE INDIVIDUAL 1.242,40 - - 1.242,40
Totais 1.396,40 0,00 0,00 1.396,40`;

// DARF comum do Sicalc (campos numerados).
const DARF_SICALC = `MINISTÉRIO DA FAZENDA
SECRETARIA DA RECEITA FEDERAL DO BRASIL
Documento de Arrecadação de Receitas Federais
DARF
01 NOME/TELEFONE
BDX ENGENHARIA E PROJETOS LTDA
02 PERÍODO DE APURAÇÃO 30/09/2026
03 NÚMERO DO CPF OU CNPJ 38.477.169/0001-00
04 CÓDIGO DA RECEITA 2089
05 NÚMERO DE REFERÊNCIA
06 DATA DE VENCIMENTO 31/10/2026
07 VALOR DO PRINCIPAL 3.120,00
08 VALOR DA MULTA
09 VALOR DOS JUROS E/OU ENCARGOS DL - 1.025/69
10 VALOR TOTAL 3.120,00
11 AUTENTICAÇÃO BANCÁRIA`;

describe("lerGuia", () => {
  it("DAS: vencimento de 'Pagar este documento até', valor total, período, CNPJ e número", () => {
    expect(lerGuia(DAS)).toEqual({
      tipo: "DAS",
      vencimento: "2026-11-23",
      valor: "1585.01",
      periodo: "2026-10",
      cnpj: "38477169000100",
      numero: "07.20.26314.6158392-4",
    });
  });

  it("DAS com rótulos agrupados (mês com acento)", () => {
    expect(lerGuia(DAS_AGRUPADO)).toMatchObject({ tipo: "DAS", vencimento: "2026-04-20", valor: "250.00", periodo: "2026-03", cnpj: "38477169000100" });
  });

  it("DARF da DCTFWeb: período em data, previdenciário e código da receita", () => {
    expect(lerGuia(DARF_DCTFWEB)).toEqual({
      tipo: "DARF",
      vencimento: "2026-11-20",
      valor: "1396.40",
      periodo: "2026-10",
      cnpj: "38477169000100",
      numero: "07.17.26314.0049210-7",
      codigoReceita: "1082",
      previdenciario: true,
    });
  });

  it("DARF do Sicalc: campos numerados, não previdenciário", () => {
    expect(lerGuia(DARF_SICALC)).toEqual({
      tipo: "DARF",
      vencimento: "2026-10-31",
      valor: "3120.00",
      periodo: "2026-09",
      cnpj: "38477169000100",
      codigoReceita: "2089",
      previdenciario: false,
    });
  });

  it("rótulos agrupados sem 'Pagar até': vencimento é a data depois do período", () => {
    const t = "DARF\nPeríodo de Apuração Data de Vencimento\n31/10/2026 20/11/2026\nValor Total\n10,00";
    expect(lerGuia(t)).toMatchObject({ vencimento: "2026-11-20", periodo: "2026-10", valor: "10.00" });
  });

  it("texto sem guia: nada lido", () => {
    expect(lerGuia("Extrato bancário\nSaldo 1.000,00")).toEqual({ tipo: null });
  });
});
