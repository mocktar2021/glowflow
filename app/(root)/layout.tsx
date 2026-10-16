import "../globals.css";

export default function RootRedirectLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body className="min-h-screen antialiased">{children}</body></html>;
}
