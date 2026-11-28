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
import { db } from "@/db";
import { ORIGEM_BADGE, cents, fmtCompetencia, fmtData, fmtValor, fromCents, hoje } from "@/lib/format";
import { dataNoMesAberto, mesesFechados, type RetratoLancamento } from "@/lib/lancamentos";
import { requireUser } from "@/supabase/server";
import { getEmpresa } from "../../empresa";
import { FormLancamento } from "../form-lancamento";
import { ACOES_LOG, ORIGENS, cadeiaDoLancamento, getLancamento, listarContasAnaliticas, listarLog } from "../queries";
import { transacaoDoLancamento } from "../../conciliacao/queries";
import { DesfazerConciliacaoDialog, EstornarDialog } from "./estornar-dialog";

const TZ = "America/Sao_Paulo";
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
  const [l, log, user, cadeia] = await Promise.all([getLancamento(id, lid), listarLog(lid), requireUser(), cadeiaDoLancamento(id, lid)]);
  if (!l) notFound();
  const base = `/e/${id}/lancamentos`;
  const editavel = l.origem === "manual" && l.status === "aprovado";
  const estornavel = l.status === "aprovado" && l.origem === "manual";
  const desfazerTx = l.origem === "conciliacao" && l.status === "aprovado" ? await transacaoDoLancamento(lid) : undefined;
  let dataEstorno = hoje();
  if (estornavel) {
    try {
      dataEstorno = dataNoMesAberto(l.data, hoje(), await mesesFechados(db, id), "estornar");
    } catch {} // mês atual também fechado: fica hoje e a action explica que precisa reabrir
  }

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
            {l.origem === "abertura" && !estornado && (
              <Link href={`${base}/saldos-iniciais`} className={buttonVariants({ variant: "outline" })}>
                <Pencil />
                Alterar em Saldos iniciais
              </Link>
            )}
            {estornavel && <EstornarDialog empresaId={id} lancamentoId={lid} numero={l.numero} dataSugerida={dataEstorno} />}
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

      {cadeia.length > 0 && (
        <>
          <h2 className="mb-1 text-sm font-semibold">Cadeia de reclassificação</h2>
          <p className="mb-3 text-xs text-muted-foreground">Original, estornos e substitutos ligados a este lançamento, na ordem em que foram criados.</p>
          <TablePanel className="mb-8">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Nº</TableHead>
                  <TableHead className="w-36">Papel</TableHead>
                  <TableHead className="w-28">Movimento no banco</TableHead>
                  <TableHead className="w-28">Data contábil</TableHead>
                  <TableHead className="w-24">Competência</TableHead>
                  <TableHead className="w-40">Alterado em</TableHead>
                  <TableHead className="w-44">Usuário</TableHead>
                  <TableHead className="min-w-80">Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cadeia.map((c) => (
                  <TableRow key={c.id} className={c.id === lid ? "bg-accent/50" : undefined}>
                    <TableCell>
                      {c.id === lid ? <span className="font-semibold">{c.numero}</span> : (
                        <Link href={`${base}/${c.id}`} className="text-primary underline-offset-4 hover:underline">{c.numero}</Link>
                      )}
                      {c.status === "estornado" && <span className="ml-1 text-xs text-muted-foreground line-through">estornado</span>}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {c.estornoDe ? `Estorno do nº ${c.estornoDe}` : c.substitui ? `Substitui o nº ${c.substitui}` : "Original"}
                      {c.estornoDe && c.substitui ? ` (substitui o nº ${c.substitui})` : ""}
                    </TableCell>
                    <TableCell>{c.dataBanco ? fmtData(c.dataBanco) : "-"}</TableCell>
                    <TableCell>{fmtData(c.data)}</TableCell>
                    <TableCell>{fmtCompetencia(c.competencia)}</TableCell>
                    <TableCell className="text-muted-foreground">{c.createdAt.toLocaleString("pt-BR", { timeZone: TZ })}</TableCell>
                    <TableCell className="truncate">{c.usuario ?? "-"}</TableCell>
                    <TableCell className="whitespace-normal">
                      {c.motivo ?? "-"}
                      {c.loteId && <span className="ml-1 font-mono text-xs text-muted-foreground">lote {c.loteId.slice(0, 8)}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TablePanel>
        </>
      )}

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
                    {!g.usuarioId ? "-" : g.usuarioId === user.id ? (user.email ?? "você") : (g.email ?? g.usuarioId.slice(0, 8))}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{g.createdAt.toLocaleString("pt-BR", { timeZone: TZ })}</TableCell>
                  <TableCell className="whitespace-normal">
                    {resumo(g.acao, g.antes, g.depois)}
                    {g.motivo && <span className="block text-xs text-muted-foreground">Motivo: {g.motivo}{g.loteId && ` (lote ${g.loteId.slice(0, 8)})`}</span>}
                  </TableCell>
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
