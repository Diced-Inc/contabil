import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { FileUp, Receipt } from "lucide-react";
import { cn } from "cn";
import { db } from "@/db";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Carregando, EmptyState, PageHeader, TablePanel } from "@/components/page-header";
import { cents, fmtData, fmtValor } from "@/lib/format";
import { contrapartidasLembradas } from "@/lib/notas/registro";
import { contasDeContrapartida } from "@/lib/operacoes";
import type { TipoTitulo } from "@/lib/titulos";
import { listarMesesFechados, listarTitulosAbertos } from "../conciliacao/queries";
import { getEmpresa } from "../empresa";
import { listarContasAnaliticas } from "../lancamentos/queries";
import { NotaDialog } from "./nota-dialog";
import { Parcelamentos } from "./parcelamentos";
import { listarCompensacoes, listarParcelamentos, listarTitulos, type TituloLinha } from "./queries";
import { CancelarTituloDialog, TituloDialog } from "./titulo-dialog";
import { AdiantamentosLista, CompensarDialog, type AdiantamentoView } from "./adiantamentos";
import { adiantamentosDoTitulo } from "@/lib/adiantamentos";
import { listarAdiantamentos } from "@/lib/adiantamentos-registro";

type Aba = TipoTitulo | "parcelamentos" | "adiantamentos";
const ABAS: Record<Aba, string> = { receber: "A receber", pagar: "A pagar", parcelamentos: "Parcelamentos", adiantamentos: "Adiantamentos" };
const STATUS = {
  aberto: <Badge variant="warning">Aberto</Badge>,
  parcial: <Badge variant="info">Parcial</Badge>,
  quitado: <Badge variant="success">Quitado</Badge>,
  cancelado: <Badge variant="muted" className="line-through">Cancelado</Badge>,
} as const;
const ORIGEM = { manual: "Manual", nfe: "NF-e", nfse: "NFS-e", guia: "Guia", parcelamento: "Parcela" } as const;
/** Só os títulos de documento cancelam aqui; guia e parcela seguem o fluxo deles. */
const CANCELA_AQUI = new Set<TituloLinha["origem"]>(["manual", "nfe", "nfse"]);

