import { Suspense } from "react";
import { connection } from "next/server";
import { and, asc, desc, eq, lt } from "drizzle-orm";
import { CalendarClock, Check, FileText, MessageCircle, MessageSquareText, Receipt } from "lucide-react";
import { cn } from "cn";
import { Avatar } from "@/components/avatar";
import { Baixar } from "@/components/baixar";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { garantirCiclo } from "@/db/ciclos";
import { ciclosMensais, contasBancarias, documentosRecebidos } from "@/db/schema";
import {
  competenciaAtual, fmtTamanho, MOTIVOS_ENCERRAMENTO, nomeCompetencia, ORDEM_STATUS, tituloCompetencia, passou, situacaoDas, STATUS_CICLO,
  textoSituacaoDas, type StatusCiclo,
} from "@/lib/ciclo";
import { fmtCnpj, fmtData, fmtValor, hoje, PORTES, REGIMES } from "@/lib/format";
import { logoDaEmpresa, perfilDoUsuario } from "@/supabase/server";
import { getEmpresaPortal } from "../dados";
import { Rodape, Topo } from "../topo";
import { EnvioExtratos, JaEnviei, JaPaguei } from "./ciclo-cliente";

const TZ = "America/Sao_Paulo";
const PASSOS = ["Enviar extratos", "Recebido", "Em processamento", "DAS disponível", "Pago"];
const quando = (d: Date) => d.toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const diaSP = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: TZ });

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

/** Os 5 passos do mês; o atual em destaque. das_pago e encerrado (último em ORDEM_STATUS) completam todos. */
function Progresso({ status }: { status: StatusCiclo }) {
  const atual = ORDEM_STATUS.indexOf(status);
  return (
    <ol className="grid grid-cols-5 gap-1">
      {PASSOS.map((rotulo, i) => {
        const feito = i < atual || status === "das_pago";
        const agora = i === atual && !feito;
        return (
          <li key={rotulo} className="grid justify-items-center gap-2 text-center">
            <div className="relative flex w-full items-center justify-center">
              {i > 0 && <span aria-hidden className={cn("absolute right-1/2 h-0.5 w-full", i <= atual ? "bg-primary" : "bg-border")} />}
              <span
                className={cn(
                  "relative z-10 flex size-8 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                  feito && "bg-primary text-primary-foreground",
                  agora && "bg-card text-primary ring-2 ring-primary ring-offset-2 ring-offset-card",
                  !feito && !agora && "bg-muted text-muted-foreground",
                )}
              >
                {feito ? <Check className="size-4" /> : i + 1}
              </span>
            </div>
            <span className={cn("text-xs leading-tight", agora ? "font-semibold text-foreground" : "text-muted-foreground")}>{rotulo}</span>
          </li>
        );
      })}
    </ol>
  );
}

