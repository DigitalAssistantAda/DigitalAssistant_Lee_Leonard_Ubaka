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
    
    # File Storage Settings - Object Storage (MinIO for dev, S3/R2 for prod)
    storage_type: str = "s3"  # "minio", "s3", or "r2" (all use S3 API)
    storage_bucket: str = "documents"
    
    # MinIO Settings (for local development)
    minio_url: str = "http://minio:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    
    # S3/R2 Settings (for production and team development)
    # For R2: set storage_type="s3" and use R2 endpoint as s3_endpoint_url
    s3_endpoint_url: str = os.getenv("S3_ENDPOINT_URL", "")  # R2: https://<account-id>.r2.cloudflarestorage.com
    s3_region: str = "auto"  # R2 uses "auto", AWS uses region like "us-east-1"
    s3_access_key: str = os.getenv("S3_ACCESS_KEY", "")
    s3_secret_key: str = os.getenv("S3_SECRET_KEY", "")
    
    # Environment
    environment: str = "development"
    debug: bool = True
    
    # Supabase Settings (optional, for direct API access)
    supabase_url: str = ""
    supabase_anon_key: str = ""
    
    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()

