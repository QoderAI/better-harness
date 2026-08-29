import { I18nextProvider } from "react-i18next";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { initStudioI18n, studioI18n } from "./i18n/index.js";

initStudioI18n();

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Harness Studio needs a #root element.");
}
createRoot(container).render(
  <I18nextProvider i18n={studioI18n}>
    <App />
  </I18nextProvider>,
);