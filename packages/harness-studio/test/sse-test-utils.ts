export function decodeSseStream<T = unknown>(body: string): T[] {
  const values: T[] = [];
  for (const frame of body.split("\n\n")) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data.length > 0) values.push(JSON.parse(data) as T);
  }
  return values;
}
