import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Harness Studio needs a #root element.");
}
createRoot(container).render(<App />);
