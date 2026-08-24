import type { ValidationAcceptor, ValidationChecks } from "langium";
import { LANGUAGE_VERSION } from "../ir/index.js";
import type { HarnessAstType, HarnessDocument } from "./generated/ast.js";
import type { HarnessServices } from "./harness-module.js";

export function registerValidationChecks(services: HarnessServices): void {
  const registry = services.validation.ValidationRegistry;
  const validator = services.validation.HarnessValidator;
  const checks: ValidationChecks<HarnessAstType> = {
    HarnessDocument: validator.checkLanguageVersion,
  };
  registry.register(checks, validator);
}

export class HarnessValidator {
  checkLanguageVersion(document: HarnessDocument, accept: ValidationAcceptor): void {
    if (document.languageVersion !== LANGUAGE_VERSION) {
      accept(
        "error",
        `Unsupported Harness language version '${document.languageVersion}'; expected '${LANGUAGE_VERSION}'.`,
        { node: document, property: "languageVersion" },
      );
    }
  }
}
