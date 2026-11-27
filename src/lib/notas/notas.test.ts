import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { cents, somarMeses } from "../format";
import { validarPartidas } from "../lancamentos";
import { partidasTitulo } from "../operacoes";
import { chaveDocumento, contraparteDaNota, direcaoDaNota, lerNota, parcelasDaNota, parcelasIguais } from "./index";
import { dataDaNota } from "./registro";
import { decodificarXml, lerXml, txt } from "./xml";
import { lerZip } from "./zip";

const fx = (f: string) => readFileSync(path.join(__dirname, "../../../test/fixtures/notas", f), "utf8");
const ACME = "11222333000181", CLIENTE = "44555666000181";
const rets = (n: { retencoes: { tipo: string; valor: string }[] }) => Object.fromEntries(n.retencoes.map((r) => [r.tipo, r.valor]));

describe("NF-e modelo 55", () => {
  const n = lerNota(fx("nfe_55_duplicatas.xml"));
  it("chave, número, partes, datas e valores", () => {
    expect(n.chave).toBe("23260311222333000181550010000012341123456780");
    expect(n.chave).toHaveLength(44);
    expect([n.layout, n.numero, n.serie, n.emissao, n.competencia]).toEqual(["NF-e", "1234", "1", "2026-03-15", "2026-03-01"]);
    expect(n.emitente).toEqual({ documento: ACME, nome: "ACME COMERCIO & SERVICOS LTDA" });
    expect(n.destinatario?.documento).toBe(CLIENTE);
    expect([n.bruto, n.liquido]).toEqual(["3000.00", "2815.50"]);
    expect(rets(n)).toEqual({ pis: "19.50", cofins: "90.00", csll: "30.00", irrf: "45.00" });
    expect(n.avisos).toEqual([]);
  });
  it("duplicatas viram um título cada", () => {
    expect(parcelasDaNota(n).parcelas).toEqual([{ valor: "1407.75", vencimento: "2026-04-15" }, { valor: "1407.75", vencimento: "2026-05-15" }]);
  });
  it("sem protocolo e devolução avisam", () => {
    const x = lerNota(fx("nfe_55_duplicatas.xml").replace(/<protNFe[\s\S]*<\/protNFe>/, "").replace("<finNFe>1</finNFe>", "<finNFe>4</finNFe>"));
    expect(x.avisos.join(" ")).toMatch(/protocolo.*devolução/);
  });
});

describe("NFS-e Padrão Nacional", () => {
  const n = lerNota(fx("nfse_nacional_v100.xml"));
  it("chave de acesso, prestador, tomador, competência", () => {
    expect(n.chave).toBe("42054072211222333000181000000000012326031234567890");
    expect([n.layout, n.numero, n.emissao, n.competencia]).toEqual(["NFS-e Nacional", "123", "2026-03-10", "2026-03-01"]);
    expect(n.emitente).toEqual({ documento: ACME, nome: "ACME SOFTWARE LTDA" });
    expect(n.destinatario).toEqual({ documento: CLIENTE, nome: "CLIENTE EXEMPLO S.A." });
  });
  it("NT 007: vRetCSLL soma PIS/COFINS/CSLL; vPis/vCofins (apuração própria) não são retenção", () => {
    expect(rets(n)).toEqual({ iss: "500.00", irrf: "150.00", inss: "1100.00", csrf: "465.00" });
    expect([n.bruto, n.liquido]).toEqual(["10000.00", "7785.00"]);
    expect(n.avisos).toEqual([]);
  });
  it("antes da NT 007 (tpRetPisCofins 1, vTotalRet com PIS/COFINS): retidos separados", () => {
    const x = lerNota(fx("nfse_nacional_v100.xml").replace("<tpRetPisCofins>3</tpRetPisCofins>", "<tpRetPisCofins>1</tpRetPisCofins>")
      .replace("<vPis>165.00</vPis>", "<vPis>65.00</vPis>").replace("<vCofins>760.00</vCofins>", "<vCofins>300.00</vCofins>")
      .replace("<vRetCSLL>465.00</vRetCSLL>", "<vRetCSLL>100.00</vRetCSLL>"));
    expect(rets(x)).toEqual({ iss: "500.00", irrf: "150.00", inss: "1100.00", pis: "65.00", cofins: "300.00", csll: "100.00" });
    expect(x.liquido).toBe("7785.00");
  });
  it("ISS não retido não entra; líquido do XML confere", () => {
    const x = lerNota(fx("nfse_nacional_v100.xml").replace("<tpRetISSQN>2</tpRetISSQN>", "<tpRetISSQN>1</tpRetISSQN>")
      .replace("<vTotalRet>2215.00</vTotalRet>", "<vTotalRet>1715.00</vTotalRet>").replace("<vLiq>7785.00</vLiq>", "<vLiq>8285.00</vLiq>"));
    expect(rets(x).iss).toBeUndefined();
    expect(x.liquido).toBe("8285.00");
  });
  it("diferença sem retenção identificada vira Outras retenções (o contador confirma)", () => {
    const x = lerNota(fx("nfse_nacional_v100.xml").replace("<vLiq>7785.00</vLiq>", "<vLiq>7700.00</vLiq>"));
    expect(rets(x).outras).toBe("85.00");
    expect(x.liquido).toBe("7700.00");
    expect(x.avisos[0]).toMatch(/Outras retenções/);
  });
  it("v1.01 lê igual", () => expect(lerNota(fx("nfse_nacional_v101.xml")).liquido).toBe("7785.00"));
});

