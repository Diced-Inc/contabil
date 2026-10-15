import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtData, fmtValor, hoje, isoData, primeiroDiaDoMes } from "@/lib/format";
import { getEmpresa } from "../empresa";
import { ORIGENS, listarLancamentos, type Origem } from "./queries";

const selectCls =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function ultimoDiaDoMes(d: string) {
  const [y, m] = d.split("-").map(Number);
  return `${d.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

async function Lista({ params, searchParams }: PageProps<"/e/[id]/lancamentos">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  await getEmpresa(id);
  const de = isoData(sp.de) ?? primeiroDiaDoMes(hoje());
  const ate = isoData(sp.ate) ?? ultimoDiaDoMes(de);
  const texto = typeof sp.texto === "string" ? sp.texto.trim() : "";
  const origem = typeof sp.origem === "string" && sp.origem in ORIGENS ? (sp.origem as Origem) : undefined;
  const lista = await listarLancamentos(id, { de, ate, texto, origem });

  return (
    <>
      <form className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">De</span>
          <Input type="date" name="de" defaultValue={de} className="w-36" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Até</span>
          <Input type="date" name="ate" defaultValue={ate} className="w-36" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Histórico</span>
          <Input name="texto" defaultValue={texto} placeholder="Buscar no histórico" className="w-56" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Origem</span>
          <select name="origem" defaultValue={origem ?? ""} className={selectCls}>
            <option value="">Todas</option>
            {Object.entries(ORIGENS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline">
          <Search />
          Filtrar
        </Button>
        <Link href={`/e/${id}/lancamentos/novo`} className={cn(buttonVariants(), "ml-auto")}>
          <Plus />
          Novo lançamento
        </Link>
      </form>

      {lista.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum lançamento no período.</p>
      ) : (
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead className="w-16 text-right">Nº</TableHead>
              <TableHead className="w-24">Data</TableHead>
              <TableHead>Histórico</TableHead>
              <TableHead>Débitos</TableHead>
              <TableHead>Créditos</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((l) => (
              <TableRow key={l.id} className={cn(l.status === "estornado" && "text-muted-foreground")}>
                <TableCell className="py-1.5 text-right tabular-nums">
                  <Link href={`/e/${id}/lancamentos/${l.id}`} className="underline-offset-4 hover:underline">
                    {l.numero}
                  </Link>
                </TableCell>
                <TableCell className="py-1.5">{fmtData(l.data)}</TableCell>
                <TableCell className="max-w-80 truncate py-1.5">
                  <Link href={`/e/${id}/lancamentos/${l.id}`} className="hover:underline">
                    {l.historico}
                  </Link>
                </TableCell>
                <TableCell className="py-1.5 tabular-nums">{l.debitos}</TableCell>
                <TableCell className="py-1.5 tabular-nums">{l.creditos}</TableCell>
                <TableCell className="py-1.5 text-right tabular-nums">{fmtValor(l.valor)}</TableCell>
                <TableCell className="py-1.5">
                  <Badge variant="secondary">{ORIGENS[l.origem]}</Badge>
                </TableCell>
                <TableCell className="py-1.5">
                  <Badge variant={l.status === "estornado" ? "destructive" : "outline"}>
                    {l.status === "estornado" ? "Estornado" : "Aprovado"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

export default function LancamentosPage(props: PageProps<"/e/[id]/lancamentos">) {
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Lançamentos</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
        <Lista {...props} />
      </Suspense>
    </div>
  );
}
