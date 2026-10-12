import { Fragment, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

/** Inline markdown: **bold**, `code`, [text](url) and bare URLs */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${match.index}-${token.length}`;
    if (token.startsWith('**')) parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('*')) parts.push(<em key={key} className="text-ink/90">{token.slice(1, -1)}</em>);
    else if (token.startsWith('`')) parts.push(<code key={key} className="rounded bg-raised px-1 font-mono text-[11.5px]">{token.slice(1, -1)}</code>);
    else {
      const link = /^\[([^\]]+)\]\((.+)\)$/.exec(token);
      const href = link ? link[2] : token;
      parts.push(<a key={key} href={href} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">{link ? link[1] : token}</a>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      {language && <span className="absolute left-2.5 top-1.5 text-[10px] uppercase tracking-[0.08em] text-faint">{language}</span>}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md text-muted opacity-0 transition-opacity hover:bg-hover hover:text-ink group-hover:opacity-100"
        aria-label="Code kopieren"
      >
        {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      </button>
      <pre className={`scroll-thin overflow-x-auto rounded-xl bg-canvas/70 px-3 pb-2.5 font-mono text-[11.5px] leading-relaxed ${language ? 'pt-6' : 'pt-2.5'}`}>{code}</pre>
    </div>
  );
}

/** Small markdown renderer for Claude's answer (headings, lists, paragraphs) */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  // items may carry indented sub-points, so a numbered list keeps counting across them
  let list: { ordered: boolean; items: Array<{ text: string; children: string[] }> } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`l${blocks.length}`} className={list.ordered ? 'list-decimal space-y-1 pl-5' : 'list-disc space-y-0.5 pl-5'}>
        {list.items.map((item, index) => (
          <li key={index}>
            {inline(item.text)}
            {!!item.children.length && <ul className="mt-0.5 list-[circle] space-y-0.5 pl-5 text-ink/85">{item.children.map((child, childIndex) => <li key={childIndex}>{inline(child)}</li>)}</ul>}
          </li>
        ))}
      </Tag>,
    );
    list = null;
  };
  let code: { language?: string; lines: string[] } | null = null;
  text.split('\n').forEach((raw) => {
    const line = raw.trimEnd();
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
    if (code) {
      if (fence) {
        blocks.push(<CodeBlock key={`c${blocks.length}`} code={code.lines.join('\n')} language={code.language} />);
        code = null;
      } else code.lines.push(raw);
      return;
    }
    if (fence) {
      flush();
      code = { language: fence[1] || undefined, lines: [] };
      return;
    }
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push(<p key={`h${blocks.length}`} className="mt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint first:mt-0">{inline(heading[1])}</p>);
    } else if (bullet || numbered) {
      const ordered = !!numbered;
      const indented = /^\s{2,}/.test(line);
      const current = list as { ordered: boolean; items: Array<{ text: string; children: string[] }> } | null;
      if (indented && current?.items.length) {
        current.items[current.items.length - 1].children.push((bullet ?? numbered)![1]);
        return;
      }
      if (current && current.ordered !== ordered) flush();
      list = list ?? { ordered, items: [] };
      list.items.push({ text: (bullet ?? numbered)![1], children: [] });
    } else if (!line.trim()) {
      // blank lines between list items keep the list (and its numbering) going
    } else {
      flush();
      blocks.push(<p key={`p${blocks.length}`}>{inline(line)}</p>);
    }
  });
  flush();
  // unterminated code block (answer cut off)
  if (code) blocks.push(<CodeBlock key={`c${blocks.length}`} code={(code as { lines: string[] }).lines.join('\n')} language={(code as { language?: string }).language} />);
  return <div className="space-y-1.5 text-[12.5px] leading-relaxed">{blocks.map((block, index) => <Fragment key={index}>{block}</Fragment>)}</div>;
}
