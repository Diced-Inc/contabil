"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Imprimir() {
  return (
    <Button variant="outline" size="sm" className="no-print" onClick={() => window.print()}>
      <Printer /> Imprimir
    </Button>
  );
}
