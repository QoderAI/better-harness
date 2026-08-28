import { Fragment, jsx as reactJsx, jsxs as reactJsxs } from "react/jsx-runtime";
import { ARTIFACT_NODE_ATTRIBUTE, ARTIFACT_NODE_PROP } from "../contracts/addressing.js";
import { activeArtifactRuntime } from "./bridge.js";

/**
 * `@studio/agent-react/jsx-dev-runtime`.
 *
 * Oxc's automatic development transform routes every JSX element here and hands
 * us `__source`. That is the whole reason the POC uses the development transform:
 * it is the only supported, public channel that carries a source span into
 * runtime, so addressing never has to read React's Fiber internals.
 */

export { Fragment };

interface JsxSource {
  readonly fileName: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
}

type JsxProps = Record<string, unknown> | null | undefined;

/** A catalog component opts in by declaring it forwards the reserved prop. */
interface AddressableComponent {
  readonly acceptsArtifactNode?: boolean;
}

export function jsxDEV(
  type: unknown,
  props: JsxProps,
  key: string | null | undefined,
  isStaticChildren: boolean,
  source: JsxSource | undefined,
  _self: unknown,
): unknown {
  const stamped = stampAddress(type, props, key, source);
  // React intentionally exports no `jsxDEV` implementation from its production
  // runtime. Oxc still calls our development-shaped entry so it can carry the
  // stable source span, then this trusted wrapper delegates element creation to
  // React's production-safe automatic runtime.
  const createElement = isStaticChildren ? reactJsxs : reactJsx;
  return createElement(type as never, stamped as never, key as never);
}

/** Development and production entry points are identical here; both must address. */
export const jsx = jsxDEV;
export const jsxs = jsxDEV;

function stampAddress(
  type: unknown,
  props: JsxProps,
  key: string | null | undefined,
  source: JsxSource | undefined,
): JsxProps {
  const runtime = activeArtifactRuntime();
  if (runtime === undefined || source === undefined) return props;
  const elementType = elementTypeName(type);
  if (elementType === undefined) return props;

  const address = runtime.registry.register({
    modulePath: source.fileName,
    line: source.lineNumber,
    column: source.columnNumber,
    elementType,
  }, key ?? null);

  if (typeof type === "string") return { ...props, [ARTIFACT_NODE_ATTRIBUTE]: address };
  if ((type as AddressableComponent | null)?.acceptsArtifactNode === true) {
    return { ...props, [ARTIFACT_NODE_PROP]: address };
  }
  // A component that has not opted in gets no extra prop: React would forward an
  // unknown prop to the DOM and warn, and a warning per element would drown the
  // diagnostics that actually matter.
  return props;
}

function elementTypeName(type: unknown): string | undefined {
  if (typeof type === "string") return type;
  if (type === Fragment) return "Fragment";
  if (typeof type === "function") {
    const named = type as { displayName?: string; name?: string };
    return named.displayName ?? (named.name !== undefined && named.name !== "" ? named.name : "Anonymous");
  }
  if (typeof type === "object" && type !== null) {
    const named = type as { displayName?: string };
    return named.displayName ?? "Component";
  }
  return undefined;
}