describe("NFS-e ABRASF", () => {
  it.each(["abrasf_204_compnfse.xml", "abrasf_202_compnfse.xml", "abrasf_100_compnfse.xml"])("%s", (f) => {
    const n = lerNota(fx(f));
    expect([n.layout, n.emissao, n.competencia]).toEqual(["NFS-e ABRASF", "2026-03-10", "2026-03-01"]);
    expect(n.emitente.documento).toBe(ACME);
    expect(n.destinatario).toEqual({ documento: CLIENTE, nome: "CLIENTE EXEMPLO S.A." });
    expect(rets(n)).toEqual({ iss: "500.00", irrf: "150.00", inss: "1100.00", pis: "65.00", cofins: "300.00", csll: "100.00" });
    expect([n.bruto, n.liquido]).toEqual(["10000.00", "7785.00"]);
    expect(n.chave).toBe(chaveDocumento(ACME, null, n.numero));
  });
  it("prefeitura que preenche PIS/COFINS sem descontar do líquido: informativo", () => {
    const n = lerNota(fx("abrasf_204_compnfse.xml").replace("<ValorLiquidoNfse>7785.00</ValorLiquidoNfse>", "<ValorLiquidoNfse>9500.00</ValorLiquidoNfse>"));
    expect(rets(n)).toEqual({ iss: "500.00" });
    expect(n.avisos[0]).toMatch(/informativos/);
  });
  it("cancelada e evento são ignorados com o motivo", () => {
    expect(() => lerNota(fx("abrasf_204_compnfse.xml").replace("</Nfse>", "</Nfse><NfseCancelamento><Confirmacao/></NfseCancelamento>"))).toThrow(/cancelada/);
    expect(() => lerNota(`<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe"><evento/></procEventoNFe>`)).toThrow(/evento/);
    expect(() => lerNota("<foo/>")).toThrow(/Layout/);
  });
  it("XML da nota escapado dentro da resposta do webservice", () => {
    const escapado = fx("abrasf_204_compnfse.xml").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    expect(lerNota(`<s:Envelope xmlns:s="x"><s:Body><outputXML>${escapado}</outputXML></s:Body></s:Envelope>`).liquido).toBe("7785.00");
  });
});

describe("direção pelo CNPJ", () => {
  const n = lerNota(fx("nfse_nacional_v100.xml"));
  it("prestadora → a receber; tomadora → a pagar; outra empresa → null", () => {
    expect(direcaoDaNota(n, "11.222.333/0001-81")).toBe("receber");
    expect(direcaoDaNota(n, CLIENTE)).toBe("pagar");
    expect(direcaoDaNota(n, "38477169000100")).toBeNull();
    expect(contraparteDaNota(n, "receber").documento).toBe(CLIENTE);
    expect(contraparteDaNota(n, "pagar").nome).toBe("ACME SOFTWARE LTDA");
  });
  it("CNPJ alfanumérico (2026) compara sem máscara", () => {
    expect(direcaoDaNota({ emitente: { documento: "12ABC34501DE35", nome: "" }, destinatario: null }, "12.ABC.345/01DE-35")).toBe("receber");
  });
});

describe("partidas da nota com retenções", () => {
  it("NFS-e emitida: D Clientes 7.785 + D retidos 2.215 / C receita 10.000", () => {
    const n = lerNota(fx("nfse_nacional_v100.xml"));
    const ps = partidasTitulo("receber", "clientes", "receita", n.liquido, n.retencoes.map((r) => ({ contaId: r.tipo, valor: r.valor })));
    expect(validarPartidas(ps).total).toBe(cents(n.bruto));
  });
  it("NF-e recebida com duplicatas: retenções na 1ª, todas balanceadas, soma = bruto", () => {
    const n = lerNota(fx("nfe_55_duplicatas.xml"));
    const { parcelas } = parcelasDaNota(n);
    const total = parcelas.reduce((s, p, i) => s + validarPartidas(partidasTitulo("pagar", "forn", "custo", p.valor,
      i === 0 ? n.retencoes.map((r) => ({ contaId: r.tipo, valor: r.valor })) : [])).total, 0);
    expect(total).toBe(cents(n.bruto));
  });
});

