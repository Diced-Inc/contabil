"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Wrench } from "lucide-react";
import { toast } from "sonner";
import { corrigirEstornosAction } from "@/actions/reclassificacao";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { CorrecaoEstorno } from "@/lib/checagem";
import { cents, fmtCompetencia, fmtData, fmtValor, fromCents } from "@/lib/format";

/** Prévia (o que cada par vira) e o efeito por competência; corrige os pares sem bloqueio, cada um na sua transação. */
export function CorrigirEstornos({ empresaId, correcoes }: { empresaId: string; correcoes: CorrecaoEstorno[] }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pendente, iniciar] = useTransition();
  const [marcados, setMarcados] = useState(() => new Set(correcoes.filter((c) => !c.bloqueio).map((c) => c.estornoId)));
  const ok = correcoes.filter((c) => !c.bloqueio && marcados.has(c.estornoId));
  const marcar = (id: string, v: boolean) => setMarcados((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; });
  // a correção tira o original da competência dele (− valor) e devolve no mês do estorno (+ valor), em módulo
  const porMes = new Map<string, number>();
  for (const c of ok) {
    porMes.set(c.original.competencia, (porMes.get(c.original.competencia) ?? 0) - cents(c.valor));
    porMes.set(c.estorno.competencia, (porMes.get(c.estorno.competencia) ?? 0) + cents(c.valor));
  }
  const enviar = () => iniciar(async () => {
    const r = await corrigirEstornosAction(empresaId, motivo, ok.map((c) => c.estornoId));
    if ("erro" in r) return void toast.error(r.erro);
    if (r.erros.length) toast.error(`${r.erros.length} com erro`, { description: r.erros.slice(0, 5).map((e) => `${e.memo}: ${e.motivo}`).join("\n") });
    toast.success(`${r.feitas} estorno(s) corrigido(s)${r.puladas.length ? `, ${r.puladas.length} já corrigido(s)` : ""}.`);
    setAberto(false);
    router.refresh();
  });
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger render={<Button variant="outline" size="sm" disabled={correcoes.every((c) => c.bloqueio)} />}>
        <Wrench />
        Corrigir
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Corrigir estornos fora do mês do original</DialogTitle>
          <DialogDescription>
            Para cada par marcado: estorna o estorno na data e competência dele e lança o estorno de novo na data e competência do original.
            O original e o estorno passam a se anular no mesmo mês; nada é editado ou apagado. Os dois lançamentos levam o motivo e o mesmo lote.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-64 overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Original</TableHead>
                <TableHead>Estorno hoje</TableHead>
                <TableHead>Estorno corrigido</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {correcoes.map((c) => (
                <TableRow key={c.estornoId} className={c.bloqueio ? "text-muted-foreground" : undefined}>
                  <TableCell>
                    <Checkbox aria-label={`Corrigir o estorno nº ${c.estorno.numero}`} disabled={!!c.bloqueio}
                      checked={!c.bloqueio && marcados.has(c.estornoId)} onCheckedChange={(v) => marcar(c.estornoId, !!v)} />
                  </TableCell>
                  <TableCell>nº {c.original.numero} · {fmtData(c.original.data)}</TableCell>
                  <TableCell>nº {c.estorno.numero} · {fmtCompetencia(c.estorno.competencia)}</TableCell>
                  <TableCell>{c.bloqueio ?? `${fmtData(c.original.data)} · ${fmtCompetencia(c.original.competencia)}`}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtValor(c.valor)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Efeito por competência (valor dos lançamentos originais):{" "}
          {[...porMes].sort().map(([m, v]) => `${fmtCompetencia(m)} ${v < 0 ? "−" : "+"}R$ ${fmtValor(fromCents(Math.abs(v)))}`).join(" · ")}
          . No mês do original, sai a contagem em dobro; no mês do estorno, volta o que ele tirava.
        </p>
        <div className="grid gap-2">
          <Label htmlFor="motivo-correcao">Motivo</Label>
          <Textarea id="motivo-correcao" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder="ex.: reclassificação de 20/10 deixou o estorno em outubro e o novo em setembro" />
        </div>
        <Button onClick={enviar} disabled={pendente || !ok.length || motivo.trim().length < 5}>
          <Wrench />
          {pendente ? "Corrigindo..." : `Corrigir ${ok.length} par(es)`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
