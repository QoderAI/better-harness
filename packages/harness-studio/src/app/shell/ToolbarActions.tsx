import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The toolbar's action slot. One node, owned by the shell, filled by the active View. */
export const TOOLBAR_ACTIONS_ID = "studio-toolbar-actions";

/**
 * Renders a View's primary action into the window toolbar instead of into a
 * second bar below it.
 *
 * A workbench that opens with its own title and one line of prose repeats the
 * view name the toolbar already states, which the design contract calls out as
 * duplicated chrome. The action still belongs to the View that owns its state, so
 * it travels up through a portal rather than by lifting that state into the shell.
 */
export function ToolbarActions(props: { children: ReactNode }): React.JSX.Element | null {
  const [host, setHost] = useState<HTMLElement | null>(null);

  // Resolved after mount: the slot is rendered by the shell, which is an ancestor,
  // so it does not exist while this component's own first render is running.
  useEffect(() => {
    setHost(document.getElementById(TOOLBAR_ACTIONS_ID));
  }, []);

  return host === null ? null : createPortal(props.children, host);
}
