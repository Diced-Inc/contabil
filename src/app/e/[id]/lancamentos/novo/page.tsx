import { Suspense } from "react";
import { connection } from "next/server";
import { criarLancamentoManual } from "@/actions/lancamentos";
import { Carregando, PageHeader } from "@/components/page-header";
import { getEmpresa } from "../../empresa";
import { listarContasAnaliticas } from "../queries";
import { NovoComModelo } from "./modelos";

async function Novo({ params }: PageProps<"/e/[id]/lancamentos/novo">) {
  await connection();
  const { id } = await params;
  await getEmpresa(id);
  const contas = await listarContasAnaliticas(id);
  return <NovoComModelo empresaId={id} action={criarLancamentoManual.bind(null, id)} contas={contas} voltar={`/e/${id}/lancamentos`} />;
}

export default function NovoLancamentoPage(props: PageProps<"/e/[id]/lancamentos/novo">) {
  return (
    <div>
      <PageHeader title="Novo lançamento" description="Lançamento manual em partidas dobradas, em branco ou a partir de um modelo. Débitos e créditos precisam fechar." />
      <Suspense fallback={<Carregando />}>
        <Novo {...props} />
      </Suspense>
    </div>
  );
}
