import { Suspense } from "react";
import { connection } from "next/server";
import { criarLancamentoManual } from "@/actions/lancamentos";
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
      <h1 className="mb-4 text-2xl font-semibold">Novo lançamento</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
        <Novo {...props} />
      </Suspense>
    </div>
  );
}
