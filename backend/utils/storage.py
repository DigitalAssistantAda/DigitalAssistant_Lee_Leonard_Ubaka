"""
File storage abstraction layer - supports MinIO (dev) and S3 (prod)
"""
from abc import ABC, abstractmethod
from config import settings
import boto3
from minio import Minio
from minio.error import S3Error
import io


class StorageBackend(ABC):
    """Abstract base class for storage backends"""
    
    @abstractmethod
    async def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> str:
        """Upload file and return storage URI"""
        pass
    
    @abstractmethod
    async def download(self, bucket: str, path: str) -> bytes:
        """Download file by path"""
        pass
    
    @abstractmethod
    async def delete(self, bucket: str, path: str) -> bool:
        """Delete file"""
        pass


class MinIOBackend(StorageBackend):
    """MinIO object storage backend (local development)"""
    
    def __init__(self):
        self.client = Minio(
            settings.minio_url.replace("http://", ""),
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=False
        )
        self._ensure_bucket()
    
    def _ensure_bucket(self):
        """Create bucket if it doesn't exist"""
        try:
            if not self.client.bucket_exists(settings.storage_bucket):
                self.client.make_bucket(settings.storage_bucket)
        except S3Error as e:
            print(f"Error checking/creating bucket: {e}")
    
    async def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> str:
        """Upload to MinIO"""
        try:
            self.client.put_object(
                bucket,
                path,
                io.BytesIO(data),
                len(data),
                content_type=content_type
            )
            return f"minio://{bucket}/{path}"
        except S3Error as e:
            raise Exception(f"MinIO upload failed: {e}")
    
    async def download(self, bucket: str, path: str) -> bytes:
        """Download from MinIO"""
        try:
            response = self.client.get_object(bucket, path)
            return response.read()
        except S3Error as e:
            raise Exception(f"MinIO download failed: {e}")
    
    async def delete(self, bucket: str, path: str) -> bool:
        """Delete from MinIO"""
        try:
            self.client.remove_object(bucket, path)
            return True
        except S3Error as e:
            raise Exception(f"MinIO delete failed: {e}")


class S3Backend(StorageBackend):
    """AWS S3 / Cloudflare R2 object storage backend (production)"""
    
    def __init__(self):
        # Support both AWS S3 and Cloudflare R2 (S3-compatible)
        client_config = {
            "region_name": settings.s3_region,
            "aws_access_key_id": settings.s3_access_key,
            "aws_secret_access_key": settings.s3_secret_key
        }
        
        # Add custom endpoint for R2 or S3-compatible services
        if settings.s3_endpoint_url:
            client_config["endpoint_url"] = settings.s3_endpoint_url
        
        self.client = boto3.client("s3", **client_config)
    
    async def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> str:
        """Upload to S3"""
        try:
            self.client.put_object(
                Bucket=bucket,
                Key=path,
                Body=data,
                ContentType=content_type
            )
            return f"s3://{bucket}/{path}"
        except Exception as e:
            raise Exception(f"S3 upload failed: {e}")
    
    async def download(self, bucket: str, path: str) -> bytes:
        """Download from S3"""
        try:
            response = self.client.get_object(Bucket=bucket, Key=path)
            return response["Body"].read()
        except Exception as e:
            raise Exception(f"S3 download failed: {e}")
    
    async def delete(self, bucket: str, path: str) -> bool:
        """Delete from S3"""
        try:
            self.client.delete_object(Bucket=bucket, Key=path)
            return True
        except Exception as e:
            raise Exception(f"S3 delete failed: {e}")


# Factory function to get appropriate storage backend
def get_storage_backend() -> StorageBackend:
    """Returns the configured storage backend"""
    if settings.storage_type == "s3":
        return S3Backend()
    else:  # Default to MinIO
        return MinIOBackend()


# Global storage instance
storage = get_storage_backend()
