import { Suspense } from "react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  const { id } = await params;
  const { inativas } = await searchParams;
  const mostrarInativas = inativas === "1";
  await getEmpresa(id);
  const todas: ContaLinha[] = (await db.select().from(planoContas).where(eq(planoContas.empresaId, id))).sort(porCodigo);
  const visiveis = mostrarInativas ? todas : todas.filter((c) => c.ativa);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Link
          href={mostrarInativas ? `/e/${id}/plano-de-contas` : `/e/${id}/plano-de-contas?inativas=1`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {mostrarInativas ? <EyeOff /> : <Eye />}
          {mostrarInativas ? "Ocultar inativas" : "Mostrar inativas"}
        </Link>
      </div>
      <Table className="text-sm">
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">Código</TableHead>
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
              <TableRow key={c.id} className={cn(!c.ativa && "text-muted-foreground")}>
                <TableCell className={cn("py-1 tabular-nums", sintetica && "font-semibold")}>{c.codigo}</TableCell>
                <TableCell className={cn("py-1", sintetica && "font-semibold")} style={{ paddingLeft: `${(nivel - 1) * 1.25 + 0.5}rem` }}>
                  {c.nome}
                  {!c.ativa && <span className="ml-2 text-xs">(inativa)</span>}
                </TableCell>
                <TableCell className="py-1">
                  {!sintetica && (
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline">{NATUREZAS[c.natureza]}</Badge>
                      {c.grupoDre && <Badge variant="secondary">{GRUPOS_DRE[c.grupoDre]}</Badge>}
                      {c.papel && <Badge>{PAPEIS[c.papel]}</Badge>}
                    </div>
                  )}
                </TableCell>
                <TableCell className="py-1">
                  <ContaAcoes empresaId={id} conta={c} codigoSugerido={proximoCodigo(c, todas)} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}

export default function PlanoDeContasPage(props: PageProps<"/e/[id]/plano-de-contas">) {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Plano de contas</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Só contas analíticas recebem lançamentos. Contas não são excluídas, apenas inativadas.
      </p>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
        <Arvore {...props} />
      </Suspense>
    </div>
  );
}
