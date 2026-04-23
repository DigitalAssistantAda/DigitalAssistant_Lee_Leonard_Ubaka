import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function IssueDescriptionMarkdown({ text, className = '' }) {
  if (!text || !String(text).trim()) return null;
  return (
    <div className={`issue-description-md ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          table: ({ node, children, ...props }) => (
            <div className="ada-message-markdown-table-wrap">
              <table {...props}>{children}</table>
            </div>
          ),
        }}
      >
        {String(text)}
      </ReactMarkdown>
    </div>
  );
}

export default IssueDescriptionMarkdown;
