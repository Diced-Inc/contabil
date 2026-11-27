"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, FileWarning, Save, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { chavesJaRegistradas, registrarNotas, type NotaInput } from "@/actions/titulos";
import { ContaSelect, type ContaOpcao } from "@/components/conta-select";
import { TablePanel } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtCompetencia, fmtData, fmtValor, primeiroDiaDoMes } from "@/lib/format";
import {
  contraparteDaNota, dataDaNota, direcaoDaNota, lerNota, marcarDuplicadas, parcelasDaNota, rotuloNota, type Direcao, type NotaLida,
} from "@/lib/notas";
import { decodificarXml } from "@/lib/notas/xml";
import { lerZip } from "@/lib/notas/zip";
import { contasDeContrapartida } from "@/lib/operacoes";
import { acharConta, NOMES_RETENCAO } from "@/lib/tributos";
import type { LancPrevia } from "@/lib/operacoes";
import { PreviaLancamentos } from "../../conciliacao/previa-lancamentos";
import { previaNota } from "../previa-nota";

type Ignorado = { arquivo: string; motivo: string };
type Linha = {
  id: string; arquivo: string; nota: NotaLida; direcao: Direcao | null; competencia: string; contaId: string | null;
  /** Conta escolhida para "Outras retenções" (índice da retenção). */
  contasRet: Record<number, string | null>;
  marcada: boolean; duplicada: boolean; aberta: boolean; resultado?: { ok: boolean; texto: string };
};

const MAX_BYTES = 25 * 1024 * 1024;

/** Receita padrão quando a empresa ainda não registrou nota: serviço ou mercadoria. */
function contaPadrao(contas: ContaOpcao[], lembradas: Record<Direcao, string | null>, d: Direcao | null, n: NotaLida) {
  if (!d) return null;
  if (lembradas[d]) return lembradas[d];
  if (d === "pagar") return null;
  return acharConta(contas, { prefixo: "3.1", re: n.origem === "nfse" ? /^venda de servicos$/ : /^venda de mercadorias$/ })?.id ?? null;
}

