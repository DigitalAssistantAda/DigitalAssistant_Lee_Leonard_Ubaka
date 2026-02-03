import React from 'react';
import { FileText, Search, Lock, Users } from 'lucide-react';
import './Landing.css';

function Landing() {
  const navigateTo = (path) => {
    window.location.href = path;
  };

  return (
    <div className="landing-container">
      {/* Navigation */}
      <nav className="landing-nav">
        <div className="nav-brand">Ada</div>
        <div className="nav-links">
          <button onClick={() => navigateTo('/login')} className="nav-link">Login</button>
          <button onClick={() => navigateTo('/login')} className="nav-cta">Register</button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="hero">
        <div className="hero-content">
          <h1 className="hero-title">Ada</h1>
          <p className="hero-subtitle">Secure Digital Assistant for Professional Knowledge Work</p>
          <p className="hero-description">
            Organize, search, and summarize your organization's internal knowledge with AI assistance—securely, privately, and under your control.
          </p>
          <div className="hero-actions">
            <button onClick={() => navigateTo('/login')} className="btn-primary">Get Started</button>
          </div>
        </div>
      </section>

      {/* Features Overview */}
      <section className="features">
        <h2 className="section-title">Core Features</h2>
        <div className="features-grid">
          <div className="feature-card">
            <FileText size={32} className="feature-icon" />
            <h3>Document Management</h3>
            <p>Upload, organize, and manage documents with automatic text extraction and indexing.</p>
          </div>
          <div className="feature-card">
            <Search size={32} className="feature-icon" />
            <h3>Intelligent Search</h3>
            <p>Find information across your knowledge base with keyword and semantic search.</p>
          </div>
          <div className="feature-card">
            <Lock size={32} className="feature-icon" />
            <h3>Security First</h3>
            <p>Enterprise-grade encryption, access control, and audit logging. Your data stays under your control.</p>
          </div>
          <div className="feature-card">
            <Users size={32} className="feature-icon" />
            <h3>Team Collaboration</h3>
            <p>Create workspaces, manage team members, and control who accesses what information.</p>
          </div>
        </div>
      </section>

      {/* About Section */}
      <section className="about">
        <h2 className="section-title">About Ada</h2>
        <p className="about-text">
          Ada is a digital assistant designed to help organizations work with their own internal information. Many small and medium-sized organizations accumulate large volumes of internal data but rely on manual search or ad hoc tools to retrieve it. Ada provides a controlled environment for document ingestion, search, and AI-assisted summarization—making internal knowledge easier to access without exposing it to unnecessary risk.
        </p>
        <p className="about-text">
          Built with security as a core constraint, Ada emphasizes authenticated access, scoped user permissions, and isolation of uploaded data. The system is designed to fail safely and preserve data integrity, even when external services are unavailable.
        </p>
      </section>

      {/* Team Section */}
      <section className="team">
        <h2 className="section-title">Built By</h2>
        <div className="team-members">
            <div className="team-member">
                <div className="member-name">Ann Ubaka</div>
                <div className="member-role">Engineer</div>
          </div>
          <div className="team-member">
            <div className="member-name">Eltonia Leonard</div>
            <div className="member-role">Engineer</div>
          </div>
          <div className="team-member">
            <div className="member-name">Brittany Lee</div>
            <div className="member-role">Engineer</div>
          </div>

        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="brand-name">Ada</div>
            <p>Secure Digital Assistant for Professional Knowledge Work</p>
          </div>
          <div className="footer-links">
            <div className="footer-section">
              <h4>Product</h4>
              <button onClick={() => navigateTo('/login')}>Login</button>
              <button onClick={() => navigateTo('/login')}>Register</button>
            </div>
            <div className="footer-section">
              <h4>About</h4>
              <p className="footer-year">&copy; 2026 Ada</p>
              <p className="footer-tagline">Secure by design</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Landing;
