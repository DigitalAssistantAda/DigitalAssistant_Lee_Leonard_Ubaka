```mermaid
flowchart TD
    A["User Uploads File"] --> B["Object Storage: AWS S3 <br/>/ MinIO<br/>(stores raw file with versioning metadata)"]
    B --> C["Background Processing: <br/> Celery Worker<br/>(triggered on upload event <br/> via task queue)"]
    C --> D["Processing Pipeline<br/>1. Extract text from PDF, <br>DOCX, TXT<br/>2. Chunk into semantic <br> segments<br/>3. Generate vector<br> embeddings<br/>4. Check for<br> near-duplicate content<br/>5. Auto-tag with metadata<br> labels<br/>6. Detect and link related<br> documents<br/>7. Identify deadline or date<br> references"]
    D --> E["PostgreSQL Tables<br/>document_chunks<br/>chunk_embeddings<br/>doc_metadata<br/>doc_relationships<br/>duplicate_check<br/>task_doc_links<br/>reminder_candidates"]
    E --> F["pgvector<br/>Vector index for<br/>semantic similarity queries"]
    F --> G["AI Feature Layer<br/>(OpenAI API<br/>or local model endpoint)"]
    G --> H["SEARCH<br/>Vector query over chunks<br/>plus RAG-generated answer<br/>with source attribution"]
    G --> I["DUPLICATE DETECTION<br/>Cosine similarity at 95%+<br/>triggers dedup flag"]
    G --> J["CHAT<br/>Multi-turn conversation<br/>with sliding context window<br/>over retrieved chunks"]
    G --> K["ORGANIZATION<br/>Smart folder and tag placement<br/>based on document content<br/>and existing structure"]
    G --> L["PROJECT LINKING<br/>Auto-suggest related tasks<br/>or projects<br/>based on document topic<br/>and metadata"]
    G --> M["REMINDERS<br/>Deadline and date extraction<br/>from document text<br/>to generate<br/>reminder candidates"]
    G --> N["SUMMARIES<br/>Retrieve top-ranked chunks<br/>and generate<br/>structured summary<br/>with key points"]
```

| Component | What It Is | Current Role in Ada | Expanded Role |
|---|---|---|---|
| pgvector | PostgreSQL extension for storing and querying vector embeddings | Semantic search over document chunks for RAG | Powers duplicate detection via cosine similarity, smart organization by topic, contextual reminder matching, task suggestions, and multi-turn conversation context retrieval |
| AWS S3 / MinIO | S3-compatible object storage backend | Store raw uploaded files | Store raw files with versioning support; enable rollback and deduplication tracking; maintain file relationship metadata for linked documents |
| Celery with Redis | Distributed task queue for background processing | Could automate processing pipelines | Orchestrate the full ingestion pipeline: extract text, chunk content, generate embeddings, detect duplicates, auto-organize, apply tags, and link to tasks asynchronously |
| PostgreSQL | Primary relational database | Stores user records, file metadata, and task data | Now requires additional tables for deduplication tracking, document relationship graphs, embedding metadata, task-to-document links, and reminder candidates extracted from document content |