import { agregar, comMovimento } from "./hierarquia";
import { saldos } from "./saldos";

/** Contas com saldo ou movimento no período, sintéticas somadas, em ordem de código. */
export async function balancete(empresaId: string, de: string, ate: string) {
  return comMovimento(agregar(await saldos(empresaId, de, ate)));
}
