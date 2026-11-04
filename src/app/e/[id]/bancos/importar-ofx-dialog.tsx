"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import {
  analisarCsv, extrairPdf, importarCsvArquivo, importarLinhasRevisadas, importarOfxArquivo, sugerirAposImportacao,
  type MapeamentoSalvo, type ResultadoArquivo,
} from "@/actions/bancos";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sugerirMapeamento, type DeteccaoCsv } from "@/lib/csv";
import type { ExtratoIA } from "@/lib/extrato-ia";
import { MapeamentoCsvPasso, selectCls } from "./mapeamento-csv";
import { RevisaoPdfPasso, type Revisada } from "./revisao-pdf";

// Igual ao MAX_OFX do servidor (bytes decimais): uma requisição por arquivo, abaixo dos 4,5 MB da Vercel.
const MAX_OFX = 4_400_000;
const GRANDE = "Arquivo maior que 4,4 MB";
const ACCEPT = ".ofx,.csv,.pdf";

type Tipo = "ofx" | "csv" | "pdf";
type Conta = { id: string; nome: string; numero?: string | null };
type Status =
  | { s: "fila" }
  | { s: "enviando" }
  | { s: "analisando" }
  | { s: "extraindo" }
  | { s: "aguardando"; msg: string }
  | { s: "ok"; novas: number; repetidas: number }
  | { s: "erro"; msg: string };
type Item = { arquivo: File; tipo: Tipo | null; status: Status };

/** Passo interativo no meio da fila: a fila espera a Promise que o passo resolve. */
type Passo =
  | {
    tipo: "csv"; arquivo: File; bytes: Uint8Array; deteccao: DeteccaoCsv; inicial: MapeamentoSalvo;
    resolver: (r: { m: MapeamentoSalvo; salvar: boolean } | null) => void;
  }
  | { tipo: "pdf"; arquivo: File; extracao: ExtratoIA; resolver: (r: Revisada | null) => void };

