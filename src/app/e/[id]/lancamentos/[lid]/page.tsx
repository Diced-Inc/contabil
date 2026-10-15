import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { z } from "zod";
import { editarLancamentoManual } from "@/actions/lancamentos";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Carregando, PageHeader, TablePanel } from "@/components/page-header";
import { cents, fmtCompetencia, fmtData, fmtValor, fromCents } from "@/lib/format";
import type { RetratoLancamento } from "@/lib/lancamentos";
import { requireUser } from "@/supabase/server";
import { getEmpresa } from "../../empresa";
import { FormLancamento } from "../form-lancamento";
import { ACOES_LOG, ORIGENS, getLancamento, listarContasAnaliticas, listarLog } from "../queries";
import { transacaoDoLancamento } from "../../conciliacao/queries";
import { DesfazerConciliacaoDialog, EstornarDialog } from "./estornar-dialog";

const TZ = "America/Sao_Paulo";
const ORIGEM_BADGE = { manual: "muted", conciliacao: "info", apuracao: "violet", estorno: "warning" } as const;
const CAMPOS: [keyof RetratoLancamento, string][] = [
  ["data", "data"], ["competencia", "competência"], ["dataPagamento", "pagamento"],
  ["historico", "histórico"], ["documento", "documento"],
];

/** Resumo legível do que mudou numa linha do log. */
function resumo(acao: string, antes: unknown, depois: unknown) {
  const a = antes as Partial<RetratoLancamento> | null;
  const d = depois as (Partial<RetratoLancamento> & { estornoNumero?: number; data?: string; origem?: string }) | null;
  if (acao === "estornado" && d) return `Estorno nº ${d.estornoNumero ?? "?"}${d.data ? ` em ${fmtData(d.data)}` : ""}`;
  if (acao === "criado" && d?.partidas) {
    const total = d.partidas.reduce((s, p) => s + cents(p.debito), 0);
    return `${d.partidas.length} partidas, total ${fmtValor(fromCents(total))}`;
  }
  if (acao === "alterado" && a && d) {
    const mud = CAMPOS.filter(([k]) => (a[k] ?? null) !== (d[k] ?? null)).map(
      ([k, nome]) => `${nome}: ${a[k] ?? "-"} → ${d[k] ?? "-"}`,
    );
    if (JSON.stringify(a.partidas) !== JSON.stringify(d.partidas)) mud.push(`partidas alteradas (${a.partidas?.length ?? 0} → ${d.partidas?.length ?? 0})`);
    return mud.join("; ") || "sem mudanças";
  }
  return "";
}