async function Titulos({ params, searchParams }: PageProps<"/e/[id]/titulos">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const aba: Aba = sp.tipo === "pagar" || sp.tipo === "parcelamentos" || sp.tipo === "adiantamentos" ? sp.tipo : "receber";
  const tipo: TipoTitulo = aba === "pagar" ? "pagar" : "receber";
  const empresa = await getEmpresa(id);
  const porTitulo = aba === "receber" || aba === "pagar";
  const [lista, todas, fechados, lembradas, parcelamentos, abertos, ads, compensacoes] = await Promise.all([
    porTitulo ? listarTitulos(id, tipo) : Promise.resolve([]), listarContasAnaliticas(id), listarMesesFechados(id),
    contrapartidasLembradas(db, id), aba === "parcelamentos" ? listarParcelamentos(id) : Promise.resolve([]),
    aba === "parcelamentos" ? listarTitulosAbertos(id) : Promise.resolve([]),
    listarAdiantamentos(db, id), aba === "adiantamentos" ? listarCompensacoes(id) : Promise.resolve([]),
  ]);
  const adiantamentos: AdiantamentoView[] = ads.map((a) => ({
    id: a.id, tipo: a.tipo, contraparte: a.contraparte, contraparteDocumento: a.contraparteDocumento, valor: a.valor, data: a.data,
    contaId: a.contaId, lancamentoId: a.lancamentoId, saldo: a.saldo,
  }));
  const obrigacoes = abertos.filter((t) => t.imposto).map((t) => ({ id: t.id, descricao: t.descricao, contaId: t.contaId, saldo: t.saldo, vencimento: t.vencimento }));
  const contas = contasDeContrapartida(todas, tipo);
  const lanc = (lid: string | null, numero: number | null) =>
    lid && (
      <Link href={`/e/${id}/lancamentos/${lid}`} className="font-medium text-primary underline-offset-4 hover:underline">
        nº {numero}
      </Link>
    );
  const acoes = (
    <>
      <Link href={`/e/${id}/titulos/importar`} className={buttonVariants({ variant: "outline" })}>
        <FileUp />
        Importar XML
      </Link>
      <NotaDialog empresaId={id} cnpj={empresa.cnpj} contas={todas} fechados={fechados} lembradas={lembradas} tipoInicial={tipo} />
      {porTitulo && <TituloDialog key={tipo} empresaId={id} tipo={tipo} contas={contas} />}
    </>
  );

  return (
    <>
      <PageHeader title="Títulos" description={DESCRICAO} actions={acoes} />
      <div className="mb-4">
        <nav className="inline-flex rounded-lg border bg-muted p-[3px] text-sm">
          {(Object.keys(ABAS) as Aba[]).map((t) => (
            <Link
              key={t}
              href={`/e/${id}/titulos?tipo=${t}`}
              className={cn(
                "inline-flex h-8 items-center rounded-md px-3 font-medium text-muted-foreground transition-colors hover:text-foreground",
                t === aba && "bg-card text-foreground shadow-xs",
              )}
            >
              {ABAS[t]}
            </Link>
          ))}
        </nav>
      </div>
      {aba === "adiantamentos" ? (
        <AdiantamentosLista empresaId={id} adiantamentos={adiantamentos} compensacoes={compensacoes} />
      ) : aba === "parcelamentos" ? (
        <Parcelamentos empresaId={id} lista={parcelamentos} contas={todas} fechados={fechados} obrigacoes={obrigacoes} />
      ) : lista.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={`Nenhum título ${ABAS[aba].toLowerCase()}`}
          hint="Importe o XML das notas, cadastre a nota manualmente ou anexe a guia no Fechamento. A baixa acontece na conciliação."
          action={<TituloDialog key={`vazio-${tipo}`} empresaId={id} tipo={tipo} contas={contas} />}
        />
      ) : (
        <TablePanel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contraparte</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Competência</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Em aberto</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Lançamentos</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((t) => (
                <TableRow key={t.id} className={cn(t.status === "cancelado" && "text-muted-foreground")}>
                  <TableCell className="font-medium">
                    {t.contraparte}
                    {t.contraparteDocumento && <span className="block text-xs font-normal text-muted-foreground tabular-nums">{t.contraparteDocumento}</span>}
                  </TableCell>
                  <TableCell className="max-w-64">
                    <span className="block truncate">{t.descricao}</span>
                    {t.contaCodigo && <span className="block truncate text-xs text-muted-foreground" title={t.contaNome ?? ""}>{t.contaCodigo} {t.contaNome}</span>}
                  </TableCell>
                  <TableCell><Badge variant="muted">{ORIGEM[t.origem]}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{fmtData(t.competencia)}</TableCell>
                  <TableCell>{t.vencimento && fmtData(t.vencimento)}</TableCell>
                  <TableCell className="text-right font-medium">{fmtValor(t.valor)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t.status !== "cancelado" && fmtValor(Number(t.valor) - Number(t.baixado))}
                  </TableCell>
                  <TableCell>{STATUS[t.status]}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-x-2 text-sm">
                      {lanc(t.lancamentoId, t.lancamentoNumero)}
                      {t.baixas.map((b) => (
                        <span key={b.lancamentoId} title={`Baixa de R$ ${fmtValor(b.valor)}`} className="text-muted-foreground">
                          baixa {lanc(b.lancamentoId, b.numero)}
                        </span>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1">
                      {(t.status === "aberto" || t.status === "parcial") && (() => {
                        const doTitulo = adiantamentosDoTitulo({ tipo, contraparte: t.contraparte, contraparteDocumento: t.contraparteDocumento }, adiantamentos);
                        return doTitulo.length > 0 && (
                          <CompensarDialog empresaId={id} adiantamentos={doTitulo} contas={todas} fechados={fechados} titulo={{
                            id: t.id, tipo, contraparte: t.contraparte, descricao: t.descricao, competencia: t.competencia,
                            saldo: cents(t.valor) - cents(t.baixado), contaId: t.contaId,
                          }} />
                        );
                      })()}
                      {t.status === "aberto" && CANCELA_AQUI.has(t.origem) && <CancelarTituloDialog empresaId={id} titulo={t} />}
                    </span>
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

const DESCRICAO = "Contas a receber e a pagar: notas fiscais, guias de imposto e parcelamentos. A baixa é feita na conciliação, ao casar com a transação do extrato.";

export default function TitulosPage(props: PageProps<"/e/[id]/titulos">) {
  return (
    <Suspense fallback={<><PageHeader title="Títulos" description={DESCRICAO} /><Carregando /></>}>
      <Titulos {...props} />
    </Suspense>
  );
}
