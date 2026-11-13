import { Suspense } from "react";
import { connection } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { CheckCircle2, FileText, Inbox, MessageSquareText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Carregando, EmptyState, PageHeader, TablePanel } from "@/components/page-header";
import { Baixar } from "@/components/baixar";
import { db } from "@/db";
import { ciclosMensais, contasBancarias, documentosRecebidos } from "@/db/schema";
import { extensao, fmtTamanho, STATUS_CICLO, tituloCompetencia } from "@/lib/ciclo";
import { getEmpresa } from "../empresa";
import { DocumentoAcoes } from "./documento-acoes";

// "Importar" roda as mesmas actions de Bancos, inclusive a extração de PDF por IA.
export const maxDuration = 300;

const TZ = "America/Sao_Paulo";
const DESCRICAO = "Arquivos que o cliente enviou pelo portal. Importe com o fluxo de sempre ou marque como processado.";
const quando = (d: Date) =>
  d.toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

async function Documentos({ params }: PageProps<"/e/[id]/documentos">) {
  await connection();
  const { id } = await params;
  await getEmpresa(id);
  const [docs, contas] = await Promise.all([
    db
      .select({
        id: documentosRecebidos.id,
        nome: documentosRecebidos.nomeArquivo,
        tamanho: documentosRecebidos.tamanho,
        observacao: documentosRecebidos.observacao,
        createdAt: documentosRecebidos.createdAt,
        processadoEm: documentosRecebidos.processadoEm,
        importacaoId: documentosRecebidos.importacaoId,
        contaId: documentosRecebidos.contaBancariaId,
        conta: contasBancarias.nome,
        competencia: ciclosMensais.competencia,
        statusCiclo: ciclosMensais.status,
        enviadoPor: sql<string | null>`(select coalesce(u.raw_user_meta_data->>'display_name', u.email) from auth.users u where u.id = ${documentosRecebidos.enviadoPor})`,
      })
      .from(documentosRecebidos)
      .innerJoin(ciclosMensais, eq(ciclosMensais.id, documentosRecebidos.cicloId))
      .leftJoin(contasBancarias, eq(contasBancarias.id, documentosRecebidos.contaBancariaId))
      .where(eq(documentosRecebidos.empresaId, id))
      .orderBy(desc(ciclosMensais.competencia), desc(documentosRecebidos.createdAt)),
    db
      .select({ id: contasBancarias.id, nome: contasBancarias.nome, numero: contasBancarias.numero })
      .from(contasBancarias)
      .where(and(eq(contasBancarias.empresaId, id), eq(contasBancarias.ativa, true))),
  ]);

  const grupos = Map.groupBy(docs, (d) => d.competencia);

  return (
    <>
      <PageHeader title="Documentos" description={DESCRICAO} />
      {docs.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nenhum documento recebido"
          hint="Quando o cliente enviar os extratos pelo portal, eles aparecem aqui para você importar."
        />
      ) : (
        <div className="grid gap-6">
          {[...grupos].map(([competencia, lista]) => {
            const novos = lista.filter((d) => !d.processadoEm).length;
            const st = STATUS_CICLO[lista[0].statusCiclo];
            return (
              <section key={competencia}>
                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold">{tituloCompetencia(competencia)}</h2>
                  <Badge variant={st.badge}>{st.rotulo}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {lista.length} {lista.length === 1 ? "arquivo" : "arquivos"}
                    {novos > 0 && <> · {novos} {novos === 1 ? "novo" : "novos"}</>}
                  </span>
                </div>
                <TablePanel>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-5">Arquivo</TableHead>
                        <TableHead>Banco</TableHead>
                        <TableHead>Enviado por</TableHead>
                        <TableHead>Enviado em</TableHead>
                        <TableHead>Situação</TableHead>
                        <TableHead className="w-0" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lista.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="max-w-80 pl-5 whitespace-normal">
                            <div className="flex items-start gap-3">
                              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                <FileText className="size-4" />
                              </span>
                              <div className="min-w-0">
                                <div className="truncate font-medium text-foreground" title={d.nome}>{d.nome}</div>
                                <div className="text-xs text-muted-foreground uppercase">
                                  {extensao(d.nome)} · {fmtTamanho(d.tamanho)}
                                </div>
                                {d.observacao && (
                                  <p className="mt-1.5 flex gap-1.5 text-xs text-foreground/80">
                                    <MessageSquareText className="mt-px size-3.5 shrink-0 text-muted-foreground" />
                                    {d.observacao}
                                  </p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{d.conta ?? "Não informado"}</TableCell>
                          <TableCell className="text-muted-foreground">{d.enviadoPor ?? "-"}</TableCell>
                          <TableCell className="text-muted-foreground tabular-nums">{quando(d.createdAt)}</TableCell>
                          <TableCell>
                            {d.processadoEm ? (
                              <Badge variant="success" title={`Processado em ${quando(d.processadoEm)}`}>
                                <CheckCircle2 />
                                {d.importacaoId ? "Importado" : "Processado"}
                              </Badge>
                            ) : (
                              <Badge variant="info">Novo</Badge>
                            )}
                          </TableCell>
                          <TableCell className="pr-3">
                            <div className="flex justify-end gap-1.5">
                              <Baixar empresaId={id} documentoId={d.id} size="icon-sm" variant="ghost" />
                              <DocumentoAcoes
                                empresaId={id}
                                documento={{ id: d.id, nome: d.nome, contaId: d.contaId, processado: !!d.processadoEm }}
                                contas={contas}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TablePanel>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function DocumentosPage(props: PageProps<"/e/[id]/documentos">) {
  return (
    <Suspense fallback={<><PageHeader title="Documentos" description={DESCRICAO} /><Carregando /></>}>
      <Documentos {...props} />
    </Suspense>
  );
}