async function Conteudo({ params }: PageProps<"/portal/[empresaId]">) {
  await connection();
  const { empresaId } = await params;
  const { user, empresa } = await getEmpresaPortal(empresaId);
  const hj = hoje();
  const competencia = competenciaAtual(hj);
  const ciclo = await garantirCiclo(empresaId, competencia);
  const [perfil, logoUrl, docs, contas, historico] = await Promise.all([
    perfilDoUsuario(user),
    logoDaEmpresa(empresa),
    db
      .select({
        id: documentosRecebidos.id,
        nome: documentosRecebidos.nomeArquivo,
        tamanho: documentosRecebidos.tamanho,
        createdAt: documentosRecebidos.createdAt,
        observacao: documentosRecebidos.observacao,
        conta: contasBancarias.nome,
      })
      .from(documentosRecebidos)
      .leftJoin(contasBancarias, eq(contasBancarias.id, documentosRecebidos.contaBancariaId))
      .where(eq(documentosRecebidos.cicloId, ciclo.id))
      .orderBy(desc(documentosRecebidos.createdAt)),
    db
      .select({ id: contasBancarias.id, nome: contasBancarias.nome })
      .from(contasBancarias)
      .where(and(eq(contasBancarias.empresaId, empresaId), eq(contasBancarias.ativa, true)))
      .orderBy(asc(contasBancarias.nome)),
    db
      .select()
      .from(ciclosMensais)
      .where(and(eq(ciclosMensais.empresaId, empresaId), lt(ciclosMensais.competencia, competencia)))
      .orderBy(desc(ciclosMensais.competencia))
      .limit(24),
  ]);
  const primeiroNome = perfil.nome.split(/\s+/)[0];
  const local = [empresa.cidade, empresa.uf].filter(Boolean).join("/");
  const mes = nomeCompetencia(competencia);
  const temDas = passou(ciclo.status, "das_enviado") && ciclo.status !== "encerrado" && ciclo.dasValor && ciclo.dasVencimento;
  // Data de recebimento sem arquivo = avisou que mandou por outro canal (só avisarExtratoPorFora grava assim).
  const porFora = ciclo.extratoRecebidoEm && (docs.length === 0 || ciclo.clienteObs) ? ciclo.extratoRecebidoEm : null;
  const situacao = situacaoDas(ciclo, hj);

  return (
    <>
      <Topo empresa={{ id: empresa.id, nome: empresa.razaoSocial, logoUrl }} usuario={{ ...perfil, email: user.email ?? "" }} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <section className="relative overflow-hidden rounded-2xl bg-primary px-6 py-7 text-primary-foreground shadow-card sm:px-8">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:32px_32px]"
          />
          <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-white/10 blur-3xl" />
          <div className="relative flex flex-wrap items-center gap-5">
            <Avatar
              url={logoUrl}
              texto={empresa.razaoSocial}
              className="size-16 rounded-2xl bg-white text-2xl text-primary shadow-sm ring-1 ring-white/30"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white/75">{primeiroNome ? `Olá, ${primeiroNome}` : "Olá"}. Este é o portal da sua empresa.</p>
              <h1 className="mt-1 text-2xl leading-tight font-semibold tracking-tight text-balance">{empresa.razaoSocial}</h1>
              <p className="mt-1.5 text-sm text-white/75 tabular-nums">
                CNPJ {fmtCnpj(empresa.cnpj)}
                {local && <> · {local}</>}
              </p>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="grid content-start gap-6">
            <Card>
              <CardHeader className="border-b">
                <CardDescription>Competência atual</CardDescription>
                <CardTitle className="text-lg">{tituloCompetencia(competencia)}</CardTitle>
                <CardAction>
                  <Badge variant={STATUS_CICLO[ciclo.status].badge}>{STATUS_CICLO[ciclo.status].rotulo}</Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="grid gap-5">
                <div className="grid gap-1">
                  <p className="text-sm text-foreground">{STATUS_CICLO[ciclo.status].cliente}</p>
                  {ciclo.status === "encerrado" && ciclo.encerradoMotivo && (
                    <p className="text-sm text-muted-foreground">{MOTIVOS_ENCERRAMENTO[ciclo.encerradoMotivo].cliente}</p>
                  )}
                </div>
                <Progresso status={ciclo.status} />
                {porFora && (
                  <p className="flex gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-foreground">
                    <MessageCircle className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>
                      Você avisou em {diaSP(porFora).slice(0, 5)} que enviou por outro canal.
                      {ciclo.clienteObs && <span className="block text-muted-foreground">&ldquo;{ciclo.clienteObs}&rdquo;</span>}
                    </span>
                  </p>
                )}
                {ciclo.status === "aguardando_extrato" && <JaEnviei empresaId={empresaId} />}
              </CardContent>
            </Card>

            {temDas && (
              <Card className={cn(situacao?.tipo === "vencido" && "border-danger/30", situacao?.tipo === "pago" && "border-success/25")}>
                <CardHeader className="border-b">
                  <CardTitle className="flex items-center gap-2.5">
                    <span className="flex size-8 items-center justify-center rounded-full bg-accent text-primary">
                      <Receipt className="size-4" />
                    </span>
                    DAS de {mes}
                  </CardTitle>
                  <CardAction>
                    {situacao && (
                      <Badge variant={situacao.tipo === "pago" ? "success" : situacao.tipo === "vencido" ? "danger" : "warning"}>
                        {situacao.tipo === "vencido" ? "Vencido" : textoSituacaoDas(situacao)}
                      </Badge>
                    )}
                  </CardAction>
                </CardHeader>
                <CardContent className="grid gap-5">
                  <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Valor</p>
                      <p className="text-3xl font-semibold tracking-tight tabular-nums">R$ {fmtValor(ciclo.dasValor!)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Vencimento</p>
                      <p className="flex items-center gap-1.5 text-lg font-semibold tabular-nums">
                        <CalendarClock className="size-4 text-muted-foreground" />
                        {fmtData(ciclo.dasVencimento!)}
                      </p>
                      {situacao && situacao.tipo !== "pago" && (
                        <p className={cn("text-sm", situacao.tipo === "vencido" ? "font-semibold text-danger" : "text-muted-foreground")}>
                          {textoSituacaoDas(situacao)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Baixar empresaId={empresaId} competencia={competencia} rotulo="Baixar guia" size="default" variant={ciclo.status === "das_pago" ? "outline" : "default"} />
                    {ciclo.status === "das_enviado" && <JaPaguei empresaId={empresaId} competencia={competencia} />}
                    {ciclo.dasPagoEm && (
                      <span className="flex items-center gap-1.5 text-sm font-medium text-success">
                        <Check className="size-4" />
                        Pago, informado em {diaSP(ciclo.dasPagoEm)}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {!passou(ciclo.status, "das_enviado") && (
              <Card>
                <CardHeader className="border-b">
                  <CardTitle>Enviar extratos de {mes}</CardTitle>
                  <CardDescription>Envie os extratos de todas as contas da empresa referentes ao mês inteiro.</CardDescription>
                </CardHeader>
                <CardContent>
                  <EnvioExtratos empresaId={empresaId} contas={contas} />
                </CardContent>
              </Card>
            )}

            {docs.length > 0 && (
              <Card>
                <CardHeader className="border-b">
                  <CardTitle>Arquivos enviados</CardTitle>
                  <CardDescription>
                    {docs.length} {docs.length === 1 ? "arquivo" : "arquivos"} de {mes}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="grid gap-2">
                    {docs.map((d) => (
                      <li key={d.id} className="flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm">
                        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{d.nome}</p>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {quando(d.createdAt)} · {fmtTamanho(d.tamanho)}
                            {d.conta && <> · {d.conta}</>}
                          </p>
                          {d.observacao && (
                            <p className="mt-1 flex gap-1.5 text-xs text-foreground/80">
                              <MessageSquareText className="mt-px size-3.5 shrink-0 text-muted-foreground" />
                              {d.observacao}
                            </p>
                          )}
                        </div>
                        <Baixar empresaId={empresaId} documentoId={d.id} size="icon-sm" variant="ghost" />
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="grid content-start gap-6">
            {empresa.contadorNome && (
              <Card>
                <CardHeader>
                  <CardDescription>Seu contador</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-3">
                  <Avatar url={null} texto={empresa.contadorNome} className="size-11 text-base" />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{empresa.contadorNome}</p>
                    {empresa.contadorCrc && <p className="text-xs text-muted-foreground">CRC {empresa.contadorCrc}</p>}
                  </div>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader className="border-b">
                <CardTitle>Dados da empresa</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4">
                  <Dado rotulo="Regime tributário">{REGIMES[empresa.regimeTributario]}</Dado>
                  {empresa.porte && <Dado rotulo="Porte">{PORTES[empresa.porte]}</Dado>}
                  {empresa.responsavelNome && <Dado rotulo="Responsável legal">{empresa.responsavelNome}</Dado>}
                  {local && <Dado rotulo="Cidade">{local}</Dado>}
                </dl>
              </CardContent>
            </Card>
          </div>
        </div>

        {historico.length > 0 && (
          <Card className="mt-6 gap-0 pb-0">
            <CardHeader className="border-b">
              <CardTitle>Meses anteriores</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Competência</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">DAS</TableHead>
                  <TableHead>Pago em</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {historico.map((c) => {
                  const s = situacaoDas(c, hj);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="pl-6 font-medium">{tituloCompetencia(c.competencia)}</TableCell>
                      <TableCell>
                        {s?.tipo === "vencido" ? (
                          <Badge variant="danger">DAS vencido</Badge>
                        ) : (
                          <Badge variant={STATUS_CICLO[c.status].badge}>{STATUS_CICLO[c.status].rotulo}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.dasValor ? `R$ ${fmtValor(c.dasValor)}` : "-"}</TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">{c.dasPagoEm ? diaSP(c.dasPagoEm) : "-"}</TableCell>
                      <TableCell className="pr-4">
                        <div className="flex justify-end gap-1.5">
                          {c.dasPath && <Baixar empresaId={empresaId} competencia={c.competencia} rotulo="Guia" size="sm" variant="ghost" />}
                          {c.status === "das_enviado" && <JaPaguei empresaId={empresaId} competencia={c.competencia} />}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </main>
      <Rodape />
    </>
  );
}

export default function PortalEmpresaPage(props: PageProps<"/portal/[empresaId]">) {
  return (
    <Suspense fallback={<div className="h-16 border-b bg-card" />}>
      <Conteudo {...props} />
    </Suspense>
  );
}
