"use client";

import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ContaOpcao = { id: string; codigo: string; nome: string };

/**
 * Combobox de conta (passe só analíticas ativas). Busca por código ou nome.
 * Controlado (`value` + `onChange`) ou não (`defaultValue`); com `name`, posta o id num input hidden.
 */
export function ContaSelect({ contas, value, defaultValue, onChange, placeholder = "Selecione a conta", name, id, className }: {
  contas: ContaOpcao[];
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (id: string) => void;
  placeholder?: string;
  name?: string;
  id?: string;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [interno, setInterno] = useState(defaultValue ?? null);
  const atual = value !== undefined ? value : interno;
  const sel = contas.find((c) => c.id === atual);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={aberto}
            className={cn("w-full justify-between font-normal", !sel && "text-muted-foreground", className)}
          />
        }
      >
        <span className="truncate">{sel ? `${sel.codigo} ${sel.nome}` : placeholder}</span>
        <ChevronsUpDown className="opacity-50" />
      </PopoverTrigger>
      {name && <input type="hidden" name={name} value={atual ?? ""} />}
      <PopoverContent className="w-(--anchor-width) min-w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar por código ou nome..." />
          <CommandList>
            <CommandEmpty>Nenhuma conta encontrada.</CommandEmpty>
            {contas.map((c) => (
              <CommandItem
                key={c.id}
                value={`${c.codigo} ${c.nome}`}
                data-checked={c.id === atual}
                onSelect={() => {
                  setInterno(c.id);
                  onChange?.(c.id);
                  setAberto(false);
                }}
              >
                <span className="tabular-nums text-muted-foreground">{c.codigo}</span>
                <span className="truncate">{c.nome}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
