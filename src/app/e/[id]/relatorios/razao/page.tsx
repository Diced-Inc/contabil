import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { z } from "zod";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "cn";
import { fmtData, fmtSaldoDC, fmtValor, hoje, isoData, lerAno } from "@/lib/format";
import { correr, semEstornos } from "@/lib/relatorios/movimentos";
import { razao360, type Contrapartida, type Razao360 } from "@/lib/relatorios/razao";
import { Carregando } from "@/components/page-header";
import { getEmpresa } from "../../empresa";
import { listarContasAnaliticas } from "../../lancamentos/queries";
import { RelatorioShell } from "../relatorio-shell";
import { Filtros } from "./filtros";
import { LancamentoProvider, LinhaLancamento } from "./lancamento-sheet";

type SP = Record<string, string | string[] | undefined>;
const uuid = z.uuid();

/** "MM" válido; aceita também data "YYYY-MM-DD" (links antigos com de/ate em data). */
function lerMes(v: unknown, padrao: string) {
  if (typeof v !== "string") return padrao;
  const m = isoData(v) ? v.slice(5, 7) : v;
  return /^(0[1-9]|1[0-2])$/.test(m) ? m : padrao;
}

function lerFiltros(sp: SP) {
  const ano = sp.ano === undefined && isoData(sp.de) ? Number((sp.de as string).slice(0, 4)) : lerAno(sp.ano);
  let de = lerMes(sp.de, "01"), ate = lerMes(sp.ate, "12");
  if (de > ate) [de, ate] = ["01", "12"];
  const ids = [typeof sp.contas === "string" ? sp.contas.split(",") : [], typeof sp.conta === "string" ? [sp.conta] : []].flat();
  const contas = [...new Set(ids.filter((s) => uuid.safeParse(s).success))];
  return { ano, de, ate, contas, todas: sp.todas === "1", estornos: sp.estornos === "1" };
}

const fimDoMes = (ano: number, mm: string) => new Date(Date.UTC(ano, Number(mm), 0)).toISOString().slice(0, 10);

function Contras({ cs }: { cs: Contrapartida[] }) {
  if (cs.length === 1) return <span title={`${cs[0].codigo} ${cs[0].nome}`}><span className="font-mono text-xs text-muted-foreground">{cs[0].codigo}</span> {cs[0].nome}</span>;
  return <span className="font-mono text-xs" title={cs.map((c) => `${c.codigo} ${c.nome}`).join("\n")}>{cs.map((c) => c.codigo).join(", ")}</span>;
}

function Tile({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-3 py-2">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{rotulo}</p>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{children}</div>
    </div>
  );
}

/** Movimentos visíveis (sem os pares de estorno, se ocultos) com saldo corrente e totais recalculados. */
const visivel = (r: Razao360, estornos: boolean) => (estornos ? r : { ...r, ...correr(semEstornos(r.movimentos), r.saldoAnterior) });

