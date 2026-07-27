import { commandInventory } from "./registry.mjs";

export function openCliSchema({ audience = "all" } = {}) {
  const inventory = commandInventory({ audience });
  return {
    schema: "opencli",
    name: inventory.name,
    audience: inventory.audience,
    commands: inventory.commands.map((command) => ({
      name: command.name,
      audience: command.audience,
      description: command.description ?? command.summary,
      hidden: command.hidden,
      aliases: command.aliases,
      ...(command.kind === "direct"
        ? { args: ["[args]"], script: command.script }
        : {
            subcommands: command.subcommands.map((subcommand) => ({
              name: subcommand.name,
              audience: subcommand.audience,
              description: subcommand.description ?? subcommand.summary ?? subcommand.name,
              args: ["[args]"],
              script: subcommand.script,
            })),
          }),
    })),
  };
}