describe("parcelas e datas", () => {
  it("duplicatas que não somam o líquido: um título só", () => {
    const r = parcelasDaNota({ liquido: "100", duplicatas: [{ numero: "1", vencimento: "2026-04-01", valor: "60" }, { numero: "2", vencimento: null, valor: "30" }] });
    expect(r.parcelas).toEqual([{ valor: "100.00", vencimento: "2026-04-01" }]);
    expect(r.aviso).toMatch(/um título só/);
  });
  it("parcelas iguais do cadastro manual somam o líquido", () => {
    const ps = parcelasIguais("100", 3, "2026-01-31", somarMeses);
    expect(ps).toEqual([{ valor: "33.33", vencimento: "2026-01-31" }, { valor: "33.33", vencimento: "2026-02-28" }, { valor: "33.34", vencimento: "2026-03-31" }]);
  });
  it("reconhecimento: emissão no mês; competência antes = fim do mês; depois = dia 1", () => {
    expect(dataDaNota("2026-03-10", "2026-03-01")).toBe("2026-03-10");
    expect(dataDaNota("2026-04-05", "2026-03-01")).toBe("2026-03-31");
    expect(dataDaNota("2026-02-25", "2026-03-01")).toBe("2026-03-01");
  });
  it("chave manual sem zeros à esquerda bate com o XML", () => {
    expect(chaveDocumento("11.222.333/0001-81", "001", "000123")).toBe(chaveDocumento(ACME, "1", "123"));
  });
});

describe("leitor de XML e zip", () => {
  it("prefixos, entidades, CDATA, comentários e atributos com >", () => {
    const r = lerXml(`<?xml version="1.0"?><!-- x --><ns2:a xmlns:ns2="u" b="1 &gt; 0"><ns2:c>A &amp; B &#233;</ns2:c><d><![CDATA[<x>]]></d><e/></ns2:a>`);
    expect(r.filhos[0].nome).toBe("a");
    expect(r.filhos[0].attrs.b).toBe("1 > 0");
    expect(txt(r, "a", "c")).toBe("A & B é");
    expect(txt(r, "a", "d")).toBe("<x>");
  });
  it("ISO-8859-1 pela declaração; UTF-8 por padrão", () => {
    const latin = Buffer.from(`<?xml version="1.0" encoding="ISO-8859-1"?><a>Serviço</a>`, "latin1");
    expect(txt(lerXml(decodificarXml(latin)), "a")).toBe("Serviço");
    expect(txt(lerXml(decodificarXml(Buffer.from(`<a>Serviço</a>`, "utf8"))), "a")).toBe("Serviço");
  });
  it("zip com deflate e stored", async () => {
    const arquivos = [{ nome: "a.xml", dados: Buffer.from("<a>1</a>"), metodo: 8 }, { nome: "pasta/b.xml", dados: Buffer.from("<b>2</b>"), metodo: 0 }];
    const zip = montarZip(arquivos);
    const lidos = await lerZip(new Uint8Array(zip));
    expect(lidos.map((a) => [a.nome, Buffer.from(a.dados).toString()])).toEqual([["a.xml", "<a>1</a>"], ["pasta/b.xml", "<b>2</b>"]]);
  });
});

/** Zip mínimo (sem CRC: o leitor não confere). */
function montarZip(arqs: { nome: string; dados: Buffer; metodo: number }[]) {
  const locais: Buffer[] = [], centrais: Buffer[] = [];
  let off = 0;
  for (const a of arqs) {
    const corpo = a.metodo === 8 ? deflateRawSync(a.dados) : a.dados;
    const nome = Buffer.from(a.nome);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(a.metodo, 8); l.writeUInt32LE(corpo.length, 18); l.writeUInt32LE(a.dados.length, 22); l.writeUInt16LE(nome.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(a.metodo, 10); c.writeUInt32LE(corpo.length, 20); c.writeUInt32LE(a.dados.length, 24);
    c.writeUInt16LE(nome.length, 28); c.writeUInt32LE(off, 42);
    locais.push(l, nome, corpo);
    centrais.push(c, nome);
    off += 30 + nome.length + corpo.length;
  }
  const cd = Buffer.concat(centrais);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(arqs.length, 8); e.writeUInt16LE(arqs.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locais, cd, e]);
}
