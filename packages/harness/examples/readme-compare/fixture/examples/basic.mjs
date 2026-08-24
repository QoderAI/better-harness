import { retry } from "@fixture/retry-kit";

let attempts = 0;
const value = await retry(async () => {
  attempts += 1;
  if (attempts < 2) throw new Error("transient");
  return "ready";
});

console.log(value);
