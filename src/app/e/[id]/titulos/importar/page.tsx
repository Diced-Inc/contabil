import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db";
import { Carregando, PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { contrapartidasLembradas } from "@/lib/notas/registro";
import { listarMesesFechados } from "../../conciliacao/queries";
import { getEmpresa } from "../../empresa";
import { listarContasAnaliticas } from "../../lancamentos/queries";
import { ImportarNotas } from "./importar-notas";

const DESCRICAO = "XML de NF-e (modelo 55) e de NFS-e (padrão nacional ou municipal ABRASF), vários de uma vez ou em .zip. Revise antes de registrar.";

async function Importar({ params }: PageProps<"/e/[id]/titulos/importar">) {
  await connection();
  const { id } = await params;
  const empresa = await getEmpresa(id);
  const [contas, fechados, lembradas] = await Promise.all([listarContasAnaliticas(id), listarMesesFechados(id), contrapartidasLembradas(db, id)]);
  return (
    <>
      <PageHeader title="Importar notas fiscais" description={DESCRICAO}
        actions={<Link href={`/e/${id}/titulos`} className={buttonVariants({ variant: "ghost" })}><ArrowLeft />Títulos</Link>} />
      <ImportarNotas empresaId={id} cnpj={empresa.cnpj} contas={contas} fechados={fechados} lembradas={lembradas} />
    </>
  );
}

export default function ImportarPage(props: PageProps<"/e/[id]/titulos/importar">) {
  return (
    <Suspense fallback={<><PageHeader title="Importar notas fiscais" description={DESCRICAO} /><Carregando /></>}>
      <Importar {...props} />
    </Suspense>
  );
}
