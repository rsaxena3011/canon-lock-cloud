import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Canon Lock Cloud: continuity checks for AI-regenerated scenes",
  description:
    "Define the facts that must not change, paste a regenerated scene, and get a deterministic ALLOW, BLOCK, or REVIEW verdict with the exact line quoted as evidence.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            Canon Lock <span>Cloud</span>
          </Link>
          <nav className="site-nav">
            <Link href="/#how">How it works</Link>
            <Link href="/#limits">Known limits</Link>
            <Link href="/#pricing">Pricing</Link>
            <Link href="/check" className="nav-cta">
              Open the checker
            </Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <p>
            Canon Lock Cloud. Deterministic continuity checks: no AI in the
            verdict path, and scene text is never stored by default.
          </p>
        </footer>
      </body>
    </html>
  );
}