export function ImportarNotas({ empresaId, cnpj, contas, fechados, lembradas }: {
  empresaId: string; cnpj: string; contas: ContaOpcao[]; fechados: string[]; lembradas: Record<Direcao, string | null>;
}) {
  const router = useRouter();
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [ignorados, setIgnorados] = useState<Ignorado[]>([]);
  const [lendo, setLendo] = useState(false);
  const [pendente, iniciar] = useTransition();
  const set = (id: string, p: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));

  async function escolher(files: FileList | null) {
    if (!files?.length) return;
    setLendo(true);
    const lidas: { arquivo: string; nota: NotaLida }[] = [];
    const fora: Ignorado[] = [];
    const ler = (arquivo: string, bytes: Uint8Array) => {
      try {
        lidas.push({ arquivo, nota: lerNota(decodificarXml(bytes)) });
      } catch (e) {
        fora.push({ arquivo, motivo: (e as Error).message });
      }
    };
    for (const f of Array.from(files)) {
      if (f.size > MAX_BYTES) { fora.push({ arquivo: f.name, motivo: "Arquivo passa de 25 MB" }); continue; }
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (/\.zip$/i.test(f.name)) {
        try {
          const xs = (await lerZip(bytes)).filter((a) => /\.xml$/i.test(a.nome));
          if (!xs.length) fora.push({ arquivo: f.name, motivo: "Nenhum XML dentro do .zip" });
          for (const a of xs) ler(`${f.name} › ${a.nome}`, a.dados);
        } catch (e) {
          fora.push({ arquivo: f.name, motivo: (e as Error).message });
        }
      } else if (/\.xml$/i.test(f.name)) ler(f.name, bytes);
      else fora.push({ arquivo: f.name, motivo: "Formato não suportado (use .xml ou .zip)" });
    }
    const existentes = new Set(await chavesJaRegistradas(empresaId, [...new Set(lidas.map((l) => l.nota.chave))]));
    const dups = marcarDuplicadas(lidas.map((l) => l.nota.chave), existentes);
    const novas: Linha[] = lidas.map(({ arquivo, nota }, i) => {
      const direcao = direcaoDaNota(nota, cnpj);
      const duplicada = dups[i];
      return {
        id: `${i}-${arquivo}`, arquivo, nota, direcao, competencia: nota.competencia.slice(0, 7), contaId: contaPadrao(contas, lembradas, direcao, nota),
        contasRet: {}, marcada: !!direcao && !duplicada, duplicada, aberta: false,
      };
    });
    setLinhas(novas);
    setIgnorados(fora);
    setLendo(false);
  }

  /** Bloqueio da linha (não registra), ou null. */
  const bloqueio = (l: Linha) => {
    if (l.resultado?.ok) return "Registrada";
    if (!l.direcao) return "A empresa não é emitente nem destinatária";
    if (l.duplicada) return "Já registrada (mesma chave)";
    if (fechados.includes(primeiroDiaDoMes(dataDaNota(l.nota.emissao, `${l.competencia}-01`)))) return `Mês ${l.competencia.split("-").reverse().join("/")} fechado`;
    return null;
  };
  const calcular = (l: Linha): { previa: LancPrevia[] | string; novas: ContaOpcao[] } => {
    try {
      if (!l.direcao) throw new Error("A empresa não é emitente nem destinatária desta nota.");
      const { parcelas } = parcelasDaNota(l.nota);
      return previaNota({
        tipo: l.direcao, contas, contaResultadoId: l.contaId, emissao: l.nota.emissao, competencia: `${l.competencia}-01`,
        contraparte: contraparteDaNota(l.nota, l.direcao).nome, rotulo: rotuloNota(l.nota.origem, l.nota.numero, l.nota.serie),
        retencoes: l.nota.retencoes.map((r, i) => ({ ...r, contaId: l.contasRet[i] ?? null })), parcelas,
      });
    } catch (e) {
      return { previa: (e as Error).message, novas: [] };
    }
  };
  const montar = (l: Linha) => calcular(l).previa;
  const prontas = linhas.filter((l) => l.marcada && !bloqueio(l));
  const comErro = prontas.filter((l) => typeof montar(l) === "string");

  const registrar = () => iniciar(async () => {
    const envio = prontas.filter((l) => typeof montar(l) !== "string");
    const notas: NotaInput[] = envio.map((l) => ({
      origem: l.nota.origem, chave: l.nota.chave, numero: l.nota.numero, serie: l.nota.serie, emissao: l.nota.emissao,
      competencia: l.competencia, emitente: l.nota.emitente, destinatario: l.nota.destinatario, bruto: l.nota.bruto,
      retencoes: l.nota.retencoes.map((r, i) => ({ ...r, contaId: l.contasRet[i] ?? null })), contaResultadoId: l.contaId ?? "",
      parcelas: parcelasDaNota(l.nota).parcelas, descricao: rotuloNota(l.nota.origem, l.nota.numero, l.nota.serie),
    }));
    const rs = await registrarNotas(empresaId, notas);
    const porId = new Map(envio.map((l, i) => [l.id, rs[i]]));
    setLinhas((ls) => ls.map((l) => {
      const r = porId.get(l.id);
      if (!r) return l;
      if ("ok" in r) return { ...l, marcada: false, resultado: { ok: true, texto: r.titulos > 1 ? `Registrada (${r.titulos} títulos)` : "Registrada" } };
      if ("duplicada" in r) return { ...l, marcada: false, duplicada: true };
      return { ...l, resultado: { ok: false, texto: r.erro } };
    }));
    const ok = rs.filter((r) => "ok" in r).length, dup = rs.filter((r) => "duplicada" in r).length, err = rs.length - ok - dup;
    toast[err ? "error" : "success"](`${ok} nota(s) registrada(s)${dup ? `, ${dup} duplicada(s) pulada(s)` : ""}${err ? `, ${err} com erro` : ""}.`);
    router.refresh();
  });

  const aplicarConta = (d: Direcao, id: string) => setLinhas((ls) => ls.map((l) => (l.direcao === d && !l.resultado?.ok ? { ...l, contaId: id } : l)));
  const dirs = new Set(linhas.map((l) => l.direcao));

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-xl border bg-card p-4 shadow-card">
        <Label htmlFor="xmls">Arquivos XML ou .zip</Label>
        <Input id="xmls" type="file" multiple accept=".xml,.zip,text/xml,application/xml,application/zip" disabled={lendo || pendente}
          onChange={(e) => escolher(e.target.files)} />
        <p className="text-sm text-muted-foreground">
          {lendo ? "Lendo os arquivos..." : "A direção sai do CNPJ: a empresa emitente/prestadora gera conta a receber; destinatária/tomadora, conta a pagar. Nada é gravado antes de Registrar."}
        </p>
      </div>

      {ignorados.length > 0 && (
        <div className="grid gap-1 rounded-lg border border-warning/25 bg-warning-soft p-3 text-sm text-warning">
          <p className="flex items-center gap-1.5 font-medium"><FileWarning className="size-4" />{ignorados.length} arquivo(s) ignorado(s)</p>
          <ul className="grid gap-0.5 text-warning/90">
            {ignorados.map((i) => <li key={i.arquivo}><span className="font-medium">{i.arquivo}</span>: {i.motivo}</li>)}
          </ul>
        </div>
      )}

      {linhas.length > 0 && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            {(["receber", "pagar"] as const).filter((d) => dirs.has(d)).map((d) => (
              <div key={d} className="grid w-80 gap-1.5">
                <Label>Conta para todas {d === "receber" ? "a receber (receita)" : "a pagar (custo/despesa)"}</Label>
                <ContaSelect contas={contasDeContrapartida(contas, d)} value={null} onChange={(id) => aplicarConta(d, id)} placeholder="Aplicar a todas..." />
              </div>
            ))}
          </div>
          <TablePanel className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Nota</TableHead>
                  <TableHead>Direção</TableHead>
                  <TableHead>Contraparte</TableHead>
                  <TableHead>Competência</TableHead>
                  <TableHead className="text-right">Valores</TableHead>
                  <TableHead className="min-w-60">Conta</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => {
                  const b = bloqueio(l);
                  const { previa: prev, novas } = calcular(l);
                  const { parcelas, aviso } = parcelasDaNota(l.nota);
                  const avisos = [...l.nota.avisos, ...(aviso ? [aviso] : [])];
                  const outra = l.direcao ? contraparteDaNota(l.nota, l.direcao) : l.nota.emitente;
                  return (
                    <Fragment key={l.id}>
                      <TableRow className={cn(b && "text-muted-foreground")}>
                        <TableCell>
                          <Checkbox checked={l.marcada && !b} disabled={!!b} onCheckedChange={(c) => set(l.id, { marcada: !!c })} aria-label={`Registrar ${l.arquivo}`} />
                        </TableCell>
                        <TableCell className="max-w-56">
                          <button type="button" className="flex items-center gap-1 text-left font-medium" onClick={() => set(l.id, { aberta: !l.aberta })}>
                            {l.aberta ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                            {rotuloNota(l.nota.origem, l.nota.numero, l.nota.serie)}
                          </button>
                          <span className="block truncate text-xs text-muted-foreground" title={l.arquivo}>{l.nota.layout} · {fmtData(l.nota.emissao)} · {l.arquivo}</span>
                        </TableCell>
                        <TableCell>
                          {l.direcao ? <Badge variant={l.direcao === "receber" ? "success" : "info"}>{l.direcao === "receber" ? "A receber" : "A pagar"}</Badge> : <Badge variant="danger">Outra empresa</Badge>}
                        </TableCell>
                        <TableCell className="max-w-48">
                          <span className="block truncate">{outra.nome || "(sem nome)"}</span>
                          <span className="block text-xs text-muted-foreground tabular-nums">{outra.documento}</span>
                        </TableCell>
                        <TableCell>
                          <Input type="month" value={l.competencia} onChange={(e) => e.target.value && set(l.id, { competencia: e.target.value })} className="h-8 w-40" aria-label="Competência" disabled={!!l.resultado?.ok} />
                        </TableCell>
                        <TableCell className="text-right text-xs whitespace-nowrap tabular-nums">
                          <span className="block text-sm font-medium">{fmtValor(l.nota.liquido)}</span>
                          {l.nota.retencoes.length > 0 && (
                            <span className={cn("block", l.nota.retencoes.some((r) => r.tipo === "outras") ? "text-warning" : "text-muted-foreground")}
                              title={l.nota.retencoes.map((r) => `${NOMES_RETENCAO[r.tipo]} ${fmtValor(r.valor)}`).join("\n")}>
                              bruto {fmtValor(l.nota.bruto)} − {l.nota.retencoes.length} ret.
                            </span>
                          )}
                          <span className="block text-muted-foreground">
                            {parcelas.length > 1 ? `${parcelas.length} parcelas, 1ª ${parcelas[0].vencimento ? fmtData(parcelas[0].vencimento) : "s/ venc."}` : parcelas[0].vencimento ? `vence ${fmtData(parcelas[0].vencimento)}` : ""}
                          </span>
                        </TableCell>
                        <TableCell>
                          {l.direcao && (
                            <ContaSelect contas={contasDeContrapartida(contas, l.direcao)} value={l.contaId} onChange={(id) => set(l.id, { contaId: id })}
                              placeholder={l.direcao === "receber" ? "Receita" : "Custo/despesa"} />
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {l.resultado ? (
                            <span className={l.resultado.ok ? "text-success" : "text-danger"}>{l.resultado.texto}</span>
                          ) : b ? (
                            <span className={l.duplicada ? "text-warning" : "text-danger"}>{b}</span>
                          ) : typeof prev === "string" ? (
                            <span className="text-danger">{prev}</span>
                          ) : (
                            <span className="text-success">Pronta</span>
                          )}
                          {avisos.length > 0 && (
                            <span className="mt-0.5 flex items-center gap-1 text-warning" title={avisos.join("\n")}>
                              <TriangleAlert className="size-3.5" /> {avisos.length} aviso(s)
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                      {l.aberta && (
                        <TableRow>
                          <TableCell />
                          <TableCell colSpan={7} className="whitespace-normal">
                            <div className="grid max-w-3xl gap-3 py-2">
                              {avisos.map((a) => <p key={a} className="flex gap-1.5 text-sm text-warning"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{a}</p>)}
                              {l.nota.retencoes.length > 0 && (
                                <p className="text-sm">
                                  Bruto R$ {fmtValor(l.nota.bruto)} · {l.nota.retencoes.map((r) => `${NOMES_RETENCAO[r.tipo]} ${fmtValor(r.valor)}`).join(" · ")} · líquido R$ {fmtValor(l.nota.liquido)}
                                </p>
                              )}
                              {l.direcao && l.nota.retencoes.map((r, i) => r.tipo === "outras" && (
                                <div key={i} className="grid gap-1.5">
                                  <Label>Conta de {NOMES_RETENCAO[r.tipo]} ({fmtValor(r.valor)})</Label>
                                  <ContaSelect contas={contas} value={l.contasRet[i] ?? null} onChange={(id) => set(l.id, { contasRet: { ...l.contasRet, [i]: id } })} />
                                </div>
                              ))}
                              <p className="text-xs text-muted-foreground">
                                Competência {fmtCompetencia(`${l.competencia}-01`)} · reconhecimento em {fmtData(dataDaNota(l.nota.emissao, `${l.competencia}-01`))}
                              </p>
                              <PreviaLancamentos previa={prev} contas={[...contas, ...novas]} fechados={fechados} />
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </TablePanel>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {comErro.length > 0 && <span className="text-sm text-danger">{comErro.length} marcada(s) com pendência (veja a situação)</span>}
            <Button onClick={registrar} disabled={pendente || prontas.length - comErro.length === 0}>
              <Save />
              {pendente ? "Registrando..." : `Registrar ${prontas.length - comErro.length} nota(s)`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
