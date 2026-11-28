"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarX2, CircleAlert, FileUp, Landmark, Plus, Save, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { criarContaAberturaAction, salvarAberturaAction } from "@/actions/abertura";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { casarCsv, lerCsvAbertura, patrimonial, saldoExtratoNaData, type ContaAbertura, type Pendente } from "@/lib/abertura";
import type { ExtratoAbertura } from "@/lib/abertura-registro";
import { decodificar } from "@/lib/csv";
import { compararCodigo } from "@/lib/relatorios/hierarquia";
import { cents, fmtCompetencia, fmtData, fmtSaldoDC, fmtValor, fromCents, parseValorBR, primeiroDiaDoMes, valorParaInput } from "@/lib/format";

const alertaCls = "border-warning/25 bg-warning-soft text-warning *:data-[slot=alert-description]:text-warning/90";
const selectCls =
  "h-8 cursor-pointer rounded-md border border-input bg-card px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Valores = Record<string, { d: string; c: string }>;
/** Centavos do input pt-BR; inválido conta como 0 (o servidor rejeita). */
const c = (s?: string) => cents(parseValorBR(s ?? "") || 0) || 0;
const doSaldo = (s: number) => (s > 0 ? { d: valorParaInput(fromCents(s)), c: "" } : { d: "", c: valorParaInput(fromCents(-s)) });

