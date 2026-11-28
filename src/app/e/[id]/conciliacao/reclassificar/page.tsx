import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { Carregando, PageHeader } from "@/components/page-header";
import { db } from "@/db";
import { planoContas } from "@/db/schema";
import { listarLotes } from "@/lib/reclassificacao-registro";
import { getEmpresa } from "../../empresa";
import { listarContasBancarias } from "../queries";
import { ReclassificarLote } from "./reclassificar-lote";

// 50+ itens, cada um estorno + novo na sua transação do Postgres
export const maxDuration = 300;

const DESCRICAO =
  "Filtre as transações já conciliadas, escolha o destino e confira a prévia: cada uma vira estorno do lançamento atual + lançamento novo, no mês original (aberto), com o motivo no histórico.";

async function Conteudo({ params }: PageProps<"/e/[id]/conciliacao/reclassificar">) {
  await connection();
  const { id } = await params;
  await getEmpresa(id);
  const [contas, bancos, lotes] = await Promise.all([
    // todas as analíticas: o estorno pode usar conta já inativada (a prévia mostra o nome)
    db.select({ id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome, papel: planoContas.papel, ativa: planoContas.ativa })
      .from(planoContas).where(and(eq(planoContas.empresaId, id), eq(planoContas.tipo, "analitica"))).orderBy(asc(planoContas.codigo)),
    listarContasBancarias(id),
    listarLotes(db, id),
  ]);
  return (
    <>
      <Link href={`/e/${id}/conciliacao?ver=conciliadas`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Voltar para as conciliadas
      </Link>
      <ReclassificarLote empresaId={id} contas={contas} bancos={bancos} lotes={lotes} />
    </>
  );
}

export default function ReclassificarPage(props: PageProps<"/e/[id]/conciliacao/reclassificar">) {
  return (
    <>
      <PageHeader title="Reclassificar em lote" description={DESCRICAO} />
      <Suspense fallback={<Carregando />}>
        <Conteudo {...props} />
      </Suspense>
    </>
  );
}
