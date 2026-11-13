export default function PortalLayout({ children }: LayoutProps<"/portal">) {
  return <div className="flex min-h-svh flex-1 flex-col bg-muted/40">{children}</div>;
}
