"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { estadoSync, sincronizarLicitacoes, ufsParaSincronizar } from "@/db/licitacoes";
import { buscasLicitacao, licitacoes, licitacoesSalvas } from "@/db/schema";
import { parseValorBR } from "@/lib/format";
import { separarTermos, STATUS_SALVA, UFS, type StatusSalva } from "@/lib/licitacoes";
import { arquivosDaCompra, type ArquivoPncp } from "@/lib/pncp";
import { requireUser } from "@/supabase/server";

const CAMINHO = "/licitacoes";
const uuid = z.uuid();

/** Dispara a sincronização em segundo plano (after); a tela acompanha pelo estado. Debounce de 10 min por UF. */
export async function atualizarAgora(): Promise<{ ok: boolean; mensagem: string }> {
  await requireUser();
  const estado = await estadoSync();
  if (estado.rodando) return { ok: true, mensagem: "Já está atualizando. A lista se renova sozinha." };
  const espera = Math.ceil((estado.liberaEm - Date.now()) / 60_000);
  if (espera > 0) return { ok: false, mensagem: `Atualizado há pouco. Tente de novo em ${espera} min.` };
  const ufs = await ufsParaSincronizar();
  // a tela (dinâmica) acompanha com router.refresh enquanto o estado diz "rodando"
  after(() => sincronizarLicitacoes({ ufs, prazoMs: 150_000 }));
  return { ok: true, mensagem: "Buscando licitações no PNCP. Leva 1 a 2 minutos." };
}

/** Salva para acompanhar (ou tira dos acompanhamentos). */
export async function alternarSalva(licitacaoId: string, salvar: boolean) {
  await requireUser();
  if (!uuid.safeParse(licitacaoId).success) return { erro: "Licitação inválida." };
  if (salvar) await db.insert(licitacoesSalvas).values({ licitacaoId }).onConflictDoNothing();
  else await db.delete(licitacoesSalvas).where(eq(licitacoesSalvas.licitacaoId, licitacaoId));
  revalidatePath(CAMINHO);
  return { ok: true };
}

const salvaSchema = z.object({
  status: z.enum(Object.keys(STATUS_SALVA) as [StatusSalva, ...StatusSalva[]]).optional(),
  empresaId: z.union([z.uuid(), z.literal("")]).optional(),
  nota: z.string().max(4000).optional(),
});

export async function atualizarSalva(id: string, dados: z.input<typeof salvaSchema>) {
  await requireUser();
  const p = salvaSchema.safeParse(dados);
  if (!uuid.safeParse(id).success || !p.success) return { erro: "Dados inválidos." };
  const { status, empresaId, nota } = p.data;
  await db
    .update(licitacoesSalvas)
    .set({
      ...(status && { status }),
      ...(empresaId !== undefined && { empresaId: empresaId || null }),
      ...(nota !== undefined && { nota: nota.trim() || null }),
      updatedAt: new Date(),
    })
    .where(eq(licitacoesSalvas.id, id));
  revalidatePath(CAMINHO);
  return { ok: true };
}

/** Lista o edital e anexos direto do PNCP (sob demanda, não fica no banco). */
export async function arquivosDaLicitacao(licitacaoId: string): Promise<{ arquivos?: ArquivoPncp[]; erro?: string }> {
  await requireUser();
  if (!uuid.safeParse(licitacaoId).success) return { erro: "Licitação inválida." };
  const [l] = await db
    .select({ cnpj: licitacoes.orgaoCnpj, ano: licitacoes.ano, seq: licitacoes.sequencial })
    .from(licitacoes)
    .where(eq(licitacoes.id, licitacaoId));
  if (!l) return { erro: "Licitação não encontrada." };
  try {
    return { arquivos: await arquivosDaCompra(l.cnpj, l.ano, l.seq) };
  } catch (e) {
    console.error("[licitacoes] arquivos:", e);
    return { erro: "O PNCP não respondeu agora. Tente de novo em instantes ou abra no PNCP." };
  }
}

export type EstadoBusca = { erro?: string; ok?: boolean };

const valorOuNull = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(parseValorBR(s));
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : undefined;
};

/** Cria (id null) ou edita uma busca salva. */
export async function salvarBusca(id: string | null, _prev: EstadoBusca, form: FormData): Promise<EstadoBusca> {
  await requireUser();
  if (id && !uuid.safeParse(id).success) return { erro: "Busca inválida." };
  const nome = String(form.get("nome") ?? "").trim().slice(0, 80);
  if (!nome) return { erro: "Dê um nome para a busca." };
  const termos = separarTermos(String(form.get("termos") ?? "")).slice(0, 30);
  const ufs = form.getAll("uf").map((u) => String(u).toUpperCase()).filter((u) => (UFS as readonly string[]).includes(u));
  const municipios = form.getAll("municipio").map((m) => String(m).trim()).filter(Boolean).slice(0, 50);
  const modalidades = form.getAll("modalidade").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const valorMin = valorOuNull(form.get("min"));
  const valorMax = valorOuNull(form.get("max"));
  if (valorMin === undefined || valorMax === undefined) return { erro: "Valor inválido. Use só números, como 50.000,00." };
  if (valorMin && valorMax && Number(valorMin) > Number(valorMax)) return { erro: "O valor mínimo está maior que o máximo." };
  const empresa = String(form.get("empresaId") ?? "");
  const empresaId = uuid.safeParse(empresa).success ? empresa : null;
  if (!termos.length && !ufs.length && !municipios.length && !modalidades.length && !valorMin && !valorMax) {
    return { erro: "Informe pelo menos uma palavra ou um filtro: sem isso o alerta mandaria todas as licitações." };
  }
  const dados = { nome, termos, ufs, municipios, modalidades, valorMin, valorMax, empresaId };
  if (id) await db.update(buscasLicitacao).set(dados).where(eq(buscasLicitacao.id, id));
  else await db.insert(buscasLicitacao).values(dados);
  revalidatePath(CAMINHO);
  return { ok: true };
}

export async function alternarBusca(id: string, ativa: boolean) {
  await requireUser();
  if (!uuid.safeParse(id).success) return;
  // reativar não deve despejar tudo que entrou enquanto estava pausada
  await db.update(buscasLicitacao).set({ ativa, ...(ativa && { ultimoEnvio: new Date() }) }).where(eq(buscasLicitacao.id, id));
  revalidatePath(CAMINHO);
}

export async function removerBusca(id: string) {
  await requireUser();
  if (!uuid.safeParse(id).success) return;
  await db.delete(buscasLicitacao).where(eq(buscasLicitacao.id, id));
  revalidatePath(CAMINHO);
}
