import { Suspense } from "react";
import { connection } from "next/server";
import { criarLancamentoManual } from "@/actions/lancamentos";
import { Carregando, PageHeader } from "@/components/page-header";
import { getEmpresa } from "../../empresa";
import { FormLancamento } from "../form-lancamento";
import { listarContasAnaliticas } from "../queries";

async function Novo({ params }: PageProps<"/e/[id]/lancamentos/novo">) {
  await connection();
  const { id } = await params;
  await getEmpresa(id);
  const contas = await listarContasAnaliticas(id);
  return <FormLancamento action={criarLancamentoManual.bind(null, id)} contas={contas} voltar={`/e/${id}/lancamentos`} />;
}

export default function NovoLancamentoPage(props: PageProps<"/e/[id]/lancamentos/novo">) {
  return (
    <div>
      <PageHeader title="Novo lançamento" description="Lançamento manual em partidas dobradas. Débitos e créditos precisam fechar." />
      <Suspense fallback={<Carregando />}>
        <Novo {...props} />
      </Suspense>
    </div>
  );
}