export function SaldosIniciais({ empresaId, contas: contasIniciais, atual, inicial, primeiroMovimento, extratos, fechados }: {
  empresaId: string;
  contas: ContaAbertura[];
  atual: { id: string; numero: number; data: string } | null;
  inicial: { data: string; saldos: Record<string, number> };
  primeiroMovimento: string | null;
  extratos: Pick<ExtratoAbertura, "id" | "nome" | "contaContabilId" | "ref" | "dias">[];
  fechados: string[];
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [contas, setContas] = useState(contasIniciais);
  const [data, setData] = useState(inicial.data);
  const [valores, setValores] = useState<Valores>(() =>
    Object.fromEntries(Object.entries(inicial.saldos).filter(([, s]) => s).map(([id, s]) => [id, doSaldo(s)])));
  const [diferencaEmLucros, setDiferencaEmLucros] = useState(false);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [csv, setCsv] = useState<{ arquivo: string; casadas: number; ignoradas: number; pendentes: Pendente[] } | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);

  const patrimoniais = contas.filter((x) => patrimonial(x.codigo));
  const analiticas = patrimoniais.filter((x) => x.tipo === "analitica");
  const saldoDe = (id: string) => c(valores[id]?.d) - c(valores[id]?.c);
  const totalD = analiticas.reduce((s, x) => s + c(valores[x.id]?.d), 0);
  const totalC = analiticas.reduce((s, x) => s + c(valores[x.id]?.c), 0);
  const dif = totalD - totalC;
  const comSaldo = analiticas.filter((x) => saldoDe(x.id) !== 0);
  const mesFechado = [data, atual?.data].find((d) => d && fechados.includes(primeiroDiaDoMes(d)));
  const dataValida = /^\d{4}-\d{2}-\d{2}$/.test(data);
  const podeSalvar = !pendente && !mesFechado && dataValida && comSaldo.length >= 1 && (dif === 0 ? comSaldo.length >= 2 : diferencaEmLucros);

  const termo = busca.trim().toLowerCase();
  const visiveis = termo
    ? analiticas.filter((x) => x.codigo.startsWith(termo) || x.nome.toLowerCase().includes(termo))
    : patrimoniais;

  const mudar = (id: string, lado: "d" | "c", v: string) =>
    setValores((vs) => ({ ...vs, [id]: lado === "d" ? { d: v, c: v ? "" : vs[id]?.c ?? "" } : { c: v, d: v ? "" : vs[id]?.d ?? "" } }));

  async function importar(f: File) {
    try {
      const { texto } = decodificar(new Uint8Array(await f.arrayBuffer()));
      const r = casarCsv(lerCsvAbertura(texto), contas);
      setValores(Object.fromEntries([...r.saldos].filter(([, s]) => s).map(([id, s]) => [id, doSaldo(s)])));
      setCsv({ arquivo: f.name, casadas: r.saldos.size, ignoradas: r.ignoradas, pendentes: r.pendentes });
      setConfirmar(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const salvar = (confirmado: boolean) =>
    iniciar(async () => {
      const r = await salvarAberturaAction(empresaId, {
        data, diferenca: diferencaEmLucros && dif !== 0, confirmar: confirmado,
        saldos: comSaldo.map((x) => ({ contaId: x.id, debito: valores[x.id]?.d ?? "", credito: valores[x.id]?.c ?? "" })),
      });
      if (r.erro) return void toast.error(r.erro);
      if (r.confirmar) return void setConfirmar(r.confirmar);
      setConfirmar(null);
      toast.success(`Saldos iniciais gravados no lançamento nº ${r.numero}.`);
      router.refresh();
    });

  return (
    <div className="grid max-w-5xl gap-5">
      <section className="grid gap-4 rounded-xl border bg-card p-5 shadow-card">
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid gap-2">
            <Label htmlFor="data-abertura">Data dos saldos</Label>
            <Input id="data-abertura" type="date" value={data} onChange={(e) => { setData(e.target.value); setConfirmar(null); }} className="w-44" />
          </div>
          <div className="grid gap-2">
            <input ref={arquivo} type="file" accept=".csv,text/csv,text/plain" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importar(f); e.target.value = ""; }} />
            <Button type="button" variant="outline" onClick={() => arquivo.current?.click()}>
              <FileUp />
              Importar balancete (CSV)
            </Button>
          </div>
          <p className="min-w-60 flex-1 text-xs text-muted-foreground">
            Último dia antes do início (ex.: 31/12 do ano anterior). CSV com cabeçalho: <span className="font-mono">codigo</span> (ou{" "}
            <span className="font-mono">nome</span>), <span className="font-mono">saldo</span> e <span className="font-mono">natureza</span> (D/C);
            casa pelo código e depois pelo nome, e substitui os valores da grade.
          </p>
        </div>
        {atual && (
          <p className="text-sm text-muted-foreground">
            Saldos iniciais atuais no{" "}
            <Link href={`/e/${empresaId}/lancamentos/${atual.id}`} className="text-primary underline-offset-2 hover:underline">lançamento nº {atual.numero}</Link>{" "}
            de {fmtData(atual.data)}. Salvar estorna esse lançamento e cria um novo.
          </p>
        )}
        {mesFechado && (
          <Alert variant="destructive">
            <CalendarX2 />
            <AlertDescription>Mês {fmtCompetencia(mesFechado)} fechado: reabra-o em Fechamento para mudar os saldos iniciais.</AlertDescription>
          </Alert>
        )}
        {primeiroMovimento && dataValida && data >= primeiroMovimento && (
          <Alert className={alertaCls}>
            <TriangleAlert />
            <AlertDescription>
              A empresa tem movimento (data ou competência) desde {fmtData(primeiroMovimento)}: saldos iniciais nessa data ou depois pedem confirmação, porque
              o que foi lançado antes não parte deles.
            </AlertDescription>
          </Alert>
        )}
      </section>

      {csv && (
        <section className="overflow-hidden rounded-xl border bg-card shadow-card">
          <div className="border-b px-5 py-3.5">
            <h2 className="text-sm font-semibold">Importação de {csv.arquivo}</h2>
            <p className="text-xs text-muted-foreground">
              {csv.casadas} conta(s) preenchida(s){csv.ignoradas ? `, ${csv.ignoradas} linha(s) de grupo (sintética) ignorada(s)` : ""}
              {csv.pendentes.length ? `, ${csv.pendentes.length} sem conta: crie a conta ou lance o valor na grade.` : "."}
            </p>
          </div>
          {csv.pendentes.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Linha</TableHead>
                  <TableHead>Conta no CSV</TableHead>
                  <TableHead className="w-32 text-right">Saldo</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead className="w-[22rem]">Criar no plano</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {csv.pendentes.map((p) => (
                  <LinhaPendente key={p.linha} p={p} empresaId={empresaId} grupos={patrimoniais.filter((x) => x.tipo === "sintetica")}
                    onCriada={(conta, natureza) => {
                      setContas((cs) => (cs.some((x) => x.id === conta.id) ? cs : [...cs, conta].sort((a, b) => compararCodigo(a.codigo, b.codigo))));
                      const lado = p.natureza ?? natureza;
                      setValores((vs) => ({ ...vs, [conta.id]: doSaldo(p.saldo * (lado === "D" ? 1 : -1)) }));
                      setCsv((x) => x && { ...x, casadas: x.casadas + 1, pendentes: x.pendentes.filter((y) => y.linha !== p.linha) });
                    }} />
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      {extratos.length > 0 && (
        <section className="grid gap-2 rounded-xl border bg-card p-5 shadow-card">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Landmark className="size-4" /> Bancos × extrato em {dataValida ? fmtData(data) : "—"}</h2>
          {extratos.map((b) => {
            const contabil = saldoDe(b.contaContabilId);
            const ext = b.ref && dataValida ? saldoExtratoNaData(b.ref, b.dias, data) : null;
            const ok = ext !== null && ext === contabil;
            return (
              <p key={b.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium">{b.nome}</span>
                <span className="text-muted-foreground">saldo inicial R$ {fmtValor(fromCents(contabil))}</span>
                {ext === null ? (
                  <span className="text-muted-foreground">· sem OFX com saldo para conferir</span>
                ) : (
                  <span className={ok ? "text-success" : "text-warning"}>
                    · extrato R$ {fmtValor(fromCents(ext))}{ok ? " (confere)" : ` (diferença R$ ${fmtValor(fromCents(contabil - ext))})`}
                  </span>
                )}
              </p>
            );
          })}
          <p className="text-xs text-muted-foreground">Extrato na data: saldo do primeiro OFX com saldo, recalculado pelos movimentos importados (sem os ignorados).</p>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3.5">
          <div className="flex-1">
            <h2 className="text-sm font-semibold">Saldos por conta</h2>
            <p className="text-xs text-muted-foreground">Analíticas do Ativo, Passivo e PL. Devedor ou credor em cada conta; débitos e créditos precisam fechar.</p>
          </div>
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar conta" className="h-8 w-56" />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Código</TableHead>
              <TableHead>Conta</TableHead>
              <TableHead className="w-40 text-right">Devedor</TableHead>
              <TableHead className="w-40 text-right">Credor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.map((x) => x.tipo === "sintetica" ? (
              <TableRow key={x.id} className="bg-muted/40 hover:bg-muted/40">
                <TableCell className="py-1.5 font-mono text-xs font-semibold">{x.codigo}</TableCell>
                <TableCell colSpan={3} className="py-1.5 font-semibold">{x.nome}</TableCell>
              </TableRow>
            ) : (
              <TableRow key={x.id}>
                <TableCell className="py-1 font-mono text-xs text-muted-foreground">{x.codigo}</TableCell>
                <TableCell className="py-1 whitespace-normal">
                  {x.nome}
                  {saldoDe(x.id) !== 0 && (saldoDe(x.id) > 0) !== (x.natureza === "D") && (
                    <span className="ml-2 text-xs text-warning">contra a natureza ({x.natureza === "D" ? "devedora" : "credora"})</span>
                  )}
                </TableCell>
                {(["d", "c"] as const).map((lado) => (
                  <TableCell key={lado} className="py-1">
                    <Input inputMode="decimal" autoComplete="off" placeholder="0,00" className="h-8 text-right tabular-nums"
                      aria-label={`${lado === "d" ? "Devedor" : "Credor"} ${x.codigo}`}
                      value={valores[x.id]?.[lado] ?? ""} onChange={(e) => mudar(x.id, lado, e.target.value)} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2} className="text-right">Totais ({comSaldo.length} conta(s) com saldo)</TableCell>
              <TableCell className="text-right tabular-nums">{fmtValor(fromCents(totalD))}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtValor(fromCents(totalC))}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={2} className="text-right text-muted-foreground">Diferença (D − C)</TableCell>
              <TableCell colSpan={2} className={cn("text-right font-semibold tabular-nums", dif ? "text-danger" : "text-success")}>
                {fmtSaldoDC(fromCents(dif), "D")}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </section>

      {dif !== 0 && (
        <div className="grid gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={diferencaEmLucros} onCheckedChange={(v) => setDiferencaEmLucros(v === true)} />
            Lançar a diferença de R$ {fmtValor(fromCents(Math.abs(dif)))} em {dif > 0 ? "Lucros acumulados (crédito)" : "Prejuízos acumulados (débito)"}
          </label>
          {diferencaEmLucros && (
            <Alert className={alertaCls}>
              <TriangleAlert />
              <AlertTitle>Confira antes de usar</AlertTitle>
              <AlertDescription>
                Balancete que não fecha costuma ser conta faltando ou valor digitado errado. A diferença no PL esconde o erro e muda o patrimônio
                da empresa: use só se o balancete de origem tem essa diferença em Lucros/Prejuízos acumulados.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {confirmar && (
        <Alert className={alertaCls}>
          <CircleAlert />
          <AlertDescription className="grid gap-2">
            <span>{confirmar}</span>
            <span><Button type="button" size="sm" variant="outline" disabled={pendente} onClick={() => salvar(true)}>Salvar mesmo assim</Button></span>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-2">
        <Link href={`/e/${empresaId}/lancamentos`} className={buttonVariants({ variant: "outline" })}>Voltar</Link>
        <Button type="button" disabled={!podeSalvar} onClick={() => salvar(false)}>
          <Save />
          {pendente ? "Salvando..." : atual ? "Salvar e substituir" : "Salvar saldos iniciais"}
        </Button>
      </div>
    </div>
  );
}

/** Linha do CSV sem conta: cria a analítica no grupo escolhido (sugerido pelo código) e lança o saldo nela. */
function LinhaPendente({ p, empresaId, grupos, onCriada }: {
  p: Pendente; empresaId: string; grupos: ContaAbertura[]; onCriada: (c: ContaAbertura, natureza: "D" | "C") => void;
}) {
  const sugerido = [...grupos].sort((a, b) => b.codigo.length - a.codigo.length).find((g) => p.codigo.startsWith(`${g.codigo}.`));
  const [paiId, setPaiId] = useState(sugerido?.id ?? "");
  const [natureza, setNatureza] = useState<"D" | "C">(p.natureza ?? (p.codigo.startsWith("1") ? "D" : "C"));
  const [pendente, iniciar] = useTransition();
  const criavel = p.motivo === "Sem conta no plano";
  const criar = () =>
    iniciar(async () => {
      const r = await criarContaAberturaAction(empresaId, { paiId, nome: p.nome || p.codigo, natureza });
      if (r.erro || !r.conta) return void toast.error(r.erro ?? "Erro ao criar a conta.");
      toast.success(`Conta ${r.conta.codigo} ${r.conta.nome} criada.`);
      onCriada({ id: r.conta.id, codigo: r.conta.codigo, nome: r.conta.nome, natureza, tipo: "analitica" }, natureza);
    });
  return (
    <TableRow>
      <TableCell className="py-1.5 text-muted-foreground">{p.linha}</TableCell>
      <TableCell className="py-1.5 whitespace-normal"><span className="mr-2 font-mono text-xs">{p.codigo}</span>{p.nome}</TableCell>
      <TableCell className="py-1.5 text-right tabular-nums">{fmtValor(fromCents(Math.abs(p.saldo)))}{p.natureza ?? ""}</TableCell>
      <TableCell className="py-1.5 whitespace-normal text-muted-foreground">{p.motivo}</TableCell>
      <TableCell className="py-1.5">
        {criavel && (
          <div className="flex items-center gap-1.5">
            <select aria-label="Grupo" value={paiId} onChange={(e) => setPaiId(e.target.value)} className={cn(selectCls, "w-44")}>
              <option value="">Grupo...</option>
              {grupos.map((g) => <option key={g.id} value={g.id}>{g.codigo} {g.nome}</option>)}
            </select>
            <select aria-label="Natureza" value={natureza} onChange={(e) => setNatureza(e.target.value as "D" | "C")} className={selectCls}>
              <option value="D">D</option>
              <option value="C">C</option>
            </select>
            <Button type="button" size="sm" variant="outline" disabled={!paiId || pendente} onClick={criar}>
              <Plus />
              Criar
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
