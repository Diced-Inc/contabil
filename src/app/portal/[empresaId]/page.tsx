import { Suspense } from "react";
import { connection } from "next/server";
import { and, asc, desc, eq, lt } from "drizzle-orm";
import { CalendarClock, Check, CheckCircle2, FileText, MessageCircle, MessageSquareText, Receipt } from "lucide-react";
import { cn } from "cn";
import { Avatar } from "@/components/avatar";
import { Baixar } from "@/components/baixar";
import { ProgressoCiclo } from "@/components/progresso-ciclo";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { garantirCiclo, listarGuias } from "@/db/ciclos";
import { ciclosMensais, contasBancarias, documentosRecebidos, type Guia } from "@/db/schema";
import {
  competenciaAtual, fmtTamanho, MOTIVOS_ENCERRAMENTO, nomeCompetencia, tituloCompetencia, passou, STATUS_CICLO,
} from "@/lib/ciclo";
import { fmtCnpj, fmtData, fmtValor, hoje, PORTES, REGIMES } from "@/lib/format";
import { guiasEsperadas, listaTipos, resumoGuias, rotuloGuia, situacaoGuia, textoSituacao } from "@/lib/guias";
import { logoDaEmpresa, perfilDoUsuario } from "@/supabase/server";
import { avatarDoCliente, getEmpresaPortal } from "../dados";
import { Rodape, Topo } from "../topo";
import { EnviarMais, EnvioExtratos, JaEnviei, JaPaguei } from "./ciclo-cliente";

const TZ = "America/Sao_Paulo";
const quando = (d: Date) => d.toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const diaSP = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: TZ });

type Doc = { id: string; nome: string; tamanho: number; createdAt: Date; observacao: string | null; conta: string | null };

function ListaArquivos({ empresaId, docs }: { empresaId: string; docs: Doc[] }) {
  return (
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
  );
}

function NotaPorFora({ em, obs }: { em: Date; obs: string | null }) {
  return (
    <p className="flex gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-foreground">
      <MessageCircle className="mt-0.5 size-4 shrink-0 text-primary" />
      <span>
        Você avisou em {diaSP(em).slice(0, 5)} que enviou por outro canal.
        {obs && <span className="block text-muted-foreground">&ldquo;{obs}&rdquo;</span>}
      </span>
    </p>
  );
}

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

/**
 * Guias enviadas de um mês: cada uma com valor, vencimento, dias que faltam (ou vencida), Baixar e Já paguei; total no rodapé.
 * `pagavel` = o mês está com guias em aberto (das_enviado).
 */
