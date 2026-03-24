AI TODO

feature status
- semantic document search using embeddings + vector similarity (pgvector): implemented
- duplicate document detection (high-similarity match checks): partial
- automatic document hints (needs review/action items/expiration cues): partial
- ai-assisted summaries of uploaded content: partial (basic extractive summary)
- chat/q&a over workspace documents (rag-style retrieval + response): partial
- smart organization support (auto-tags/folder suggestions from content): planned
- task-aware intelligence (link docs to tasks and suggest follow-ups): planned
- webhook automation hooks for embedding jobs: removed (Celery-only for now)

done
- upload triggers embeddings automatically (Celery)
- embedding_jobs table is active and receives rows
- search endpoint supports semantic retrieval with keyword fallback
- conversations endpoint returns retrieval-based assistant replies
- summaries endpoint exists (simple extractive summary)
- chat retrieval is scoped to selected documents when the client sends `document_ids` (vector + keyword paths both respect scope)

broken or partial
- ai assistant page is retrieval mode, not full llm answer generation
- legacy `jobs` table removed (use `embedding_jobs`); run `backend/scripts/drop_legacy_jobs_table.sql` on existing DBs if the table still exists

next
- implement real rag answer generation (llm call with retrieved chunks)
- add conversation memory window (last N messages) to response building
- add one integration test: upload -> Celery worker -> embedding_jobs row -> search/chat returns grounded result

