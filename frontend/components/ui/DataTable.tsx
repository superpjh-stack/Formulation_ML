import React from "react";

export interface Column<T> {
  key: keyof T | string;
  header: string;
  width?: number | string;
  align?: "left" | "center" | "right";
  render?: (value: unknown, row: T, index: number) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey?: (row: T, index: number) => string | number;
  emptyText?: string;
  loading?: boolean;
  stickyHeader?: boolean;
}

function getNestedValue<T>(obj: T, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[k];
    return undefined;
  }, obj);
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  emptyText = "데이터가 없습니다.",
  loading = false,
  stickyHeader = false,
}: DataTableProps<T>) {
  return (
    <div
      style={{
        overflowX: "auto",
        borderRadius: 12,
        border: "1px solid #E4E7EC",
        background: "#fff",
        boxShadow: "0 1px 2px rgba(16,24,40,.03)",
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12.5,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <thead>
          <tr
            style={{
              background: "#F8F9FB",
              position: stickyHeader ? "sticky" : "static",
              top: 0,
              zIndex: stickyHeader ? 10 : "auto",
            }}
          >
            {columns.map((col) => (
              <th
                key={String(col.key)}
                style={{
                  padding: "10px 14px",
                  textAlign: col.align ?? "left",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#687182",
                  letterSpacing: "0.03em",
                  textTransform: "uppercase",
                  borderBottom: "1px solid #E4E7EC",
                  whiteSpace: "nowrap",
                  width: col.width,
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td
                colSpan={columns.length}
                style={{
                  padding: "32px 14px",
                  textAlign: "center",
                  color: "#9AA4B2",
                  fontSize: 13,
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      border: "2px solid #E4E7EC",
                      borderTopColor: "#3A5BD9",
                      borderRadius: "50%",
                      animation: "spin 0.7s linear infinite",
                      display: "inline-block",
                    }}
                  />
                  불러오는 중...
                </div>
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                style={{
                  padding: "32px 14px",
                  textAlign: "center",
                  color: "#9AA4B2",
                  fontSize: 13,
                }}
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            data.map((row, rowIndex) => (
              <tr
                key={rowKey ? rowKey(row, rowIndex) : rowIndex}
                style={{
                  borderBottom:
                    rowIndex < data.length - 1 ? "1px solid #F2F4F7" : "none",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = "#F8F9FB";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = "transparent";
                }}
              >
                {columns.map((col) => {
                  const rawValue = getNestedValue(row, String(col.key));
                  const cell = col.render
                    ? col.render(rawValue, row, rowIndex)
                    : (rawValue as React.ReactNode);
                  return (
                    <td
                      key={String(col.key)}
                      style={{
                        padding: "10px 14px",
                        textAlign: col.align ?? "left",
                        color: "#161B26",
                        verticalAlign: "middle",
                        width: col.width,
                      }}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