function GuiasCard({ empresaId, titulo, guias, hj, pagavel }: { empresaId: string; titulo: string; guias: Guia[]; hj: string; pagavel: boolean }) {
  const r = resumoGuias(guias, hj);
  const cor = r.vencidas ? "border-danger/30" : r.pagas === r.qtd ? "border-success/25" : "";
  return (
    <Card className={cn("gap-0 pb-0", cor)}>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-accent text-primary">
            <Receipt className="size-4" />
          </span>
          {titulo}
        </CardTitle>
        <CardAction>
          <Badge variant={r.vencidas ? "danger" : r.pagas === r.qtd ? "success" : "warning"}>
            {r.pagas === r.qtd
              ? r.qtd === 1 ? "Paga" : "Todas pagas"
              : r.vencidas
                ? r.vencidas === 1 ? "1 vencida" : `${r.vencidas} vencidas`
                : r.abertas === 1 ? "1 em aberto" : `${r.abertas} em aberto`}
          </Badge>
        </CardAction>
      </CardHeader>
      <ul className="divide-y">
        {guias.map((g) => {
          const s = situacaoGuia(g, hj);
          return (
            <li key={g.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
              <div className="min-w-40 flex-1">
                <p className="text-sm font-medium text-foreground">{rotuloGuia(g)}</p>
                <p className="font-display text-2xl font-semibold tracking-[-0.02em] tabular-nums">R$ {fmtValor(g.valor)}</p>
              </div>
              <div className="min-w-32">
                <p className="text-xs text-muted-foreground">Vencimento</p>
                <p className="flex items-center gap-1.5 font-semibold tabular-nums">
                  <CalendarClock className="size-4 text-muted-foreground" />
                  {fmtData(g.vencimento)}
                </p>
                {s.tipo !== "paga" && (
                  <p className={cn("text-sm", s.tipo === "vencida" ? "font-semibold text-danger" : "text-muted-foreground")}>{textoSituacao(s)}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Baixar empresaId={empresaId} guiaId={g.id} rotulo="Baixar" size="default" />
                {!g.pagoEm && pagavel && <JaPaguei empresaId={empresaId} guiaId={g.id} nome={rotuloGuia(g)} />}
                {g.pagoEm && (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-success">
                    <Check className="size-4" />
                    Paga em {diaSP(g.pagoEm)}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {r.qtd > 1 && (
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t bg-muted/30 px-6 py-3 text-sm">
          <span className="text-muted-foreground">
            Total de {r.qtd} guias{r.pagas > 0 && r.pagas < r.qtd && <> · falta pagar <b className="font-semibold text-foreground tabular-nums">R$ {fmtValor(r.emAberto)}</b></>}
          </span>
          <span className="text-lg font-semibold tabular-nums">R$ {fmtValor(r.total)}</span>
        </div>
      )}
    </Card>
  );
}

async function Conteudo({ params }: PageProps<"/portal/[empresaId]">) {
  await connection();
  const { empresaId } = await params;
  const { user, papel, empresa } = await getEmpresaPortal(empresaId);
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
  // Só as guias já enviadas (rascunho do contador não aparece); mês encerrado não mostra guias.
  const todas = await listarGuias([ciclo.id, ...historico.map((c) => c.id)], { comRascunhos: false });
  const guiasDe = Map.groupBy(todas, (g) => g.cicloId);
  const guias = ciclo.status === "encerrado" ? [] : (guiasDe.get(ciclo.id) ?? []);
  const esperadas = guiasEsperadas({ regime: empresa.regimeTributario, temProLabore: empresa.temProLabore });
  // Meses anteriores com guia em aberto: o cliente ainda baixa e paga por aqui.
  const anterioresAbertos = historico.filter((c) => c.status === "das_enviado" && guiasDe.get(c.id)?.length);
  // Data de recebimento sem arquivo = avisou que mandou por outro canal (só avisarExtratoPorFora grava assim).
  const porFora = ciclo.extratoRecebidoEm && (docs.length === 0 || ciclo.clienteObs) ? ciclo.extratoRecebidoEm : null;
  // Arquivos já chegaram (ou o cliente avisou), mas o mês ainda não foi concluído: o envio fica recolhido.
  const recebido = ciclo.status !== "aguardando_extrato" && !passou(ciclo.status, "das_enviado");

  return (
    <>
      <Topo empresa={{ id: empresa.id, nome: empresa.razaoSocial, logoUrl }} usuario={{ ...perfil, email: user.email ?? "", ...avatarDoCliente(papel, logoUrl, perfil.avatarUrl) }} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <section className="rounded-xl bg-primary px-6 py-7 text-primary-foreground shadow-card sm:px-8">
          <div className="flex flex-wrap items-center gap-5">
            <Avatar
              url={logoUrl}
              texto={empresa.razaoSocial}
              className="size-16 rounded-lg bg-white text-2xl text-primary"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white/75">{primeiroNome ? `Olá, ${primeiroNome}` : "Olá"}. Este é o portal da sua empresa.</p>
              <h1 className="mt-1 font-display text-[1.625rem] leading-tight font-semibold tracking-[-0.02em] text-balance">{empresa.razaoSocial}</h1>
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
                <ProgressoCiclo status={ciclo.status} />
                {porFora && !recebido && <NotaPorFora em={porFora} obs={ciclo.clienteObs} />}
                {ciclo.status === "aguardando_extrato" && <JaEnviei empresaId={empresaId} />}
                {!passou(ciclo.status, "das_enviado") && esperadas.length > 0 && (
                  <p className="flex gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-foreground">
                    <Receipt className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>
                      Este mês você vai receber: <b className="font-semibold">{listaTipos(esperadas)}</b>.
                      <span className="block text-muted-foreground">Avisamos por e-mail quando {esperadas.length === 1 ? "a guia estiver pronta" : "as guias estiverem prontas"}.</span>
                    </span>
                  </p>
                )}
              </CardContent>
            </Card>

            {guias.length > 0 && (
              <GuiasCard empresaId={empresaId} titulo={`Guias de ${mes}`} guias={guias} hj={hj} pagavel={ciclo.status === "das_enviado"} />
            )}
            {anterioresAbertos.map((c) => (
              <GuiasCard
                key={c.id}
                empresaId={empresaId}
                titulo={`Guias de ${nomeCompetencia(c.competencia)}`}
                guias={(guiasDe.get(c.id) ?? []).filter((g) => !g.pagoEm)}
                hj={hj}
                pagavel
              />
            ))}

            {ciclo.status === "aguardando_extrato" && (
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

            {recebido && (
              <Card>
                <CardHeader className="border-b">
                  <CardTitle className="flex items-center gap-2.5">
                    <span className="flex size-8 items-center justify-center rounded-md bg-success-soft text-success">
                      <CheckCircle2 className="size-4" />
                    </span>
                    {docs.length ? "Recebemos seus arquivos" : porFora ? "Recebemos seu aviso" : "O contador já está com os extratos"}
                  </CardTitle>
                  <CardDescription>
                    {docs.length
                      ? `${docs.length} ${docs.length === 1 ? "arquivo" : "arquivos"} de ${mes}. O contador já foi avisado; não precisa fazer mais nada.`
                      : `Não precisa enviar nada pelo portal. Se faltou algum extrato de ${mes}, envie abaixo.`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  {porFora && <NotaPorFora em={porFora} obs={ciclo.clienteObs} />}
                  {docs.length > 0 && <ListaArquivos empresaId={empresaId} docs={docs} />}
                  <EnviarMais empresaId={empresaId} contas={contas} />
                </CardContent>
              </Card>
            )}

            {docs.length > 0 && !recebido && (
              <Card>
                <CardHeader className="border-b">
                  <CardTitle>Arquivos enviados</CardTitle>
                  <CardDescription>
                    {docs.length} {docs.length === 1 ? "arquivo" : "arquivos"} de {mes}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ListaArquivos empresaId={empresaId} docs={docs} />
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
                  <TableHead>Guias</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Pago em</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {historico.map((c) => {
                  const gs = c.status === "encerrado" ? [] : (guiasDe.get(c.id) ?? []);
                  const r = resumoGuias(gs, hj);
                  // Pago em: o último "Já paguei", quando todas estão pagas.
                  const pagoEm = r.qtd && r.pagas === r.qtd ? gs.map((g) => g.pagoEm!).sort((a, b) => +b - +a)[0] : null;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="pl-6 font-medium">{tituloCompetencia(c.competencia)}</TableCell>
                      <TableCell>
                        {r.vencidas > 0 ? (
                          <Badge variant="danger">{r.vencidas === 1 ? "Guia vencida" : `${r.vencidas} guias vencidas`}</Badge>
                        ) : (
                          <Badge variant={STATUS_CICLO[c.status].badge}>{STATUS_CICLO[c.status].rotulo}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {r.qtd === 0 ? "-" : r.qtd === 1 ? rotuloGuia(gs[0]) : `${r.qtd} guias`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.qtd ? `R$ ${fmtValor(r.total)}` : "-"}</TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">{pagoEm ? diaSP(pagoEm) : "-"}</TableCell>
                      <TableCell className="pr-4">
                        <div className="flex justify-end gap-1">
                          {gs.map((g) => (
                            <Baixar key={g.id} empresaId={empresaId} guiaId={g.id} rotulo={`Baixar ${rotuloGuia(g)}`} size="icon-sm" variant="ghost" />
                          ))}
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
