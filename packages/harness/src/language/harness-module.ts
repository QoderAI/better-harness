import {
  type DefaultSharedCoreModuleContext,
  EmptyFileSystem,
  type LangiumCoreServices,
  type LangiumSharedCoreServices,
  type Module,
  type PartialLangiumCoreServices,
  createDefaultCoreModule,
  createDefaultSharedCoreModule,
  inject,
} from "langium";
import { HarnessGeneratedModule, HarnessGeneratedSharedModule } from "./generated/module.js";
import { HarnessValidator, registerValidationChecks } from "./harness-validator.js";

export type HarnessAddedServices = {
  validation: {
    HarnessValidator: HarnessValidator;
  };
};

export type HarnessServices = LangiumCoreServices & HarnessAddedServices;

export const HarnessModule: Module<HarnessServices, PartialLangiumCoreServices & HarnessAddedServices> = {
  validation: {
    HarnessValidator: () => new HarnessValidator(),
  },
};

export function createHarnessServices(
  context: DefaultSharedCoreModuleContext = EmptyFileSystem,
): { shared: LangiumSharedCoreServices; Harness: HarnessServices } {
  const shared = inject(createDefaultSharedCoreModule(context), HarnessGeneratedSharedModule);
  const Harness = inject(createDefaultCoreModule({ shared }), HarnessGeneratedModule, HarnessModule);
  shared.ServiceRegistry.register(Harness);
  registerValidationChecks(Harness);
  return { shared, Harness };
}