async function Detalhe({ params, searchParams }: PageProps<"/e/[id]/lancamentos/[lid]">) {
  await connection();
  const { id, lid } = await params;
  const { editar } = await searchParams;
  await getEmpresa(id);
  if (!z.uuid().safeParse(lid).success) notFound();
  const [l, log, user] = await Promise.all([getLancamento(id, lid), listarLog(lid), requireUser()]);
  if (!l) notFound();
  const base = `/e/${id}/lancamentos`;
  const editavel = l.origem === "manual" && l.status === "aprovado";
  const estornavel = l.status === "aprovado" && l.origem === "manual";
  const desfazerTx = l.origem === "conciliacao" && l.status === "aprovado" ? await transacaoDoLancamento(lid) : undefined;

  if (editar === "1" && editavel) {
    const contas = await listarContasAnaliticas(id);
    return (
      <>
        <PageHeader title={`Editar lançamento nº ${l.numero}`} description={l.historico} />
        <FormLancamento
          action={editarLancamentoManual.bind(null, id, lid)}
          contas={contas}
          inicial={l}
          voltar={`${base}/${lid}`}
        />
      </>
    );
  }

  const totalD = l.partidas.reduce((s, p) => s + cents(p.debito), 0);
  const totalC = l.partidas.reduce((s, p) => s + cents(p.credito), 0);
  const estornado = l.status === "estornado";

  return (
    <>
      <Link href={base} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Lançamentos
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            Lançamento nº {l.numero}
            <Badge variant={ORIGEM_BADGE[l.origem]}>{ORIGENS[l.origem]}</Badge>
            {estornado ? <Badge variant="muted" className="line-through">Estornado</Badge> : <Badge variant="success">Aprovado</Badge>}
          </span>
        }
        actions={
          <>
            {editavel && (
              <Link href={`${base}/${lid}?editar=1`} className={buttonVariants({ variant: "outline" })}>
                <Pencil />
                Editar
              </Link>
            )}
            {estornavel && <EstornarDialog empresaId={id} lancamentoId={lid} numero={l.numero} />}
            {desfazerTx && <DesfazerConciliacaoDialog empresaId={id} transacaoId={desfazerTx} numero={l.numero} />}
          </>
        }
      />

      <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border bg-card p-5 text-sm shadow-card md:grid-cols-4 [&_dd]:mt-1 [&_dd]:font-medium [&_dt]:text-xs [&_dt]:font-semibold [&_dt]:tracking-wider [&_dt]:text-muted-foreground [&_dt]:uppercase">
        <div><dt>Data</dt><dd>{fmtData(l.data)}</dd></div>
        <div><dt>Competência</dt><dd>{fmtCompetencia(l.competencia)}</dd></div>
        <div><dt>Data de pagamento</dt><dd>{l.dataPagamento ? fmtData(l.dataPagamento) : "-"}</dd></div>
        <div><dt>Documento</dt><dd>{l.documento ?? "-"}</dd></div>
        <div className="col-span-full"><dt>Histórico</dt><dd>{l.historico}</dd></div>
        {l.original && (
          <div className="col-span-full">
            <dt>Estorno de</dt>
            <dd><Link href={`${base}/${l.original.id}`} className="text-primary underline-offset-4 hover:underline">Lançamento {l.original.numero}</Link></dd>
          </div>
        )}
        {l.estorno && (
          <div className="col-span-full">
            <dt>Estornado por</dt>
            <dd><Link href={`${base}/${l.estorno.id}`} className="text-primary underline-offset-4 hover:underline">Lançamento {l.estorno.numero}</Link></dd>
          </div>
        )}
      </dl>

      <h2 className="mb-3 text-sm font-semibold">Partidas</h2>
      <TablePanel className="mb-8">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conta</TableHead>
              <TableHead className="w-40 text-right">Débito</TableHead>
              <TableHead className="w-40 text-right">Crédito</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {l.partidas.map((p, i) => (
              <TableRow key={i}>
                <TableCell>
                  <span className="mr-2 font-mono text-xs text-muted-foreground">{p.codigo}</span>
                  {p.nome}
                </TableCell>
                <TableCell className="text-right">{Number(p.debito) ? fmtValor(p.debito) : ""}</TableCell>
                <TableCell className="text-right">{Number(p.credito) ? fmtValor(p.credito) : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className="text-right">{fmtValor(fromCents(totalD))}</TableCell>
              <TableCell className="text-right">{fmtValor(fromCents(totalC))}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TablePanel>

      <h2 className="mb-3 text-sm font-semibold">Histórico de alterações</h2>
      {log.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem registros.</p>
      ) : (
        <TablePanel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Ação</TableHead>
                <TableHead className="w-56">Usuário</TableHead>
                <TableHead className="w-44">Data</TableHead>
                <TableHead>Resumo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {log.map((g) => (
                <TableRow key={g.id}>
                  <TableCell><Badge variant="muted">{ACOES_LOG[g.acao]}</Badge></TableCell>
                  <TableCell>
                    {!g.usuarioId ? "-" : g.usuarioId === user.id ? (user.email ?? "você") : g.usuarioId.slice(0, 8)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{g.createdAt.toLocaleString("pt-BR", { timeZone: TZ })}</TableCell>
                  <TableCell className="whitespace-normal">{resumo(g.acao, g.antes, g.depois)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TablePanel>
      )}
    </>
  );
}

export default function LancamentoPage(props: PageProps<"/e/[id]/lancamentos/[lid]">) {
  return (
    <Suspense fallback={<Carregando />}>
      <Detalhe {...props} />
    </Suspense>
  );
}
