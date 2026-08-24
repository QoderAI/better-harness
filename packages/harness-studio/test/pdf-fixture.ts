/** Tiny two-page PDF used to exercise the adapter without a binary fixture. */
export function createPdfFixture(options: { firstPageWidth?: number; firstPageHeight?: number } = {}): Uint8Array {
  const firstPageWidth = options.firstPageWidth ?? 300;
  const firstPageHeight = options.firstPageHeight ?? 420;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${firstPageWidth} ${firstPageHeight}] /Contents 4 0 R >>`,
    stream("0.1 0.2 0.6 rg 30 280 240 90 re f\n"),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 300] /Contents 6 0 R >>",
    stream("0.8 0.3 0.1 rg 40 60 340 180 re f\n"),
  ];
  let source = "%PDF-1.4\n%fixture\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(new TextEncoder().encode(source).byteLength);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = new TextEncoder().encode(source).byteLength;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(source);
}

function stream(content: string): string {
  return `<< /Length ${new TextEncoder().encode(content).byteLength} >>\nstream\n${content}endstream`;
}
