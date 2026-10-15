import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Carregando, PageHeader, TablePanel } from "@/components/page-header";
import { db } from "@/db";
import { planoContas } from "@/db/schema";
import { GRUPOS_DRE, NATUREZAS, PAPEIS } from "@/lib/format";
import { getEmpresa } from "../empresa";
import { ContaAcoes, type ContaLinha } from "./conta-dialogs";

const porCodigo = (a: { codigo: string }, b: { codigo: string }) =>
  a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true });

/** Próximo código livre abaixo de `pai`: último segmento + 1, mantendo o padding dos irmãos. */
function proximoCodigo(pai: ContaLinha, todas: ContaLinha[]) {
  const nivel = pai.codigo.split(".").length;
  const segs = todas
    .filter((c) => c.codigo.startsWith(pai.codigo + ".") && c.codigo.split(".").length === nivel + 1)
    .map((c) => c.codigo.split(".").at(-1)!);
  const largura = segs[0]?.length ?? (nivel >= 3 ? 2 : 1);
  const n = Math.max(0, ...segs.map(Number)) + 1;
  return `${pai.codigo}.${String(n).padStart(largura, "0")}`;
}

async function Arvore({ params, searchParams }: PageProps<"/e/[id]/plano-de-contas">) {
  await connection();
  const { id } = await params;
  const { inativas } = await searchParams;
  const mostrarInativas = inativas === "1";
  await getEmpresa(id);
  const todas: ContaLinha[] = (await db.select().from(planoContas).where(eq(planoContas.empresaId, id))).sort(porCodigo);
  const visiveis = mostrarInativas ? todas : todas.filter((c) => c.ativa);

  return (
    <>
      <PageHeader
        title="Plano de contas"
        description={DESCRICAO}
        actions={
          <Link
            href={mostrarInativas ? `/e/${id}/plano-de-contas` : `/e/${id}/plano-de-contas?inativas=1`}
            className={buttonVariants({ variant: "outline" })}
          >
            {mostrarInativas ? <EyeOff /> : <Eye />}
            {mostrarInativas ? "Ocultar inativas" : "Mostrar inativas"}
          </Link>
        }
      />
      <TablePanel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">Código</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Classificação</TableHead>
              <TableHead className="w-24 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.map((c) => {
              const nivel = c.codigo.split(".").length;
              const sintetica = c.tipo === "sintetica";
              return (
                <TableRow key={c.id} className={cn(!c.ativa && "text-muted-foreground", nivel === 1 && "bg-muted/30")}>
                  <TableCell className={cn("py-1.5 font-mono text-xs text-muted-foreground", nivel === 1 && "text-foreground")}>{c.codigo}</TableCell>
                  <TableCell
                    className={cn("py-1.5", sintetica && "font-semibold", nivel === 1 && "text-[15px]")}
                    style={{ paddingLeft: `${(nivel - 1) * 1.25 + 0.75}rem` }}
                  >
                    {c.nome}
                    {!c.ativa && <Badge variant="muted" className="ml-2 font-normal">inativa</Badge>}
                  </TableCell>
                  <TableCell className="py-1.5">
                    {!sintetica && (
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={c.natureza === "D" ? "info" : "violet"}>{NATUREZAS[c.natureza]}</Badge>
                        {c.grupoDre && <Badge variant="muted">{GRUPOS_DRE[c.grupoDre]}</Badge>}
                        {c.papel && <Badge variant="brand">{PAPEIS[c.papel]}</Badge>}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="py-1.5">
                    <ContaAcoes empresaId={id} conta={c} codigoSugerido={proximoCodigo(c, todas)} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TablePanel>
    </>
  );
}

const DESCRICAO = "Só contas analíticas recebem lançamentos. Contas não são excluídas, apenas inativadas.";

export default function PlanoDeContasPage(props: PageProps<"/e/[id]/plano-de-contas">) {
  return (
    <Suspense fallback={<><PageHeader title="Plano de contas" description={DESCRICAO} /><Carregando /></>}>
      <Arvore {...props} />
    </Suspense>
  );
}
