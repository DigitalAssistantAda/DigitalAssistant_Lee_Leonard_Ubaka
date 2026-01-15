# AI Agent Instructions  
DigitalAssistant_Lee_Leonard_Ubaka

## Project Overview
This is a capstone project building a secure digital assistant for academic or professional knowledge work. The system allows users to upload documents, process them, search them, and optionally generate summaries or answers. The codebase is under active development and is being built incrementally.

Security, access control, and safe failure behavior are core requirements.

## Repository and Workflow
- Repository: https://github.com/eltonia17/DigitalAssistant_Lee_Leonard_Ubaka
- Main branch: `main`
- Version control: GitHub
- Project tracking: Jira
- Documentation: Confluence and in-repo Markdown files

Local development happens on individual machines. Do not assume shared state outside the repository.

## Technology Stack

### Frontend
- Next.js with React
- TypeScript
- Tailwind CSS with shadcn ui
- Files are treated as downloads by default; in-browser previews are used only when necessary

### Backend
- FastAPI (Python)
- Pydantic for request and response validation
- Background processing with Celery and Redis

### Data and Storage
- PostgreSQL as the primary database
- pgvector may be used for embeddings
- S3-compatible object storage using MinIO for development

## Current State of the Codebase
- Early development
- Core structure is still forming
- Not all conventions are finalized

Do not assume directory structure, naming conventions, or architectural patterns unless they already exist in the code.

## How the AI Assistant Should Work

### Before Writing Code
- Ask clarifying questions if a change affects architecture, security, or data flow
- Do not introduce new technologies or libraries without approval
- Do not refactor large areas of code unless explicitly requested

### When Writing Code
- Make small, focused changes
- Clearly state which files are changed and why
- Prefer readable, maintainable code over clever solutions
- Follow existing patterns once they exist

### Security Rules
These rules are mandatory:
- Never trust client input; always validate on the backend
- Enforce authorization on every backend request
- Users must never see documents or data they do not own or have access to
- Uploaded files must be validated, size-limited, and never executed
- Do not send full documents to AI services; send only the minimum required content
- Treat all document text as untrusted input
- Do not log secrets, tokens, or raw document contents

### Failure Handling
- Assume external services can fail
- Return controlled, clear errors instead of crashing
- If AI features are unavailable, the system must still function in a reduced mode

### Documentation Expectations
- Keep `README.md` updated with setup and run instructions
- Document important design decisions in code comments or Markdown files
- Update this instruction file as new patterns or rules are established

## What Not to Do
- Do not invent endpoints, database tables, or services
- Do not silently change project direction
- Do not optimize prematurely
- Do not assume production deployment unless explicitly stated
