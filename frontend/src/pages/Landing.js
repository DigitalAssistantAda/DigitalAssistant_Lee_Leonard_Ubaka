import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Bolt,
  FileText,
  Lock,
  Puzzle,
  Moon,
  Search,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react';
import adaLogo from '../ada_logo.png';
import './Landing.css';

function Landing() {
  const [darkMode, setDarkMode] = useState(false);

  const navigateTo = (path) => {
    window.location.href = path;
  };

  const toggleDarkMode = () => {
    const nextMode = !darkMode;
    setDarkMode(nextMode);
    localStorage.setItem('darkMode', String(nextMode));
    if (nextMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  useEffect(() => {
    const savedMode = localStorage.getItem('darkMode') === 'true';
    setDarkMode(savedMode);
    if (savedMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.12,
        rootMargin: '0px 0px -48px 0px',
      }
    );

    const revealItems = document.querySelectorAll('.landing-reveal');
    revealItems.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing-page">
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <a href="#top" className="landing-brand" aria-label="Ada home">
            <img src={adaLogo} alt="Ada" className="landing-brand-logo" />
            <span className="landing-brand-wordmark">Ada</span>
          </a>
          <div className="landing-nav-links" aria-label="Landing navigation">
            <a href="#philosophy" className="landing-nav-link">Philosophy</a>
            <a href="#security" className="landing-nav-link">Security</a>
            <a href="#enterprise" className="landing-nav-link">Enterprise</a>
            <button
              type="button"
              className="landing-nav-icon"
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              title={darkMode ? 'Light Mode' : 'Dark Mode'}
              onClick={toggleDarkMode}
            >
              {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button onClick={() => navigateTo('/login')} className="landing-nav-link-btn" type="button">
              Login
            </button>
            <button onClick={() => navigateTo('/login')} className="landing-nav-cta" type="button">
              Create Account
            </button>
          </div>
        </div>
      </nav>

      <main id="top" className="landing-main">
        <section className="landing-hero">
          <span className="landing-hero-eyebrow">Internal Intelligence</span>
          <h1 className="landing-hero-title">
            The warm heart
            <br />
            <em>of your work.</em>
          </h1>
          <p className="landing-hero-subtitle">
            Ada is your organization&apos;s private work brain: secure, elegant, and designed for teams that need trusted answers from internal knowledge.
          </p>

          <div className="landing-hero-demo">
            <div className="landing-demo-card">
              <div className="landing-demo-search">
                <span className="landing-demo-search-icon" aria-hidden="true">
                  <Search size={16} />
                </span>
                <span className="landing-demo-search-text">Ask Ada about our Q3 goals...</span>
                <button className="landing-demo-send" type="button" aria-label="Send query">
                  <ArrowRight size={16} />
                </button>
              </div>

              <div className="landing-demo-answer">
                <span className="landing-demo-answer-icon" aria-hidden="true">
                  <Sparkles size={16} />
                </span>
                <p>
                  Based on <span className="landing-chip">All-Hands_July.pdf</span> and <span className="landing-chip">Slack #strategy</span>, Q3 focus is
                  <strong> operational resilience</strong> and expansion of the <strong>Enterprise Beta</strong>.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="philosophy" className="landing-thoughtful landing-reveal">
          <div className="landing-thoughtful-visual">
            <div className="landing-visual-gradient" />
            <div className="landing-vault-badge">
              <div className="landing-vault-icon" aria-hidden="true">
                <Lock size={14} />
              </div>
              <div>
                <div className="landing-vault-title">Security-First Controls</div>
                <p>Built with access boundaries, document ownership controls, and safe-failure behavior for production teams.</p>
              </div>
            </div>
          </div>

          <div className="landing-thoughtful-content">
            <h2>
              Not just smart.
              <br />
              <em>Thoughtful.</em>
            </h2>
            <p>
              Ada feels less like a chatbot and more like a careful teammate. It understands context across documents, messages, and project memory.
            </p>
            <p>
              Upload SOPs, meeting notes, and drafts. Ada helps teams find and summarize internal knowledge with clear permission boundaries.
            </p>

            <div className="landing-trust-grid">
              <article className="landing-trust-card">
                <div className="landing-trust-icon" aria-hidden="true">
                  <FileText size={16} />
                </div>
                <h3>Multi-Format Documents</h3>
                <p>Bring documents and team knowledge into one searchable internal workspace.</p>
              </article>
              <article className="landing-trust-card">
                <div className="landing-trust-icon" aria-hidden="true">
                  <BadgeCheck size={16} />
                </div>
                <h3>Permission-Aware Access</h3>
                <p>Workspace and user-level access controls help teams separate sensitive information.</p>
              </article>
            </div>
          </div>
        </section>

        <section id="security" className="landing-quiet">
          <div className="landing-quiet-inner">
            <header className="landing-quiet-header landing-reveal">
              <div>
                <h2>
                  Built for the
                  <br />
                  <em>Quiet Hours</em>
                </h2>
                <p>
                  Ada is designed for focused work: low-noise visual language, robust dark mode, and high clarity when the rest of the stack feels loud.
                </p>
              </div>
              <a href="#enterprise" className="landing-quiet-link">
                Explore Technical Specs
                <ArrowRight size={14} />
              </a>
            </header>

            <div className="landing-bento">
              <article className="landing-bento-card landing-bento-semantic landing-reveal">
                <span className="landing-bento-icon landing-bento-icon-rose" aria-hidden="true">
                  <Sun size={16} />
                </span>
                <h3>Semantic Understanding</h3>
                <p>Ada interprets intent, context, and relation between sources, not just keyword overlap.</p>
                <div className="landing-bento-tags">
                  <span>Vector_Embeddings</span>
                  <span>RAG_Pipeline</span>
                  <span>Scoped_Access</span>
                </div>
              </article>

              <article className="landing-bento-card landing-bento-summaries landing-reveal landing-delay-1">
                <span className="landing-bento-icon landing-bento-icon-gold" aria-hidden="true">
                  <Bolt size={16} />
                </span>
                <h3>Instant Summaries</h3>
                <p>Convert long transcripts and docs into clear decisions, actions, and owners in seconds.</p>
                <div className="landing-bento-accent" />
              </article>

              <div className="landing-bento-bottom">
                <article className="landing-bento-card landing-reveal landing-delay-2">
                  <span className="landing-bento-icon landing-bento-icon-green" aria-hidden="true">
                    <Users size={16} />
                  </span>
                  <h3>Team Permissions</h3>
                  <p>Granular workspace access ensures teams only see what they are authorized to view.</p>
                </article>

                <article className="landing-bento-card landing-bento-integration landing-reveal landing-delay-3">
                  <h3>Native Integration</h3>
                  <p>Designed to fit existing knowledge workflows without forcing teams into a new operating model.</p>
                  <Puzzle className="landing-bento-puzzle" size={72} />
                </article>
              </div>
            </div>
          </div>
        </section>

        <section id="enterprise" className="landing-cta">
          <img src={adaLogo} alt="Ada" className="landing-cta-logo landing-reveal" />
          <h2 className="landing-reveal">Let&apos;s grow your collective mind.</h2>
          <p className="landing-reveal">
            Join the private beta for organizations that value clarity, security, and elegant internal tooling.
          </p>
          <form className="landing-cta-form landing-reveal" onSubmit={(event) => event.preventDefault()}>
            <input type="email" placeholder="work@company.com" aria-label="Work email" />
            <button type="button" onClick={() => navigateTo('/login')}>Get Early Access</button>
          </form>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <img src={adaLogo} alt="Ada" className="landing-footer-logo" />
            <span>Ada</span>
          </div>
          <p>
            A warm, private knowledge assistant for organizations that care about people, process, and data trust.
          </p>
        </div>
        <div className="landing-footer-bottom">© 2026 Ada. Secure by design.</div>
      </footer>
    </div>
  );
}

export default Landing;
