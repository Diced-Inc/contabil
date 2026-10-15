import { Suspense } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getEmpresa } from "../empresa";
import { listarContasAnaliticas } from "../lancamentos/queries";
import { ConciliacaoLista, Ignoradas } from "./conciliacao-toolbar";
import { listarContasBancarias, listarTitulosAbertos, listarTransacoes } from "./queries";

const selectCls =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const ORIGENS = { regra: "Regra", transferencia: "Transferência", ia: "IA", sem: "Sem sugestão" } as const;
const str = (s: unknown) => (typeof s === "string" ? s.trim() : "");
const isoData = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "");

async function Conciliacao({ params, searchParams }: PageProps<"/e/[id]/conciliacao">) {
  const { id } = await params;
  const sp = await searchParams;
  await getEmpresa(id);
  const ver = sp.ver === "ignoradas" ? "ignoradas" : "pendentes";
  const f = {
    conta: str(sp.conta), de: isoData(sp.de), ate: isoData(sp.ate), q: str(sp.q).toLowerCase(),
    origem: str(sp.origem) in ORIGENS ? (str(sp.origem) as keyof typeof ORIGENS) : "",
  };
  const [pendentes, ignoradas, bancos] = await Promise.all([
    listarTransacoes(id, "pendente"),
    listarTransacoes(id, "ignorada"),
    listarContasBancarias(id),
  ]);
  // ponytail: filtro em memória; levar para o SQL se a fila passar de alguns milhares
  const filtrar = (ts: typeof pendentes) =>
    ts.filter(
      (t) =>
        (!f.conta || t.contaBancariaId === f.conta) &&
        (!f.de || t.data >= f.de) &&
        (!f.ate || t.data <= f.ate) &&
        (!f.q || t.memo.toLowerCase().includes(f.q)) &&
        (!f.origem || (f.origem === "sem" ? !t.sugestaoOrigem : t.sugestaoOrigem === f.origem)),
    );
  const aba = (v: string, rotulo: string, n: number) => (
    <Link
      href={v === "ignoradas" ? `/e/${id}/conciliacao?ver=ignoradas` : `/e/${id}/conciliacao`}
      className={cn("rounded-md px-3 py-1 text-muted-foreground", v === ver && "bg-background font-medium text-foreground shadow-sm")}
    >
      {rotulo} ({n})
    </Link>
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <nav className="inline-flex rounded-lg bg-muted p-[3px]">
          {aba("pendentes", "Pendentes", pendentes.length)}
          {aba("ignoradas", "Ignoradas", ignoradas.length)}
        </nav>
        <form className="ml-auto flex flex-wrap items-end gap-2">
          {ver === "ignoradas" && <input type="hidden" name="ver" value="ignoradas" />}
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">Conta</span>
            <select name="conta" defaultValue={f.conta} className={selectCls}>
              <option value="">Todas</option>
              {bancos.map((b) => (
                <option key={b.id} value={b.id}>{b.nome}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">De</span>
            <Input type="date" name="de" defaultValue={f.de} className="w-36" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">Até</span>
            <Input type="date" name="ate" defaultValue={f.ate} className="w-36" />
          </label>
          {ver === "pendentes" && (
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Sugestão</span>
              <select name="origem" defaultValue={f.origem} className={selectCls}>
                <option value="">Todas</option>
                {Object.entries(ORIGENS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
          )}
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">Memo</span>
            <Input name="q" defaultValue={str(sp.q)} placeholder="Buscar no memo" className="w-48" />
          </label>
          <Button type="submit" variant="outline">
            <Search />
            Filtrar
          </Button>
        </form>
      </div>
      {ver === "ignoradas" ? (
        <Ignoradas empresaId={id} transacoes={filtrar(ignoradas)} />
      ) : (
        <ListaPendentes empresaId={id} transacoes={filtrar(pendentes)} todas={pendentes} />
      )}
    </>
  );
}

async function ListaPendentes({ empresaId, transacoes, todas }: {
  empresaId: string;
  transacoes: Awaited<ReturnType<typeof listarTransacoes>>;
  todas: Awaited<ReturnType<typeof listarTransacoes>>;
}) {
  const [contas, titulosAbertos] = await Promise.all([listarContasAnaliticas(empresaId), listarTitulosAbertos(empresaId)]);
  return <ConciliacaoLista empresaId={empresaId} transacoes={transacoes} todas={todas} contas={contas} titulos={titulosAbertos} />;
}

export default function ConciliacaoPage(props: PageProps<"/e/[id]/conciliacao">) {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Conciliação</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Revise as transações importadas: classifique, baixe títulos, case transferências ou ignore.
      </p>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
        <Conciliacao {...props} />
      </Suspense>
    </div>
  );
}
