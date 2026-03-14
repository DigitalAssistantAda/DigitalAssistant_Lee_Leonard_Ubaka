import React from 'react';
import { Link } from 'react-router-dom';
import './Summaries.css';

function Summaries() {
  return (
    <div className="summaries-page">
      <h1>Summaries Now Live in Chat</h1>
      <p className="page-subtitle">
        The legacy summary generator has been retired. Ask Chat with Ada for concise
        document summaries, follow-up questions, and next steps in one place.
      </p>

      <div className="summaries-card summaries-pointer-card">
        <h2>Use Chat with Ada</h2>
        <p>
          Open the assistant and ask: summarize this document, compare key points,
          or extract action items.
        </p>
        <Link className="summaries-button summaries-link" to="/ai-assistant">
          Go to Chat with Ada
        </Link>
      </div>
    </div>
  );
}

export default Summaries;
