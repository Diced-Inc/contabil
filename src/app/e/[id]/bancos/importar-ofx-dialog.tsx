"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { importarOfxArquivo, sugerirAposImportacao } from "@/actions/bancos";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const selectCls =
  "h-9 w-full cursor-pointer rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

// Igual ao MAX_OFX do servidor (bytes decimais): uma requisição por arquivo, abaixo dos 4,5 MB da Vercel.
const MAX_OFX = 4_400_000;
const GRANDE = "Arquivo maior que 4,4 MB";

type Status =
  | { s: "fila" }
  | { s: "enviando" }
  | { s: "ok"; novas: number; repetidas: number }
  | { s: "erro"; msg: string };
type Item = { arquivo: File; status: Status };

const fmtTamanho = (b: number) =>
  b < 1_000_000 ? `${Math.max(1, Math.round(b / 1000))} KB` : `${(b / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

function StatusTexto({ st }: { st: Status }) {
  if (st.s === "fila") return <span className="text-muted-foreground">Na fila</span>;
  if (st.s === "enviando") return <span className="text-muted-foreground">Enviando...</span>;
  if (st.s === "ok") return <span className="text-emerald-600 dark:text-emerald-400">{st.novas} novas, {st.repetidas} repetidas</span>;
  return (
    <span className="text-destructive">
      {st.msg}
      {st.msg === GRANDE && <span className="block text-xs text-muted-foreground">Exporte o OFX por período menor.</span>}
    </span>
  );
}

type Fase = "escolha" | "importando" | "fim";

function Form({ empresaId, contas, fase, setFase, fechar }: {
  empresaId: string; contas: { id: string; nome: string }[]; fase: Fase; setFase: (f: Fase) => void; fechar: () => void;
}) {
  const [contaId, setContaId] = useState(contas.length === 1 ? contas[0].id : "");
  const [itens, setItens] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [feitos, setFeitos] = useState(0);
  const validos = itens.filter((i) => i.status.s === "fila").length;

  function escolher(files: FileList | null) {
    setItens(
      Array.from(files ?? []).map((arquivo) => ({
        arquivo,
        status: arquivo.size > MAX_OFX ? { s: "erro", msg: GRANDE } : { s: "fila" },
      })),
    );
  }

  async function importar() {
    setFase("importando");
    setTotal(validos);
    setFeitos(0);
    const set = (idx: number, status: Status) => setItens((xs) => xs.map((x, j) => (j === idx ? { ...x, status } : x)));
    const ids: string[] = [];
    // Sequencial de propósito: arquivos da mesma conta em paralelo disputariam lock no banco.
    for (const [idx, item] of itens.entries()) {
      if (item.status.s !== "fila") continue;
      set(idx, { s: "enviando" });
      const fd = new FormData();
      fd.set("arquivo", item.arquivo);
      try {
        const r = await importarOfxArquivo(empresaId, contaId, fd);
        if ("erro" in r) set(idx, { s: "erro", msg: r.erro });
        else {
          ids.push(...r.ids);
          set(idx, { s: "ok", novas: r.novas, repetidas: r.repetidas });
        }
      } catch (e) {
        set(idx, { s: "erro", msg: (e as Error).message || "Falha no envio." });
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
          <Label htmlFor="arquivo">Arquivos OFX (vários, até 4,4 MB cada)</Label>
          <Input id="arquivo" type="file" accept=".ofx" multiple onChange={(e) => escolher(e.target.files)} />
        </div>
      )}
      {itens.length > 0 && (
        <ul className="grid max-h-72 gap-2 overflow-y-auto text-sm">
          {itens.map((i, idx) => (
            <li key={idx} className="flex items-start justify-between gap-3 rounded-md border px-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{i.arquivo.name}</div>
                <div className="text-xs text-muted-foreground">{fmtTamanho(i.arquivo.size)}</div>
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

export function ImportarOfxDialog({ empresaId, contas }: { empresaId: string; contas: { id: string; nome: string }[] }) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [fase, setFase] = useState<Fase>("escolha");
  function onOpenChange(abrir: boolean) {
    if (fase === "importando") return; // não fecha no meio da fila
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
        Importar OFX
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar extratos OFX</DialogTitle>
        </DialogHeader>
        <Form empresaId={empresaId} contas={contas} fase={fase} setFase={setFase} fechar={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
