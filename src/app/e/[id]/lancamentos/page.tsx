import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { BookOpen, Plus, Search, X } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Carregando, EmptyState, FilterField, PageHeader, TablePanel, Toolbar } from "@/components/page-header";
import { ORIGEM_BADGE, fmtData, fmtValor, hoje, isoData, primeiroDiaDoMes } from "@/lib/format";
import { getEmpresa } from "../empresa";
import { ORIGENS, listarLancamentos, type Origem } from "./queries";

const selectCls =
  "h-9 cursor-pointer rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function ultimoDiaDoMes(d: string) {
  const [y, m] = d.split("-").map(Number);
  return `${d.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

const novoBtn = (id: string) => (
  <Link href={`/e/${id}/lancamentos/novo`} className={buttonVariants()}>
    <Plus />
    Novo lançamento
  </Link>
);

async function Lista({ params, searchParams }: PageProps<"/e/[id]/lancamentos">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  await getEmpresa(id);
  const de = isoData(sp.de) ?? primeiroDiaDoMes(hoje());
  const ate = isoData(sp.ate) ?? ultimoDiaDoMes(de);
  const texto = typeof sp.texto === "string" ? sp.texto.trim() : "";
  const origem = typeof sp.origem === "string" && sp.origem in ORIGENS ? (sp.origem as Origem) : undefined;
  const semDocMin = Number(sp.semdoc) > 0 ? Number(sp.semdoc) : undefined;
  const lista = await listarLancamentos(id, { de, ate, texto, origem, semDocMin });

  return (
    <>
      <PageHeader
        title="Lançamentos"
        description="Partidas dobradas aprovadas. Lançamentos não são excluídos: corrija com estorno."
        actions={novoBtn(id)}
      />
      <Toolbar>
        <form className="contents">
          {semDocMin && <input type="hidden" name="semdoc" value={semDocMin} />}
          <FilterField label="De">
            <Input type="date" name="de" defaultValue={de} className="w-40" />
          </FilterField>
          <FilterField label="Até">
            <Input type="date" name="ate" defaultValue={ate} className="w-40" />
          </FilterField>
          <FilterField label="Histórico" className="min-w-48 flex-1">
            <Input name="texto" defaultValue={texto} placeholder="Buscar no histórico" />
          </FilterField>
          <FilterField label="Origem">
            <select name="origem" defaultValue={origem ?? ""} className={selectCls}>
              <option value="">Todas</option>
              {Object.entries(ORIGENS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </FilterField>
          <Button type="submit" variant="outline">
            <Search />
            Filtrar
          </Button>
          {semDocMin && (
            <Link href={`/e/${id}/lancamentos?de=${de}&ate=${ate}`} className={buttonVariants({ variant: "ghost" })}>
              <X />
              Sem documento ≥ R$ {fmtValor(semDocMin)}
            </Link>
          )}
        </form>
      </Toolbar>

      {lista.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Nenhum lançamento no período"
          hint={`Entre ${fmtData(de)} e ${fmtData(ate)} não há lançamentos com esses filtros.`}
          action={novoBtn(id)}
        />
      ) : (
        <TablePanel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16 text-right">Nº</TableHead>
                <TableHead className="w-28">Data</TableHead>
                <TableHead>Histórico</TableHead>
                <TableHead>Débitos</TableHead>
                <TableHead>Créditos</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((l) => {
                const estornado = l.status === "estornado";
                return (
                  <TableRow key={l.id} className={cn(estornado && "text-muted-foreground")}>
                    <TableCell className="text-right text-muted-foreground">
                      <Link href={`/e/${id}/lancamentos/${l.id}`} className="hover:text-primary hover:underline">
                        {l.numero}
                      </Link>
                    </TableCell>
                    <TableCell>{fmtData(l.data)}</TableCell>
                    <TableCell className="max-w-56 truncate xl:max-w-80">
                      <Link
                        href={`/e/${id}/lancamentos/${l.id}`}
                        className={cn("font-medium hover:text-primary hover:underline", estornado && "line-through decoration-muted-foreground/50")}
                      >
                        {l.historico}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-36 font-mono text-xs whitespace-normal text-muted-foreground">{l.debitos}</TableCell>
                    <TableCell className="max-w-36 font-mono text-xs whitespace-normal text-muted-foreground">{l.creditos}</TableCell>
                    <TableCell className={cn("text-right font-medium", estornado && "line-through decoration-muted-foreground/50")}>
                      {fmtValor(l.valor)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ORIGEM_BADGE[l.origem]}>{ORIGENS[l.origem]}</Badge>
                    </TableCell>
                    <TableCell>
                      {estornado ? <Badge variant="muted" className="line-through">Estornado</Badge> : <Badge variant="success">Aprovado</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TablePanel>
      )}
    </>
  );
}

export default function LancamentosPage(props: PageProps<"/e/[id]/lancamentos">) {
  return (
    <Suspense fallback={<><PageHeader title="Lançamentos" /><Carregando /></>}>
      <Lista {...props} />
    </Suspense>
  );
}
