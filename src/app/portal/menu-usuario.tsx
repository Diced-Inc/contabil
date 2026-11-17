"use client";

import Link from "next/link";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { sair } from "@/app/login/actions";
import { Avatar } from "@/components/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function MenuUsuario({ nome, email, avatarUrl, avatarLogo }: { nome: string; email: string; avatarUrl: string | null; avatarLogo?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Menu da conta"
        className="flex cursor-pointer items-center gap-2 rounded-full py-1 pr-2.5 pl-1 text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted"
      >
        <Avatar url={avatarUrl} texto={nome || email} logo={avatarLogo} />
        <span className="hidden max-w-40 truncate font-medium text-foreground sm:block">{nome || email}</span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="py-2">
            {nome && <span className="block truncate text-sm font-medium text-foreground">{nome}</span>}
            <span className="block truncate text-xs font-normal text-muted-foreground">{email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/portal/perfil" />}>
          <UserRound />
          Meu perfil
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => sair()}>
          <LogOut />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
