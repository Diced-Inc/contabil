import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil, Undo2 } from "lucide-react";
import { z } from "zod";
import { editarLancamentoManual } from "@/actions/lancamentos";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cents, fmtCompetencia, fmtData, fmtValor, fromCents } from "@/lib/format";
import type { RetratoLancamento } from "@/lib/lancamentos";
import { requireUser } from "@/supabase/server";
import { getEmpresa } from "../../empresa";
import { FormLancamento } from "../form-lancamento";
import { ACOES_LOG, ORIGENS, getLancamento, listarContasAnaliticas, listarLog } from "../queries";
import { EstornarDialog } from "./estornar-dialog";

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
  const { id, lid } = await params;
  const { editar } = await searchParams;
  await getEmpresa(id);
  if (!z.uuid().safeParse(lid).success) notFound();
  const [l, log, user] = await Promise.all([getLancamento(id, lid), listarLog(lid), requireUser()]);
  if (!l) notFound();
  const base = `/e/${id}/lancamentos`;
  const editavel = l.origem === "manual" && l.status === "aprovado";
  const estornavel = l.status === "aprovado" && l.origem === "manual";

  if (editar === "1" && editavel) {
    const contas = await listarContasAnaliticas(id);
    return (
      <>
        <h1 className="mb-4 text-2xl font-semibold">Editar lançamento {l.numero}</h1>
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

  return (
    <>
      <Link href={base} className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3" />
        Lançamentos
      </Link>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">Lançamento {l.numero}</h1>
        <Badge variant="secondary">{ORIGENS[l.origem]}</Badge>
        <Badge variant={l.status === "estornado" ? "destructive" : "outline"}>
          {l.status === "estornado" ? "Estornado" : "Aprovado"}
        </Badge>
        <div className="ml-auto flex gap-2">
          {editavel && (
            <Link href={`${base}/${lid}?editar=1`} className={buttonVariants({ variant: "outline" })}>
              <Pencil />
              Editar
            </Link>
          )}
          {estornavel && <EstornarDialog empresaId={id} lancamentoId={lid} numero={l.numero} />}
          {l.origem === "conciliacao" && l.status === "aprovado" && (
            <span title="disponível na conciliação">
              <Button variant="outline" disabled>
                <Undo2 />
                Desfazer conciliação
              </Button>
            </span>
          )}
        </div>
      </div>

      <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
        <div><dt className="text-xs text-muted-foreground">Data</dt><dd>{fmtData(l.data)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Competência</dt><dd>{fmtCompetencia(l.competencia)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Data de pagamento</dt><dd>{l.dataPagamento ? fmtData(l.dataPagamento) : "-"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Documento</dt><dd>{l.documento ?? "-"}</dd></div>
        <div className="col-span-full"><dt className="text-xs text-muted-foreground">Histórico</dt><dd>{l.historico}</dd></div>
        {l.original && (
          <div className="col-span-full">
            <dt className="text-xs text-muted-foreground">Estorno de</dt>
            <dd><Link href={`${base}/${l.original.id}`} className="underline underline-offset-4">Lançamento {l.original.numero}</Link></dd>
          </div>
        )}
        {l.estorno && (
          <div className="col-span-full">
            <dt className="text-xs text-muted-foreground">Estornado por</dt>
            <dd><Link href={`${base}/${l.estorno.id}`} className="underline underline-offset-4">Lançamento {l.estorno.numero}</Link></dd>
          </div>
        )}
      </dl>

      <Table className="mb-8 text-sm">
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
              <TableCell className="py-1.5">
                <span className="tabular-nums text-muted-foreground">{p.codigo}</span> {p.nome}
              </TableCell>
              <TableCell className="py-1.5 text-right tabular-nums">{Number(p.debito) ? fmtValor(p.debito) : ""}</TableCell>
              <TableCell className="py-1.5 text-right tabular-nums">{Number(p.credito) ? fmtValor(p.credito) : ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Total</TableCell>
            <TableCell className="text-right tabular-nums">{fmtValor(fromCents(totalD))}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtValor(fromCents(totalC))}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>

      <h2 className="mb-2 text-lg font-semibold">Histórico de alterações</h2>
      {log.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem registros.</p>
      ) : (
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Ação</TableHead>
              <TableHead className="w-48">Usuário</TableHead>
              <TableHead className="w-40">Data</TableHead>
              <TableHead>Resumo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {log.map((g) => (
              <TableRow key={g.id}>
                <TableCell className="py-1.5">{ACOES_LOG[g.acao]}</TableCell>
                <TableCell className="py-1.5">
                  {!g.usuarioId ? "-" : g.usuarioId === user.id ? (user.email ?? "você") : g.usuarioId.slice(0, 8)}
                </TableCell>
                <TableCell className="py-1.5">{g.createdAt.toLocaleString("pt-BR", { timeZone: TZ })}</TableCell>
                <TableCell className="py-1.5 whitespace-normal">{resumo(g.acao, g.antes, g.depois)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

export default function LancamentoPage(props: PageProps<"/e/[id]/lancamentos/[lid]">) {
  return (
    <div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
        <Detalhe {...props} />
      </Suspense>
    </div>
  );
}