function Secao({ r, v, empresaId, ano, de, quebra }: {
  r: Razao360; v: ReturnType<typeof visivel>; empresaId: string; ano: number; de: string; quebra: boolean;
}) {
  const { natureza } = r.conta;
  return (
    <section className={cn("break-inside-avoid pt-5 first:pt-3", quebra && "print:break-before-page print:pt-0")}>
      <h2 className="px-2 text-sm font-semibold">
        <span className="mr-2 font-mono text-muted-foreground">{r.conta.codigo}</span>{r.conta.nome}
      </h2>
      <div className="mx-2 mt-2 grid grid-cols-2 divide-x divide-y rounded-lg border sm:grid-cols-4 sm:divide-y-0 print:grid-cols-4 print:divide-y-0">
        <Tile rotulo={`Saldo em 31/12/${ano - 1}`}>{fmtSaldoDC(r.saldoAnoAnterior, natureza)}</Tile>
        <Tile rotulo={`Saldo anterior (${de}/${ano})`}>{fmtSaldoDC(r.saldoAnterior, natureza)}</Tile>
        <Tile rotulo="Movimento (D / C)">
          {fmtValor(v.totais.debitos)} <span className="font-normal text-muted-foreground">/</span> {fmtValor(v.totais.creditos)}
        </Tile>
        <Tile rotulo="Saldo final">{fmtSaldoDC(v.saldoFinal, natureza)}</Tile>
      </div>
      <Table className="mt-2 table-fixed text-[13px] print:table-auto print:text-[11px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">Data</TableHead>
            <TableHead className="w-14">Nº</TableHead>
            <TableHead>Histórico</TableHead>
            <TableHead className="w-[26%] print:w-auto">Contrapartida</TableHead>
            <TableHead className="w-28 text-right print:w-auto">Débito</TableHead>
            <TableHead className="w-28 text-right print:w-auto">Crédito</TableHead>
            <TableHead className="w-32 text-right print:w-auto">Saldo</TableHead>
            <TableHead className="w-6 print:hidden" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {v.movimentos.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">Sem movimento no período</TableCell>
            </TableRow>
          ) : (
            v.movimentos.map((m, i) => (
              <LinhaLancamento key={`${m.lancamentoId}-${i}`} id={m.lancamentoId}>
                <TableCell className="py-1.5">{fmtData(m.data)}</TableCell>
                <TableCell className="py-1.5">
                  <Link href={`/e/${empresaId}/lancamentos/${m.lancamentoId}`} className="text-primary underline-offset-2 hover:underline print:text-foreground">
                    {m.numero}
                  </Link>
                </TableCell>
                <TableCell className="py-1.5 whitespace-normal">{m.historico}</TableCell>
                <TableCell className="truncate py-1.5 print:whitespace-normal"><Contras cs={m.contrapartidas} /></TableCell>
                <TableCell className="py-1.5 text-right">{Number(m.debito) ? fmtValor(m.debito) : ""}</TableCell>
                <TableCell className="py-1.5 text-right">{Number(m.credito) ? fmtValor(m.credito) : ""}</TableCell>
                <TableCell className="py-1.5 text-right whitespace-nowrap">{fmtSaldoDC(m.saldo, natureza)}</TableCell>
              </LinhaLancamento>
            ))
          )}
        </TableBody>
        <TableFooter className="border-t-2 border-t-foreground/70">
          <TableRow>
            <TableCell colSpan={4} className="py-1.5">Totais e saldo final</TableCell>
            <TableCell className="py-1.5 text-right">{fmtValor(v.totais.debitos)}</TableCell>
            <TableCell className="py-1.5 text-right">{fmtValor(v.totais.creditos)}</TableCell>
            <TableCell className="py-1.5 text-right whitespace-nowrap">{fmtSaldoDC(v.saldoFinal, natureza)}</TableCell>
            <TableCell className="print:hidden" />
          </TableRow>
        </TableFooter>
      </Table>
    </section>
  );
}

async function Razao({ params, searchParams }: PageProps<"/e/[id]/relatorios/razao">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const empresa = await getEmpresa(id);
  const f = lerFiltros(sp);
  const de = `${f.ano}-${f.de}-01`, ate = fimDoMes(f.ano, f.ate);
  const alvo = f.todas ? "todas" : f.contas;
  const [contas, todos] = await Promise.all([listarContasAnaliticas(id), razao360(id, alvo, de, ate)]);
  // em "todas", some a conta que só tinha pares de estorno e não tem saldo
  const rs = todos.map((r) => ({ r, v: visivel(r, f.estornos) })).filter(({ r, v }) =>
    !f.todas || v.movimentos.length > 0 || Number(r.saldoAnterior) !== 0 || Number(r.saldoAnoAnterior) !== 0);
  const periodo = f.de === "01" && f.ate === "12" ? `Ano ${f.ano}` : `${fmtData(de)} a ${fmtData(ate)}`;

  return (
    <RelatorioShell
      titulo={rs.length === 1 ? `Razão: ${rs[0].r.conta.codigo} ${rs[0].r.conta.nome}` : "Razão"}
      empresa={empresa}
      periodoLabel={periodo}
      dataAssinatura={ate}
      filtros={
        <Filtros key={JSON.stringify(f)} path={`/e/${id}/relatorios/razao`} contas={contas} mesAtual={hoje()} inicial={f} />
      }
    >
      {!f.todas && !f.contas.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Escolha uma ou mais contas, ou marque Todas as contas com movimento.</p>
      ) : !rs.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma conta com movimento ou saldo no período.</p>
      ) : (
        <LancamentoProvider empresaId={id}>
          {rs.map(({ r, v }, i) => (
            <Secao key={r.conta.id} r={r} v={v} empresaId={id} ano={f.ano} de={f.de} quebra={i > 0} />
          ))}
        </LancamentoProvider>
      )}
    </RelatorioShell>
  );
}

export default function RazaoPage(props: PageProps<"/e/[id]/relatorios/razao">) {
  return (
    <Suspense fallback={<Carregando />}>
      <Razao {...props} />
    </Suspense>
  );
}
