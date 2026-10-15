"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { aprovarEmLote, reativarTransacao, sugerirComIA } from "@/actions/conciliacao";
import type { ContaOpcao } from "@/components/conta-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Valor } from "@/components/valor";
import { fmtData } from "@/lib/format";
import { PainelTransacao } from "./painel-transacao";
import type { TituloAberto, TransacaoLinha } from "./queries";

const aprovavel = (t: TransacaoLinha) =>
  (t.sugestaoOrigem === "regra" && !!t.sugestaoContaId) || (t.sugestaoOrigem === "transferencia" && !!t.transferenciaParId);

function Sugestao({ t }: { t: TransacaoLinha }) {
  if (!t.sugestaoOrigem) return <Badge variant="outline" className="text-muted-foreground">Sem sugestão</Badge>;
  const badge =
    t.sugestaoOrigem === "regra" ? (
      <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200">Regra</Badge>
    ) : t.sugestaoOrigem === "transferencia" ? (
      <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200">Transf.</Badge>
    ) : (
      <Badge variant="secondary">IA {Number(t.sugestaoConfianca ?? 0).toFixed(2).replace(".", ",")}</Badge>
    );
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate" title={t.sugestaoNome ?? undefined}>
        <span className="tabular-nums text-muted-foreground">{t.sugestaoCodigo}</span> {t.sugestaoNome}
      </span>
      {badge}
    </span>
  );
}

export function ConciliacaoLista({ empresaId, transacoes, todas, contas, titulos }: {
  empresaId: string;
  transacoes: TransacaoLinha[];
  todas: TransacaoLinha[];
  contas: ContaOpcao[];
  titulos: TituloAberto[];
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [aberta, setAberta] = useState<TransacaoLinha | null>(null);
  const [pendente, iniciar] = useTransition();
  const visiveis = new Set(transacoes.map((t) => t.id));
  const selecionadas = [...sel].filter((id) => visiveis.has(id));
  const aprovaveis = transacoes.filter(aprovavel);
  const contagem = (o: string | null) => transacoes.filter((t) => t.sugestaoOrigem === o).length;

  const alternar = (id: string, marcado: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (marcado) n.add(id);
      else n.delete(id);
      return n;
    });

  const aprovar = () =>
    iniciar(async () => {
      const r = await aprovarEmLote(empresaId, selecionadas);
      if (r.aprovadas) toast.success(`${r.aprovadas} transação(ões) aprovada(s).`);
      if (r.erros.length) toast.error(`${r.erros.length} com erro`, { description: r.erros.slice(0, 5).join("\n") });
      setSel(new Set());
      router.refresh();
    });

  const sugerir = () =>
    iniciar(async () => {
      const r = await sugerirComIA(empresaId);
      toast.success(`Sugestões: ${r.regras} por regra, ${r.transferencias} transferência(s), ${r.ia} pela IA.`);
      if (r.erros.length) toast.error(`${r.erros.length} erro(s) na sugestão`, { description: r.erros.slice(0, 5).join("\n") });
      router.refresh();
    });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Button onClick={aprovar} disabled={pendente || selecionadas.length === 0}>
          <CheckCheck />
          Aprovar selecionadas ({selecionadas.length})
        </Button>
        <Button variant="outline" onClick={sugerir} disabled={pendente}>
          <Sparkles />
          {pendente ? "Processando..." : "Sugerir com IA"}
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {transacoes.length} pendentes: {contagem("regra")} regra, {contagem("transferencia")} transf., {contagem("ia")} IA,{" "}
          {contagem(null)} sem sugestão
        </span>
      </div>
      {transacoes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma transação pendente.</p>
      ) : (
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  aria-label="Selecionar aprováveis"
                  disabled={aprovaveis.length === 0}
                  checked={aprovaveis.length > 0 && aprovaveis.every((t) => sel.has(t.id))}
                  onCheckedChange={(c) => setSel(c ? new Set(aprovaveis.map((t) => t.id)) : new Set())}
                />
              </TableHead>
              <TableHead className="w-24">Data</TableHead>
              <TableHead className="w-40">Conta</TableHead>
              <TableHead>Memo</TableHead>
              <TableHead className="w-32 text-right">Valor</TableHead>
              <TableHead className="w-80">Sugestão</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {transacoes.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="py-1.5">
                  <Checkbox
                    aria-label="Selecionar"
                    disabled={!aprovavel(t)}
                    checked={sel.has(t.id)}
                    onCheckedChange={(c) => alternar(t.id, !!c)}
                  />
                </TableCell>
                <TableCell className="py-1.5 tabular-nums">{fmtData(t.data)}</TableCell>
                <TableCell className="max-w-40 truncate py-1.5">{t.contaBancariaNome}</TableCell>
                <TableCell className="max-w-96 truncate py-1.5" title={t.memo}>{t.memo}</TableCell>
                <TableCell className="py-1.5 text-right"><Valor v={t.valor} /></TableCell>
                <TableCell className="max-w-80 py-1.5"><Sugestao t={t} /></TableCell>
                <TableCell className="py-1.5 text-right">
                  <Button size="sm" variant="outline" onClick={() => setAberta(t)}>Revisar</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <PainelTransacao
        key={aberta?.id ?? "nenhuma"}
        empresaId={empresaId}
        transacao={aberta}
        onClose={() => setAberta(null)}
        todas={todas}
        contas={contas}
        titulos={titulos}
      />
    </>
  );
}

export function Ignoradas({ empresaId, transacoes }: { empresaId: string; transacoes: TransacaoLinha[] }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const reativar = (id: string) =>
    iniciar(async () => {
      const r = await reativarTransacao(empresaId, id);
      if (r.erro) return void toast.error(r.erro);
      toast.success("Transação reativada.");
      router.refresh();
    });
  if (!transacoes.length) return <p className="text-sm text-muted-foreground">Nenhuma transação ignorada.</p>;
  return (
    <Table className="text-sm">
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">Data</TableHead>
          <TableHead className="w-40">Conta</TableHead>
          <TableHead>Memo</TableHead>
          <TableHead className="w-32 text-right">Valor</TableHead>
          <TableHead>Motivo</TableHead>
          <TableHead className="w-28" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {transacoes.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="py-1.5 tabular-nums">{fmtData(t.data)}</TableCell>
            <TableCell className="max-w-40 truncate py-1.5">{t.contaBancariaNome}</TableCell>
            <TableCell className="max-w-96 truncate py-1.5" title={t.memo}>{t.memo}</TableCell>
            <TableCell className="py-1.5 text-right"><Valor v={t.valor} /></TableCell>
            <TableCell className="max-w-64 truncate py-1.5 text-muted-foreground">{t.sugestaoJustificativa}</TableCell>
            <TableCell className="py-1.5 text-right">
              <Button size="sm" variant="outline" disabled={pendente} onClick={() => reativar(t.id)}>
                <RotateCcw />
                Reativar
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
