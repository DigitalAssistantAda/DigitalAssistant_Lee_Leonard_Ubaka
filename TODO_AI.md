AI TODO

feature status
- semantic document search using embeddings + vector similarity (pgvector): implemented
- duplicate document detection (high-similarity match checks): partial
- automatic document hints (needs review/action items/expiration cues): partial
- ai-assisted summaries of uploaded content: partial (basic extractive summary)
- chat/q&a over workspace documents (rag-style retrieval + response): partial
- smart organization support (auto-tags/folder suggestions from content): planned
- task-aware intelligence (link docs to tasks and suggest follow-ups): planned
- webhook automation hooks (n8n triggers for embedding jobs/status): implemented

done
- upload triggers embeddings automatically
- n8n webhook flow is wired
- embedding_jobs table is active and receives rows
- search endpoint supports semantic retrieval with keyword fallback
- conversations endpoint returns retrieval-based assistant replies
- summaries endpoint exists (simple extractive summary)

broken or partial
- ai assistant page is retrieval mode, not full llm answer generation
- selected documents in UI are not enforced in backend retrieval logic
- n8n can return 422 if payload shape/types are wrong
- legacy jobs table is mostly unused; embedding_jobs is the active tracker

next
- make n8n http request node send strict json body:
  - document_id
  - workspace_id
  - triggered_by
- add server-side validation/logging for webhook payload mismatch to surface 422 cause clearly
- implement real rag answer generation (llm call with retrieved chunks)
- add conversation memory window (last N messages) to response building
- add one integration test: upload -> n8n webhook -> embedding_jobs row -> search/chat returns grounded result

