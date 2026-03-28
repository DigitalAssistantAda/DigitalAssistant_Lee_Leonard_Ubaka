import React from 'react';

/**
 * Lightweight Markdown → React (no extra packages).
 * Supports: paragraphs, ###/##/# headings, -/* lists, 1. lists, ``` fences,
 * `inline code`, **bold**, *italic*, [label](https://…) links.
 */
function formatInline(line, keyPrefix) {
  const parts = [];
  let s = line;
  let k = 0;
  const key = (suffix) => `${keyPrefix}-${suffix}-${k++}`;

  while (s.length) {
    const mCode = s.match(/^`([^`]+)`/);
    if (mCode) {
      parts.push(<code key={key('c')}>{mCode[1]}</code>);
      s = s.slice(mCode[0].length);
      continue;
    }
    const mLink = s.match(/^\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/i);
    if (mLink) {
      parts.push(
        <a key={key('a')} href={mLink[2]} target="_blank" rel="noopener noreferrer">
          {mLink[1] || mLink[2]}
        </a>
      );
      s = s.slice(mLink[0].length);
      continue;
    }
    const mBold = s.match(/^\*\*([^*]+)\*\*/);
    if (mBold) {
      parts.push(<strong key={key('b')}>{mBold[1]}</strong>);
      s = s.slice(mBold[0].length);
      continue;
    }
    const mItalic = s.match(/^\*([^*]+)\*/);
    if (mItalic) {
      parts.push(<em key={key('i')}>{mItalic[1]}</em>);
      s = s.slice(mItalic[0].length);
      continue;
    }
    const next = s.search(/[`[*]/);
    if (next === -1) {
      parts.push(s);
      break;
    }
    if (next > 0) {
      parts.push(s.slice(0, next));
      s = s.slice(next);
      continue;
    }
    parts.push(s[0]);
    s = s.slice(1);
  }
  return parts;
}

function parseBlocks(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const elements = [];
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (trimmed === '') {
      i += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      i += 1;
      const code = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      elements.push(
        <pre key={`md-${blockKey++}`}>
          <code>{code.join('\n')}</code>
        </pre>
      );
      continue;
    }

    if (/^#{1,3}\s/.test(trimmed)) {
      const level = trimmed.match(/^(#{1,3})\s/)[1].length;
      const content = trimmed.replace(/^#+\s*/, '');
      const bk = blockKey++;
      elements.push(
        React.createElement(
          `h${level}`,
          { key: `md-${bk}` },
          formatInline(content, `h${level}-${bk}`)
        )
      );
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i += 1;
      }
      elements.push(
        <ul key={`md-${blockKey++}`}>
          {items.map((item, j) => (
            <li key={j}>{formatInline(item, `ul-${blockKey}-${j}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      elements.push(
        <ol key={`md-${blockKey++}`}>
          {items.map((item, j) => (
            <li key={j}>{formatInline(item, `ol-${blockKey}-${j}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    const para = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (t === '') break;
      if (
        t.startsWith('```')
        || /^#{1,3}\s/.test(t)
        || /^[-*]\s+/.test(t)
        || /^\d+\.\s+/.test(t)
      ) {
        break;
      }
      para.push(lines[i]);
      i += 1;
    }
    const pText = para.join(' ').trim();
    if (pText) {
      elements.push(
        <p key={`md-${blockKey++}`}>{formatInline(pText, `p-${blockKey}`)}</p>
      );
    }
  }

  return elements;
}

function IssueDescriptionMarkdown({ text, className = '' }) {
  if (!text || !String(text).trim()) return null;
  return (
    <div className={`issue-description-md ${className}`.trim()}>
      {parseBlocks(String(text))}
    </div>
  );
}

export default IssueDescriptionMarkdown;
