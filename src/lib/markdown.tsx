import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from './utils';

/**
 * Minimal, dependency-free Markdown renderer for simulated chat output.
 * Supports: headings (#..###), unordered (-) and ordered (1.) lists,
 * fenced code blocks with language tag, inline `code`, **bold**, *italic*,
 * and paragraphs. Intentionally small — Phase 1 does not need full CommonMark.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyPrefix}-i${i++}`;
    if (tok.startsWith('**')) nodes.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`'))
      nodes.push(
        <code key={k} className="rounded bg-surface-line/70 px-1 py-0.5 font-mono text-[0.85em] text-accent-soft">
          {tok.slice(1, -1)}
        </code>,
      );
    else nodes.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group/code relative my-2 overflow-hidden rounded-card border border-surface-line bg-surface-base">
      <div className="flex items-center justify-between border-b border-surface-line px-3 py-1.5">
        <span className="font-mono text-2xs uppercase tracking-wider text-ink-faint">{lang || 'text'}</span>
        <button
          aria-label="Copy code"
          className={cn('flex items-center gap-1 text-2xs text-ink-faint hover:text-ink-primary')}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
            } catch {
              /* clipboard may be blocked; still show feedback in prototype */
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5">
        <code className="font-mono text-xs leading-relaxed text-ink-secondary">{code}</code>
      </pre>
    </div>
  );
}

export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.split('\n');
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++; // skip closing fence
      blocks.push(<CodeBlock key={`b${k++}`} code={buf.join('\n')} lang={fence[1] || undefined} />);
      continue;
    }

    // heading
    const head = line.match(/^(#{1,3})\s+(.*)$/);
    if (head) {
      const level = head[1].length;
      const content = renderInline(head[2], `h${k}`);
      blocks.push(
        level === 1 ? (
          <h1 key={`b${k++}`}>{content}</h1>
        ) : level === 2 ? (
          <h2 key={`b${k++}`}>{content}</h2>
        ) : (
          <h3 key={`b${k++}`}>{content}</h3>
        ),
      );
      i++;
      continue;
    }

    // lists
    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const ordered = /^\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\d+\.\s+/.test(lines[i]) : /^[-*]\s+/.test(lines[i]))) {
        items.push(lines[i].replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, ''));
        i++;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      blocks.push(
        <ListTag key={`b${k++}`}>
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `l${k}-${idx}`)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    // paragraph (merge consecutive non-empty plain lines)
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i]) &&
      !/^#{1,3}\s/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push(<p key={`b${k++}`}>{renderInline(buf.join(' '), `p${k}`)}</p>);
  }

  return <div className="md">{blocks}</div>;
}
