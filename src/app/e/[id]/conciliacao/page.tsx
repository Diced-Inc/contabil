import { Suspense, type ReactNode } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { CircleCheckBig, EyeOff, ListChecks, Search } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Carregando, EmptyState, FilterField, PageHeader, Toolbar } from "@/components/page-header";
import { hoje, isoData, primeiroDiaDoMes } from "@/lib/format";
import { ImportarOfxDialog } from "../bancos/importar-ofx-dialog";
import { getEmpresa } from "../empresa";
import { listarContasAnaliticas } from "../lancamentos/queries";
import { ConciliacaoLista, Conciliadas, Ignoradas } from "./conciliacao-toolbar";
import { contarConciliadas, listarConciliadas, listarContasBancarias, listarTitulosAbertos, listarTransacoes } from "./queries";

// Server actions desta página rodam o pipeline de sugestão (IA).
export const maxDuration = 300;

const selectCls =
  "h-9 cursor-pointer rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const ORIGENS = { regra: "Regra", transferencia: "Transferência", ia: "IA", sem: "Sem sugestão" } as const;
const str = (s: unknown) => (typeof s === "string" ? s.trim() : "");
const VER = ["pendentes", "ignoradas", "conciliadas"] as const;
type Ver = (typeof VER)[number];
const fimDoMes = (d: string) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).toISOString().slice(0, 10);
const DESCRICAO = "Revise as transações importadas: classifique, baixe títulos, case transferências ou ignore.";

async function Conciliacao({ params, searchParams }: PageProps<"/e/[id]/conciliacao">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  await getEmpresa(id);
  const ver: Ver = VER.find((v) => v === sp.ver) ?? "pendentes";
  const f = {
    conta: str(sp.conta), de: isoData(sp.de) ?? "", ate: isoData(sp.ate) ?? "", q: str(sp.q).toLowerCase(),
    origem: str(sp.origem) in ORIGENS ? (str(sp.origem) as keyof typeof ORIGENS) : "",
  };
  if (ver === "conciliadas" && !f.de && !f.ate) {
    f.de = primeiroDiaDoMes(hoje());
    f.ate = fimDoMes(hoje());
  }
  const [pendentes, ignoradas, nConciliadas, bancos] = await Promise.all([
    listarTransacoes(id, "pendente"),
    listarTransacoes(id, "ignorada"),
    contarConciliadas(id),
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
  const filtrando = !!(f.conta || f.de || f.ate || f.q || f.origem);
  const importar = <ImportarOfxDialog empresaId={id} contas={bancos} />;
  const aba = (v: Ver, rotulo: string, n: number) => (
    <Link
      href={v === "pendentes" ? `/e/${id}/conciliacao` : `/e/${id}/conciliacao?ver=${v}`}
      aria-current={v === ver ? "page" : undefined}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
        v === ver && "bg-card text-foreground shadow-xs",
      )}
    >
      {rotulo}
      <span
        className={cn(
          "rounded-full bg-muted px-1.5 text-xs tabular-nums",
          v === ver && v === "pendentes" && n > 0 && "bg-warning-soft text-warning",
        )}
      >
        {n}
      </span>
    </Link>
  );

  return (
    <>
      <PageHeader title="Conciliação" description={DESCRICAO} actions={importar} />
      <nav className="mb-4 inline-flex rounded-lg border bg-muted p-[3px]">
        {aba("pendentes", "Pendentes", pendentes.length)}
        {aba("conciliadas", "Conciliadas", nConciliadas)}
        {aba("ignoradas", "Ignoradas", ignoradas.length)}
      </nav>
      <Toolbar>
        <form className="contents">
          {ver !== "pendentes" && <input type="hidden" name="ver" value={ver} />}
          <FilterField label="Conta">
            <select name="conta" defaultValue={f.conta} className={selectCls}>
              <option value="">Todas</option>
              {bancos.map((b) => (
                <option key={b.id} value={b.id}>{b.nome}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="De">
            <Input type="date" name="de" defaultValue={f.de} className="w-40" />
          </FilterField>
          <FilterField label="Até">
            <Input type="date" name="ate" defaultValue={f.ate} className="w-40" />
          </FilterField>
          {ver === "pendentes" && (
            <FilterField label="Sugestão">
              <select name="origem" defaultValue={f.origem} className={selectCls}>
                <option value="">Todas</option>
                {Object.entries(ORIGENS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </FilterField>
          )}
          <FilterField label="Memo" className="min-w-48 flex-1">
            <Input name="q" defaultValue={str(sp.q)} placeholder="Buscar no memo" />
          </FilterField>
          <Button type="submit" variant="outline">
            <Search />
            Filtrar
          </Button>
        </form>
      </Toolbar>
      {ver === "conciliadas" ? (
        <ListaConciliadas
          empresaId={id}
          filtros={f}
          vazio={<EmptyState icon={ListChecks} title="Nada conciliado" hint="Nenhuma transação conciliada nesse período." />}
        />
      ) : ver === "ignoradas" ? (
        <Ignoradas
          empresaId={id}
          transacoes={filtrar(ignoradas)}
          vazio={<EmptyState icon={EyeOff} title="Nenhuma transação ignorada" hint="Transações ignoradas aparecem aqui e podem ser reativadas." />}
        />
      ) : (
        <ListaPendentes
          empresaId={id}
          transacoes={filtrar(pendentes)}
          todas={pendentes}
          vazio={
            filtrando ? (
              <EmptyState icon={Search} title="Nada encontrado" hint="Nenhuma transação pendente com esses filtros." />
            ) : (
              <EmptyState
                icon={CircleCheckBig}
                title="Tudo conciliado"
                hint="Não há transações pendentes. Importe um novo extrato OFX para continuar."
                action={importar}
              />
            )
          }
        />
      )}
    </>
  );
}

async function ListaPendentes({ empresaId, transacoes, todas, vazio }: {
  empresaId: string;
  transacoes: Awaited<ReturnType<typeof listarTransacoes>>;
  todas: Awaited<ReturnType<typeof listarTransacoes>>;
  vazio: ReactNode;
}) {
  await connection();
  const [contas, titulosAbertos] = await Promise.all([listarContasAnaliticas(empresaId), listarTitulosAbertos(empresaId)]);
  return (
    <ConciliacaoLista
      empresaId={empresaId}
      transacoes={transacoes}
      todas={todas}
      contas={contas}
      titulos={titulosAbertos}
      vazio={vazio}
    />
  );
}

async function ListaConciliadas({ empresaId, filtros, vazio }: {
  empresaId: string;
  filtros: { conta: string; de: string; ate: string; q: string };
  vazio: ReactNode;
}) {
  await connection();
  const [transacoes, contas] = await Promise.all([listarConciliadas(empresaId, filtros), listarContasAnaliticas(empresaId)]);
  return <Conciliadas empresaId={empresaId} transacoes={transacoes} contas={contas} vazio={vazio} />;
}

export default function ConciliacaoPage(props: PageProps<"/e/[id]/conciliacao">) {
  return (
    <Suspense fallback={<><PageHeader title="Conciliação" description={DESCRICAO} /><Carregando /></>}>
      <Conciliacao {...props} />
    </Suspense>
  );
}
