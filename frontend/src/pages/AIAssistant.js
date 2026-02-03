import React, { useState, useEffect } from 'react';
import { Send, FileText, Bot, AlertCircle, Sparkles, X, CheckCircle } from 'lucide-react';
import './AIAssistant.css';

function AIAssistant() {
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [selectedDocuments, setSelectedDocuments] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('chat'); // 'chat' or 'summarize'
  const [summaryInstructions, setSummaryInstructions] = useState('');
  const [summaries, setSummaries] = useState([]);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
  const token = localStorage.getItem('token');

  useEffect(() => {
    // Mock: In real implementation, fetch user's documents
    setDocuments([
      { id: 1, name: 'Project Requirements.pdf', workspace_id: 1 },
      { id: 2, name: 'Technical Spec.docx', workspace_id: 1 },
      { id: 3, name: 'Meeting Notes Q4.txt', workspace_id: 1 },
    ]);

    // Mock: Fetch user's conversations
    setConversations([
      { id: 1, title: 'Previous Chat', last_message_at: '2 hours ago' },
    ]);

    // Mock: Sample summaries
    setSummaries([
      {
        id: 1,
        title: 'Requirements Summary',
        status: 'completed',
        document_id: 1,
        created_at: 'Yesterday',
      },
    ]);
  }, []);

  const handleSendMessage = () => {
    if (!input.trim()) return;

    // Mock: Add user message
    const userMessage = {
      id: messages.length + 1,
      role: 'user',
      content: input,
      created_at: new Date().toISOString(),
    };

    setMessages([...messages, userMessage]);
    setInput('');
    setLoading(true);

    // Mock: Simulate AI response
    setTimeout(() => {
      const aiMessage = {
        id: messages.length + 2,
        role: 'assistant',
        content: `[AI Service Placeholder]\n\nThis is a mock response. In production, this would:\n• Query your selected documents using vector search\n• Generate contextual answers using GPT-4 or Claude\n• Cite specific passages from your documents\n• Maintain conversation history\n\nSelected context: ${selectedDocuments.length} documents`,
        sources: selectedDocuments.map((id) => documents.find((d) => d.id === id)?.name),
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, aiMessage]);
      setLoading(false);
    }, 1500);
  };

  const handleGenerateSummary = () => {
    if (selectedDocuments.length === 0) {
      alert('Please select at least one document');
      return;
    }

    setLoading(true);

    // Mock: Simulate summary generation
    setTimeout(() => {
      const newSummary = {
        id: summaries.length + 1,
        title: `Summary of ${selectedDocuments.length} documents`,
        status: 'completed',
        summary_text: `[AI Service Placeholder]\n\nThis would generate a comprehensive summary by:\n• Extracting key points from selected documents\n• Identifying main themes and topics\n• Highlighting important dates, names, and decisions\n• Creating actionable insights\n\nInstructions: ${summaryInstructions || 'General summary'}\nDocuments: ${selectedDocuments.map((id) => documents.find((d) => d.id === id)?.name).join(', ')}`,
        document_ids: selectedDocuments,
        created_at: 'Just now',
      };
      setSummaries([newSummary, ...summaries]);
      setLoading(false);
      setSummaryInstructions('');
      alert('Summary generated! (Mock)');
    }, 2000);
  };

  const toggleDocumentSelection = (docId) => {
    setSelectedDocuments((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  return (
    <div className="ai-assistant-container">
      {/* Header */}
      <div className="ai-header">
        <div className="ai-header-left">
          <Bot size={28} className="ai-icon" />
          <h1>AI Assistant</h1>
        </div>
        <div className="mode-toggle">
          <button
            className={`mode-btn ${mode === 'chat' ? 'active' : ''}`}
            onClick={() => setMode('chat')}
          >
            Chat
          </button>
          <button
            className={`mode-btn ${mode === 'summarize' ? 'active' : ''}`}
            onClick={() => setMode('summarize')}
          >
            Summarize
          </button>
        </div>
      </div>

      <div className="ai-content">
        {/* Sidebar: Document Selection */}
        <div className="ai-sidebar">
          <h3>Select Documents</h3>
          <p className="sidebar-description">Choose documents for context</p>
          <div className="document-list">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className={`document-item ${selectedDocuments.includes(doc.id) ? 'selected' : ''}`}
                onClick={() => toggleDocumentSelection(doc.id)}
              >
                <input
                  type="checkbox"
                  checked={selectedDocuments.includes(doc.id)}
                  onChange={() => {}}
                  className="doc-checkbox"
                />
                <FileText size={16} />
                <span className="doc-name">{doc.name}</span>
              </div>
            ))}
          </div>

          {selectedDocuments.length > 0 && (
            <div className="selection-summary">
              <CheckCircle size={16} />
              {selectedDocuments.length} document{selectedDocuments.length !== 1 ? 's' : ''} selected
            </div>
          )}

          {/* AI Status */}
          <div className="ai-status">
            <AlertCircle size={16} />
            <div className="status-text">
              <strong>AI Service:</strong> Mock Mode
              <p className="status-note">
                Actual AI integration (GPT-4/Claude) will be implemented in later milestone
              </p>
            </div>
          </div>
        </div>

        {/* Main Area */}
        <div className="ai-main">
          {mode === 'chat' ? (
            <>
              {/* Chat Messages */}
              <div className="chat-area">
                {messages.length === 0 ? (
                  <div className="empty-chat">
                    <Sparkles size={48} />
                    <h2>Ask me anything about your documents</h2>
                    <p>I can help you find information, summarize content, and answer questions based on your uploaded documents.</p>
                    <div className="suggestions">
                      <button onClick={() => setInput('What are the main requirements?')}>
                        What are the main requirements?
                      </button>
                      <button onClick={() => setInput('Summarize the key decisions')}>
                        Summarize the key decisions
                      </button>
                      <button onClick={() => setInput('What deadlines are mentioned?')}>
                        What deadlines are mentioned?
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="messages-container">
                    {messages.map((msg) => (
                      <div key={msg.id} className={`message ${msg.role}`}>
                        <div className="message-icon">
                          {msg.role === 'user' ? '👤' : <Bot size={20} />}
                        </div>
                        <div className="message-content">
                          <div className="message-text">{msg.content}</div>
                          {msg.sources && msg.sources.length > 0 && (
                            <div className="message-sources">
                              <strong>Sources:</strong>
                              {msg.sources.map((source, idx) => (
                                <span key={idx} className="source-badge">
                                  {source}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="message-time">{msg.created_at}</div>
                        </div>
                      </div>
                    ))}
                    {loading && (
                      <div className="message assistant">
                        <div className="message-icon">
                          <Bot size={20} />
                        </div>
                        <div className="message-content">
                          <div className="typing-indicator">
                            <span></span>
                            <span></span>
                            <span></span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Chat Input */}
              <div className="chat-input-area">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Ask a question about your documents..."
                  className="chat-input"
                  disabled={loading}
                />
                <button
                  onClick={handleSendMessage}
                  className="btn-send"
                  disabled={loading || !input.trim()}
                  title="Send message"
                  aria-label="Send message"
                >
                  <Send size={18} />
                </button>
              </div>
            </>
          ) : (
            /* Summarize Mode */
            <div className="summarize-area">
              <h2>Generate Summary</h2>
              <p className="summarize-description">
                Create AI-powered summaries of your selected documents. Customize the summary with specific instructions.
              </p>

              <div className="summarize-form">
                <div className="form-group">
                  <label htmlFor="summary-instructions">Instructions (optional)</label>
                  <textarea
                    id="summary-instructions"
                    value={summaryInstructions}
                    onChange={(e) => setSummaryInstructions(e.target.value)}
                    placeholder="E.g., Focus on action items and deadlines..."
                    className="summary-input"
                    rows="4"
                  />
                </div>

                <button
                  onClick={handleGenerateSummary}
                  className="btn-generate"
                  disabled={loading || selectedDocuments.length === 0}
                >
                  <Sparkles size={18} />
                  {loading ? 'Generating...' : 'Generate Summary'}
                </button>
              </div>

              {/* Previous Summaries */}
              <div className="summaries-section">
                <h3>Previous Summaries</h3>
                <div className="summaries-list">
                  {summaries.length === 0 ? (
                    <p className="empty-state">No summaries yet</p>
                  ) : (
                    summaries.map((summary) => (
                      <div key={summary.id} className="summary-card">
                        <div className="summary-header">
                          <FileText size={16} />
                          <h4>{summary.title}</h4>
                          <span className={`status-badge ${summary.status}`}>
                            {summary.status}
                          </span>
                        </div>
                        {summary.summary_text && (
                          <p className="summary-preview">{summary.summary_text.substring(0, 200)}...</p>
                        )}
                        <div className="summary-meta">{summary.created_at}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AIAssistant;
