from pydantic_settings import BaseSettings
from dotenv import load_dotenv
import os

# Load environment variables from .env file
load_dotenv()


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
    
    # Embeddings Settings - Using Voyage AI (privacy-first, high quality)
    embedding_service: str = os.getenv("EMBEDDING_SERVICE", "voyage")  # "voyage"
    voyage_api_key: str = os.getenv("VOYAGE_API_KEY", "")
    voyage_model: str = os.getenv("VOYAGE_MODEL", "voyage-2")  # Or "voyage-large-2-instruct"
    embedding_dimensions: int = 1024  # voyage-2 uses 1024 dims

    # LLM Summary Settings (supports anthropic, openai, azure)
    summary_llm_enabled: bool = os.getenv("SUMMARY_LLM_ENABLED", "true").lower() == "true"
    summary_llm_provider: str = os.getenv("SUMMARY_LLM_PROVIDER", "anthropic")  # anthropic | openai | azure
    summary_llm_api_url: str = os.getenv("SUMMARY_LLM_API_URL", "https://api.anthropic.com/v1/messages")
    summary_llm_api_key: str = os.getenv("SUMMARY_LLM_API_KEY", "")
    summary_llm_model: str = os.getenv("SUMMARY_LLM_MODEL", "claude-3-haiku-20240307")
    summary_llm_timeout_seconds: int = int(os.getenv("SUMMARY_LLM_TIMEOUT_SECONDS", "45"))
    summary_llm_max_input_chars: int = int(os.getenv("SUMMARY_LLM_MAX_INPUT_CHARS", "12000"))
    summary_llm_temperature: float = float(os.getenv("SUMMARY_LLM_TEMPERATURE", "0.2"))
    summary_llm_max_output_tokens: int = int(os.getenv("SUMMARY_LLM_MAX_OUTPUT_TOKENS", "500"))

    # n8n Integration
    n8n_embeddings_trigger_url: str = os.getenv("N8N_EMBEDDINGS_TRIGGER_URL", "")
    n8n_webhook_secret: str = os.getenv("N8N_WEBHOOK_SECRET", "")
    
    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"


settings = Settings()

