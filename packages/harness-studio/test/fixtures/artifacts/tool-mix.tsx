interface Row {
  label: string;
  count: number;
}

const rows: Row[] = [
  { label: "explore", count: 12 },
  { label: "change", count: 5 },
  { label: "verify", count: 3 },
];

export default function ToolMix(): React.JSX.Element {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <section data-testid="artifact-tool-mix">
      <h1>Tool mix</h1>
      <p>
        <span data-testid="artifact-total">{total}</span> observed calls
      </p>
      <ul>
        {rows.map((row) => (
          <li key={row.label}>
            {row.label}: {row.count}
          </li>
        ))}
      </ul>
    </section>
  );
}
