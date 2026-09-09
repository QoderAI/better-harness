import { type Components } from "streamdown";
import { type Element, type ElementContent } from "hast";
import { HighlightedCode } from "../../code/HighlightedCode.js";
import { fenceHint } from "../../artifacts/MarkdownArtifactView.js";

function textContent(node: Element | ElementContent): string {
  return node.type === "text" ? node.value : "children" in node ? node.children.map(textContent).join("") : "";
}

/** Chat has no artifact resource grants: links are explicit and images stay inert. */
export const responseMarkdownComponents: Components = {
  strong: ({ children }) => <strong>{children}</strong>,
  pre: ({ node }) => {
    const code = node?.children.find((child): child is Element => child.type === "element" && child.tagName === "code");
    const classNames = code?.properties.className;
    const language = Array.isArray(classNames) ? classNames.find(name => typeof name === "string" && name.startsWith("language-"))?.toString().slice(9) : undefined;
    return <div className="markdown-code-block" data-md-language={language ?? "plain"}><HighlightedCode code={code ? textContent(code).replace(/\n$/, "") : ""} sourceHint={fenceHint(language)} /></div>;
  },
  code: ({ children }) => <code>{children}</code>,
  a: ({ href, children, title }) => {
    if (!href) return <span>{children}</span>;
    if (href.startsWith("#")) return <button className="markdown-anchor-link" type="button" title={title} onClick={event => {
      const slug = href.slice(1);
      const root = event.currentTarget.closest(".ai-message-response");
      const heading = [...(root?.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6") ?? [])].find(node => node.id === slug || node.textContent?.trim().toLowerCase().replace(/\s+/g, "-") === slug);
      heading?.scrollIntoView({ block: "nearest" });
    }}>{children}</button>;
    return /^(https?:|mailto:)/i.test(href) ? <a href={href} title={title} target="_blank" rel="noreferrer noopener">{children}</a> : <span>{children}</span>;
  },
  img: ({ alt }) => <span className="markdown-image-unresolved">{alt}</span>,
  table: ({ children }) => <div className="markdown-table-scroll"><table>{children}</table></div>,
};
