import { Sidebar } from "./Sidebar";
import { AppHeader } from "./AppHeader";

interface AppLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export function AppLayout({ children, title }: AppLayoutProps) {
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "var(--color-bg)",
      }}
    >
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <AppHeader title={title} />
        <main
          style={{
            flex: 1,
            padding: "24px",
            overflowY: "auto",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