const fmtTamanho = (b: number) =>
  b < 1_000_000 ? `${Math.max(1, Math.round(b / 1000))} KB` : `${(b / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

function tipoDe(f: File): Tipo | null {
  const ext = f.name.toLowerCase().split(".").pop();
  return ext === "ofx" || ext === "csv" || ext === "pdf" ? ext : null;
}

/** O mapeamento salvo só vale para o mesmo layout (mesmas colunas, mesmo separador). */
function compativel(salvo: MapeamentoSalvo | null, d: DeteccaoCsv): salvo is MapeamentoSalvo {
  return !!salvo && salvo.separador === d.separador && JSON.stringify(salvo.colunas) === JSON.stringify(d.colunas);
}

function StatusTexto({ st }: { st: Status }) {
  if (st.s === "fila") return <span className="text-muted-foreground">Na fila</span>;
  if (st.s === "enviando") return <span className="text-muted-foreground">Enviando...</span>;
  if (st.s === "analisando") return <span className="text-muted-foreground">Analisando...</span>;
  if (st.s === "extraindo") return <span className="text-muted-foreground">Extraindo com IA...</span>;
  if (st.s === "aguardando") return <span className="text-amber-600 dark:text-amber-400">{st.msg}</span>;
  if (st.s === "ok") return <span className="text-emerald-600 dark:text-emerald-400">{st.novas} novas, {st.repetidas} repetidas</span>;
  return (
    <span className="text-destructive">
      {st.msg}
      {st.msg === GRANDE && <span className="block text-xs text-muted-foreground">Exporte o extrato por período menor.</span>}
    </span>
  );
}

type Fase = "escolha" | "importando" | "fim";

function Form({ empresaId, contas, fase, setFase, passo, setPasso, fechar }: {
  empresaId: string; contas: Conta[]; fase: Fase; setFase: (f: Fase) => void;
  passo: Passo | null; setPasso: (p: Passo | null) => void; fechar: () => void;
}) {
  const [contaId, setContaId] = useState(contas.length === 1 ? contas[0].id : "");
  const [itens, setItens] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [feitos, setFeitos] = useState(0);
  const validos = itens.filter((i) => i.status.s === "fila").length;

  function escolher(files: FileList | null) {
    setItens(
      Array.from(files ?? []).map((arquivo) => {
        const tipo = tipoDe(arquivo);
        const status: Status = !tipo ? { s: "erro", msg: "Formato não suportado (use OFX, CSV ou PDF)" }
          : arquivo.size > MAX_OFX ? { s: "erro", msg: GRANDE } : { s: "fila" };
        return { arquivo, tipo, status };
      }),
    );
  }

  /** CSV: detecta, aplica o mapeamento salvo da conta (mesmo layout) ou pede o mapeamento ao usuário. */
  async function importarCsv(item: Item, fd: FormData, set: (s: Status) => void): Promise<ResultadoArquivo | null> {
    set({ s: "analisando" });
    const a = await analisarCsv(empresaId, contaId, fd);
    if ("erro" in a) return a;
    if (compativel(a.mapeamentoSalvo, a.deteccao)) {
      const { linhaCabecalho, encoding } = a.deteccao;
      set({ s: "enviando" });
      return importarCsvArquivo(empresaId, contaId, fd, { ...a.mapeamentoSalvo, linhaCabecalho, encoding }, false);
    }
    set({ s: "aguardando", msg: "Aguardando mapeamento" });
    const bytes = new Uint8Array(await item.arquivo.arrayBuffer());
    const r = await new Promise<{ m: MapeamentoSalvo; salvar: boolean } | null>((resolver) =>
      setPasso({
        tipo: "csv", arquivo: item.arquivo, bytes, deteccao: a.deteccao,
        inicial: { ...sugerirMapeamento(a.deteccao), colunas: a.deteccao.colunas }, resolver,
      }),
    );
    setPasso(null);
    if (!r) return null;
    set({ s: "enviando" });
    return importarCsvArquivo(empresaId, contaId, fd, r.m, r.salvar);
  }

  /** PDF: IA extrai as linhas, o usuário revisa e só então grava. */
  async function importarPdf(item: Item, fd: FormData, set: (s: Status) => void): Promise<ResultadoArquivo | null> {
    set({ s: "extraindo" });
    const e = await extrairPdf(empresaId, contaId, fd);
    if ("erro" in e) return e;
    if (e.transacoes.length === 0) return { erro: "A IA não encontrou movimentações no PDF." };
    set({ s: "aguardando", msg: "Aguardando revisão" });
    const r = await new Promise<Revisada | null>((resolver) => setPasso({ tipo: "pdf", arquivo: item.arquivo, extracao: e, resolver }));
    setPasso(null);
    if (!r) return null;
    set({ s: "enviando" });
    return importarLinhasRevisadas(empresaId, contaId, { nomeArquivo: item.arquivo.name, origem: "pdf", ...r });
  }

  async function importar() {
    setFase("importando");
    setTotal(validos);
    setFeitos(0);
    const ids: string[] = [];
    // Sequencial de propósito: arquivos da mesma conta em paralelo disputariam lock no banco,
    // e um CSV mapeado (e salvo) agora vale para os próximos do mesmo layout.
    for (const [idx, item] of itens.entries()) {
      if (item.status.s !== "fila") continue;
      const set = (status: Status) => setItens((xs) => xs.map((x, j) => (j === idx ? { ...x, status } : x)));
      const fd = new FormData();
      fd.set("arquivo", item.arquivo);
      try {
        let r: ResultadoArquivo | null;
        if (item.tipo === "csv") r = await importarCsv(item, fd, set);
        else if (item.tipo === "pdf") r = await importarPdf(item, fd, set);
        else {
          set({ s: "enviando" });
          r = await importarOfxArquivo(empresaId, contaId, fd);
        }
        if (!r) set({ s: "erro", msg: "Pulado" });
        else if ("erro" in r) set({ s: "erro", msg: r.erro });
        else {
          ids.push(...r.ids);
          set({ s: "ok", novas: r.novas, repetidas: r.repetidas });
        }
      } catch (e) {
        setPasso(null);
        set({ s: "erro", msg: (e as Error).message || "Falha no envio." });
      }
      setFeitos((n) => n + 1);
    }
    if (ids.length) {
      try {
        const s = await sugerirAposImportacao(empresaId, ids);
        toast.success(`${ids.length} transações novas.`, {
          description: `Sugestões: ${s.regras} por regra, ${s.transferencias} transferências, ${s.ia} por IA.`,
        });
        if (s.erros.length) toast.warning(`Falhas na sugestão: ${s.erros.join("; ")}`);
      } catch (e) {
        toast.warning(`Falha na sugestão: ${(e as Error).message}`);
      }
    }
    setFase("fim");
  }

  if (passo?.tipo === "pdf") {
    return (
      <RevisaoPdfPasso
        nome={passo.arquivo.name}
        extracao={passo.extracao}
        numeroConta={contas.find((c) => c.id === contaId)?.numero ?? null}
        onConfirmar={passo.resolver}
        onPular={() => passo.resolver(null)}
      />
    );
  }
  if (passo) {
    return (
      <MapeamentoCsvPasso
        nome={passo.arquivo.name}
        bytes={passo.bytes}
        deteccao={passo.deteccao}
        inicial={passo.inicial}
        onConfirmar={(m, salvar) => passo.resolver({ m, salvar })}
        onPular={() => passo.resolver(null)}
      />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="contaBancariaId">Conta bancária</Label>
        <select id="contaBancariaId" value={contaId} onChange={(e) => setContaId(e.target.value)} disabled={fase !== "escolha"} className={selectCls}>
          <option value="" disabled>Selecione</option>
          {contas.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </select>
      </div>
      {fase === "escolha" && (
        <div className="grid gap-2">
          <Label htmlFor="arquivo">Arquivos OFX, CSV ou PDF (vários, até 4,4 MB cada)</Label>
          <Input id="arquivo" type="file" accept={ACCEPT} multiple onChange={(e) => escolher(e.target.files)} />
        </div>
      )}
      {itens.length > 0 && (
        <ul className="grid max-h-72 gap-2 overflow-y-auto text-sm">
          {itens.map((i, idx) => (
            <li key={idx} className="flex items-start justify-between gap-3 rounded-md border px-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{i.arquivo.name}</div>
                <div className="text-xs text-muted-foreground">{i.tipo?.toUpperCase()} · {fmtTamanho(i.arquivo.size)}</div>
              </div>
              <div className="shrink-0 text-right"><StatusTexto st={i.status} /></div>
            </li>
          ))}
        </ul>
      )}
      {fase !== "escolha" && (
        <div className="grid gap-1">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${(feitos / Math.max(1, total)) * 100}%` }} />
          </div>
          <div className="text-xs text-muted-foreground">
            {fase === "fim" ? "Concluído: " : ""}{feitos} de {total}
          </div>
        </div>
      )}
      {fase === "escolha" && (
        <Button onClick={importar} disabled={!contaId || validos === 0}>
          <Upload />
          Importar {validos} {validos === 1 ? "arquivo" : "arquivos"}
        </Button>
      )}
      {fase === "fim" && <Button variant="outline" onClick={fechar}>Fechar</Button>}
    </div>
  );
}

export function ImportarOfxDialog({ empresaId, contas }: { empresaId: string; contas: Conta[] }) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [fase, setFase] = useState<Fase>("escolha");
  const [passo, setPasso] = useState<Passo | null>(null);
  function onOpenChange(abrir: boolean) {
    if (fase === "importando") return; // não fecha no meio da fila (o passo tem "Pular arquivo")
    setAberta(abrir);
    if (!abrir) {
      if (fase === "fim") router.refresh();
      setFase("escolha");
    }
  }
  return (
    <Dialog open={aberta} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button disabled={contas.length === 0} />}>
        <Upload />
        Importar extrato
      </DialogTrigger>
      <DialogContent className={passo ? "max-h-[92vh] overflow-y-auto sm:max-w-5xl" : undefined}>
        <DialogHeader>
          <DialogTitle>{passo?.tipo === "pdf" ? "Revisar extrato do PDF" : passo ? "Mapear colunas do CSV" : "Importar extratos"}</DialogTitle>
        </DialogHeader>
        <Form empresaId={empresaId} contas={contas} fase={fase} setFase={setFase} passo={passo} setPasso={setPasso} fechar={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
