import { decodificar } from "./csv";

export type OfxTransacao = { fitid: string; data: string; valor: string; memo: string; tipo: string | null };
export type OfxExtrato = {
  bankId: string; acctId: string; dtStart: string | null; dtEnd: string | null;
  saldoFinal: string | null; dataSaldo: string | null; transacoes: OfxTransacao[];
};

function tag(src: string, name: string): string | null {
  const m = src.match(new RegExp(`<${name}>([^<\r\n]*)`, "i"));
  return m ? m[1].trim() : null;
}
function parseDate(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function parseAmount(s: string | null): string {
  if (!s) throw new Error("TRNAMT ausente");
  const n = Number(s.replace(/\s/g, "").replace(/\.(?=\d{3},)/g, "").replace(",", "."));
  if (Number.isNaN(n)) throw new Error(`Valor inválido: ${s}`);
  return n.toFixed(2);
}

export function parseOfx(buf: Buffer): OfxExtrato {
  // Itaú manda UTF-8 com cabeçalho CHARSET:1252: decide pelos bytes, não pelo cabeçalho.
  const src = decodificar(buf).texto;
  if (/<CCSTMTRS>/i.test(src)) throw new Error("Extrato de cartão de crédito não é suportado nesta versão");
  const body = src.match(/<STMTRS>([\s\S]*?)(<\/STMTRS>|$)/i)?.[1];
  if (!body) throw new Error("Arquivo não contém extrato bancário (STMTRS)");
  const bankId = tag(body, "BANKID"), acctId = tag(body, "ACCTID");
  if (!bankId || !acctId) throw new Error("BANKID/ACCTID ausentes");
  const blocks = body.match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>|<LEDGERBAL>|$)/gi) ?? [];
  // Zero transações é válido: mês sem movimento, só saldo.
  const vistos = new Map<string, number>();
  const transacoes = blocks.map((b): OfxTransacao => {
    const fitid = tag(b, "FITID"), data = parseDate(tag(b, "DTPOSTED"));
    if (!fitid || !data) throw new Error("Transação sem FITID ou data");
    // FITID repetido no mesmo arquivo (bancos que reaproveitam): #2, #3... na ordem do arquivo.
    const n = (vistos.get(fitid) ?? 0) + 1;
    vistos.set(fitid, n);
    const name = tag(b, "NAME"), memo = tag(b, "MEMO");
    return {
      fitid: n === 1 ? fitid : `${fitid}#${n}`, data, valor: parseAmount(tag(b, "TRNAMT")), tipo: tag(b, "TRNTYPE"),
      memo: [name, memo]
        .filter((x): x is string => !!x)
        .filter((x, _i, a) => !a.some((o) => o !== x && o.includes(x)))
        .join(" ")
        .trim(),
    };
  });
  const ledger = body.match(/<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|$)/i)?.[1] ?? "";
  return {
    bankId, acctId,
    dtStart: parseDate(tag(body, "DTSTART")), dtEnd: parseDate(tag(body, "DTEND")),
    saldoFinal: tag(ledger, "BALAMT") ? parseAmount(tag(ledger, "BALAMT")) : null,
    dataSaldo: parseDate(tag(ledger, "DTASOF")),
    transacoes,
  };
}

/** Normaliza BANKID/ACCTID para comparação: só alfanuméricos, sem zeros à esquerda, maiúsculo. */
export const normalizarIdOfx = (s: string) => s.replace(/[^0-9a-z]/gi, "").replace(/^0+/, "").toUpperCase();
