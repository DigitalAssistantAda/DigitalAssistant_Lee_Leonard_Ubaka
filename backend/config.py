from pydantic_settings import BaseSettings
from dotenv import load_dotenv
import os

# Load environment variables from .env file
try:
    load_dotenv()
except OSError:
    # On some macOS/iCloud-mounted paths, reading .env can raise
    # "Resource deadlock avoided". Docker env_file still provides vars.
    pass


class Settings(BaseSettings):
    """Application configuration"""
    
    # API Settings
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: str = "http://localhost:3000"
    
    # Database Settings - PostgreSQL for metadata/embeddings
    # Use DATABASE_URL from .env if available, otherwise default to Docker container
    database_url: str = os.getenv(
        "DATABASE_URL", 
        "postgresql://postgres:postgres@db:5432/digitalassistant"
    )
    
    # JWT Authentication
    jwt_secret: str = os.getenv("JWT_SECRET", "dev-secret-key-change-in-production")
    jwt_algorithm: str = "HS256"
    jwt_expiration: int = 3600
    
    # Redis Settings (for background jobs)
    redis_url: str = os.getenv("REDIS_URL", "redis://redis:6379")
    
    # File Storage Settings - Object Storage (MinIO for dev, S3/R2 for prod)
    storage_type: str = os.getenv("STORAGE_TYPE", "minio")  # "minio", "s3", or "r2" (all use S3 API)
    storage_bucket: str = os.getenv("STORAGE_BUCKET", "documents")
    
    # MinIO Settings (for local development)
    minio_url: str = "http://minio:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    
    # S3/R2 Settings (for production and team development)
    # For R2: set storage_type="s3" and use R2 endpoint as s3_endpoint_url
    s3_endpoint_url: str = ""  # R2: https://<account-id>.r2.cloudflarestorage.com
    s3_region: str = "auto"  # R2 uses "auto", AWS uses region like "us-east-1"
    s3_access_key_id: str = ""  # AWS Access Key ID
    s3_secret_access_key: str = ""  # AWS Secret Access Key
    download_url_ttl_seconds: int = int(os.getenv("DOWNLOAD_URL_TTL_SECONDS", "3600"))
    
    # Environment
    environment: str = "development"
    debug: bool = True
    
    # Supabase Settings (optional, for direct API access)
    supabase_url: str = ""
    supabase_anon_key: str = ""
    
    # Embeddings Settings - local (Sentence Transformers) or voyage (API)
    embedding_service: str = os.getenv("EMBEDDING_SERVICE", "local")  # "local" | "voyage"
    # Local model (Sentence Transformers) - used when EMBEDDING_SERVICE=local
    local_embedding_model: str = os.getenv(
        "LOCAL_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
    )
    local_embedding_model_path: str = os.getenv("LOCAL_EMBEDDING_MODEL_PATH", "")  # Optional: path to fine-tuned model
    embedding_finetune_output_dir: str = os.getenv("EMBEDDING_FINETUNE_OUTPUT_DIR", "./data/embedding_model")
    # Voyage AI (used when EMBEDDING_SERVICE=voyage)
    voyage_api_key: str = os.getenv("VOYAGE_API_KEY", "")
    voyage_model: str = os.getenv("VOYAGE_MODEL", "voyage-2")
    # Dimension is derived from model; override only if needed (e.g. after fine-tune with same dim)
    embedding_dimensions: int = int(os.getenv("EMBEDDING_DIMENSIONS", "0"))  # 0 = auto from model

    # Smart container suggestion (semantic neighbors + light folder-name overlap)
    suggestion_chunk_limit: int = int(os.getenv("SUGGESTION_CHUNK_LIMIT", "10"))
    suggestion_embed_max_chars: int = int(os.getenv("SUGGESTION_EMBED_MAX_CHARS", "8000"))
    suggestion_neighbor_max_docs: int = int(os.getenv("SUGGESTION_NEIGHBOR_MAX_DOCS", "80"))
    suggestion_min_doc_similarity: float = float(os.getenv("SUGGESTION_MIN_DOC_SIMILARITY", "0.12"))
    suggestion_fallback_chunk_limit: int = int(os.getenv("SUGGESTION_FALLBACK_CHUNK_LIMIT", "100"))
    suggestion_fallback_threshold: float = float(os.getenv("SUGGESTION_FALLBACK_THRESHOLD", "0.14"))
    suggestion_keyword_boost_max: float = float(os.getenv("SUGGESTION_KEYWORD_BOOST_MAX", "0.08"))

    # LLM Summary Settings (supports anthropic, openai, azure)
    summary_llm_enabled: bool = os.getenv("SUMMARY_LLM_ENABLED", "true").lower() == "true"
    summary_llm_provider: str = os.getenv("SUMMARY_LLM_PROVIDER", "anthropic")  # anthropic | openai | azure
    summary_llm_api_url: str = os.getenv("SUMMARY_LLM_API_URL", "https://api.anthropic.com/v1/messages")
    summary_llm_api_key: str = os.getenv("SUMMARY_LLM_API_KEY", "")
    summary_llm_model: str = os.getenv("SUMMARY_LLM_MODEL", "claude-3-haiku-20241022")
    summary_llm_timeout_seconds: int = int(os.getenv("SUMMARY_LLM_TIMEOUT_SECONDS", "45"))
    summary_llm_max_input_chars: int = int(os.getenv("SUMMARY_LLM_MAX_INPUT_CHARS", "12000"))
    summary_llm_temperature: float = float(os.getenv("SUMMARY_LLM_TEMPERATURE", "0.2"))
    summary_llm_max_output_tokens: int = int(os.getenv("SUMMARY_LLM_MAX_OUTPUT_TOKENS", "500"))
    # Conversation memory window passed to LLM refinement (last N prior turns)
    conversation_memory_window_enabled: bool = os.getenv("CONVERSATION_MEMORY_WINDOW_ENABLED", "true").lower() == "true"
    conversation_memory_window_messages: int = int(os.getenv("CONVERSATION_MEMORY_WINDOW_MESSAGES", "8"))
    conversation_memory_window_max_chars: int = int(os.getenv("CONVERSATION_MEMORY_WINDOW_MAX_CHARS", "3500"))

    # Issue reminders: bi-encoder retrieval + cross-encoder rerank (SentenceTransformers) + optional LLM
    reminder_cross_encoder_enabled: bool = os.getenv("REMINDER_CROSS_ENCODER_ENABLED", "true").lower() == "true"
    reminder_cross_encoder_model: str = os.getenv(
        "REMINDER_CROSS_ENCODER_MODEL",
        "cross-encoder/ms-marco-MiniLM-L-6-v2",
    )
    # Prefer generative LLM suggestions over regex when merging (still runs both)
    reminder_generative_first: bool = os.getenv("REMINDER_GENERATIVE_FIRST", "true").lower() == "true"
    reminder_llm_max_suggestions: int = int(os.getenv("REMINDER_LLM_MAX_SUGGESTIONS", "5"))

    # Trained sklearn classifier on embeddings (see scripts/train_reminder_classifier.py)
    reminder_classifier_enabled: bool = os.getenv("REMINDER_CLASSIFIER_ENABLED", "true").lower() == "true"
    reminder_classifier_path: str = os.getenv(
        "REMINDER_CLASSIFIER_PATH",
        str(os.path.join(os.path.dirname(__file__), "data", "reminder_classifier_bundle.joblib")),
    )
    reminder_classifier_min_prob: float = float(os.getenv("REMINDER_CLASSIFIER_MIN_PROB", "0.38"))
    reminder_classifier_max_snippets: int = int(os.getenv("REMINDER_CLASSIFIER_MAX_SNIPPETS", "48"))
    reminder_classifier_max_hints: int = int(os.getenv("REMINDER_CLASSIFIER_MAX_HINTS", "6"))

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"


settings = Settings()
