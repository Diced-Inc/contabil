import { Suspense } from "react";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { planoContas } from "@/db/schema";
import { Carregando, PageHeader } from "@/components/page-header";
import { cents, hoje } from "@/lib/format";
import { aberturaAtiva, extratosParaAbertura, primeiroMovimento } from "@/lib/abertura-registro";
import { mesesFechados } from "@/lib/lancamentos";
import { compararCodigo } from "@/lib/relatorios/hierarquia";
import { getEmpresa } from "../../empresa";
import { SaldosIniciais } from "./saldos-iniciais";

/** Véspera de "YYYY-MM-DD". */
const vespera = (d: string) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) - 1)).toISOString().slice(0, 10);

async function Conteudo({ params }: PageProps<"/e/[id]/lancamentos/saldos-iniciais">) {
  await connection();
  const { id } = await params;
  await getEmpresa(id);
  const [contas, atual, primeiro, extratos, fechados] = await Promise.all([
    db.select({ id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome, natureza: planoContas.natureza, tipo: planoContas.tipo, ativa: planoContas.ativa })
      .from(planoContas).where(eq(planoContas.empresaId, id)),
    aberturaAtiva(db, id),
    primeiroMovimento(db, id),
    extratosParaAbertura(id),
    mesesFechados(db, id),
  ]);
  const saldos: Record<string, number> = {};
  for (const p of atual?.partidas ?? []) saldos[p.contaId] = (saldos[p.contaId] ?? 0) + cents(p.debito) - cents(p.credito);
  const data = atual?.data ?? (primeiro ? vespera(primeiro) : hoje());
  return (
    <SaldosIniciais
      empresaId={id}
      contas={contas.filter((c) => c.ativa).sort((a, b) => compararCodigo(a.codigo, b.codigo))}
      atual={atual ? { numero: atual.numero, data: atual.data, id: atual.id } : null}
      inicial={{ data, saldos }}
      primeiroMovimento={primeiro}
      extratos={extratos}
      fechados={[...fechados]}
    />
  );
}

export default function SaldosIniciaisPage(props: PageProps<"/e/[id]/lancamentos/saldos-iniciais">) {
  return (
    <div>
      <PageHeader
        title="Saldos iniciais"
        description="Balancete do último dia antes do início da escrituração: um lançamento de abertura com os saldos do Ativo, Passivo e PL."
      />
      <Suspense fallback={<Carregando />}>
        <Conteudo {...props} />
      </Suspense>
    </div>
  );
}
