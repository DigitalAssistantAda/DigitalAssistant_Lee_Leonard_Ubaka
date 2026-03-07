"""
File storage abstraction layer - supports MinIO (dev) and S3 (prod)
"""
from abc import ABC, abstractmethod
from config import settings
import boto3
import io
from datetime import timedelta
from urllib.parse import quote
from botocore.config import Config


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

    @abstractmethod
    async def create_download_url(
        self,
        bucket: str,
        path: str,
        expires_seconds: int,
        filename: str | None = None,
        content_type: str | None = None,
    ) -> str:
        """Create a time-limited signed URL for downloading a file"""
        pass


def _build_content_disposition(filename: str | None) -> str | None:
    if not filename:
        return None

    safe_ascii = ''.join(ch if ord(ch) < 128 and ch not in {'"', '\\'} else '_' for ch in filename) or "download"
    utf8_name = quote(filename)
    return f"attachment; filename=\"{safe_ascii}\"; filename*=UTF-8''{utf8_name}"


class MinIOBackend(StorageBackend):
    """MinIO object storage backend (local development)"""
    
    def __init__(self):
        try:
            from minio import Minio
            from minio.error import S3Error
        except ImportError:
            raise ImportError("minio package is required for MinIO backend. Install with: pip install minio")
        
        self.S3Error = S3Error
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
        except self.S3Error as e:
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
        except self.S3Error as e:
            raise Exception(f"MinIO upload failed: {e}")
    
    async def download(self, bucket: str, path: str) -> bytes:
        """Download from MinIO"""
        try:
            response = self.client.get_object(bucket, path)
            return response.read()
        except self.S3Error as e:
            raise Exception(f"MinIO download failed: {e}")
    
    async def delete(self, bucket: str, path: str) -> bool:
        """Delete from MinIO"""
        try:
            self.client.remove_object(bucket, path)
            return True
        except self.S3Error as e:
            raise Exception(f"MinIO delete failed: {e}")

    async def create_download_url(
        self,
        bucket: str,
        path: str,
        expires_seconds: int,
        filename: str | None = None,
        content_type: str | None = None,
    ) -> str:
        """Create signed download URL for MinIO"""
        try:
            response_headers = {}
            content_disposition = _build_content_disposition(filename)
            if content_disposition:
                response_headers["response-content-disposition"] = content_disposition
            if content_type:
                response_headers["response-content-type"] = content_type

            return self.client.presigned_get_object(
                bucket,
                path,
                expires=timedelta(seconds=expires_seconds),
                response_headers=response_headers or None,
            )
        except self.S3Error as e:
            raise Exception(f"MinIO presigned URL generation failed: {e}")


class S3Backend(StorageBackend):
    """AWS S3 / Cloudflare R2 object storage backend (production)"""
    
    def __init__(self):
        self.endpoint_url = settings.s3_endpoint_url or None
        configured_region = (settings.s3_region or "").strip()
        if not configured_region:
            configured_region = "auto" if self.endpoint_url else "us-east-1"
        if not self.endpoint_url and configured_region == "auto":
            configured_region = "us-east-1"

        self.region_name = configured_region
        self.access_key_id = settings.s3_access_key_id
        self.secret_access_key = settings.s3_secret_access_key
        self.client = self._create_client(self.region_name)

    def _create_client(self, region_name: str):
        client_config = {
            "region_name": region_name,
            "aws_access_key_id": self.access_key_id,
            "aws_secret_access_key": self.secret_access_key,
            "config": Config(signature_version="s3v4"),
        }
        if self.endpoint_url:
            client_config["endpoint_url"] = self.endpoint_url
        return boto3.client("s3", **client_config)

    def _resolve_bucket_region(self, bucket: str) -> str:
        # For custom S3-compatible endpoints (e.g. R2), keep configured region.
        if self.endpoint_url:
            return self.region_name

        try:
            response = self.client.get_bucket_location(Bucket=bucket)
            return response.get("LocationConstraint") or "us-east-1"
        except Exception as e:
            # Some providers return region via response headers on errors/redirects.
            bucket_region = (
                getattr(e, "response", {})
                .get("ResponseMetadata", {})
                .get("HTTPHeaders", {})
                .get("x-amz-bucket-region")
            )
            if bucket_region:
                return bucket_region

        try:
            self.client.head_bucket(Bucket=bucket)
            # If request succeeds, the active region is valid for this bucket.
            return self.client.meta.region_name or self.region_name
        except Exception as e:
            bucket_region = (
                getattr(e, "response", {})
                .get("ResponseMetadata", {})
                .get("HTTPHeaders", {})
                .get("x-amz-bucket-region")
            )
            if bucket_region:
                return bucket_region

            return self.region_name
    
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

    async def create_download_url(
        self,
        bucket: str,
        path: str,
        expires_seconds: int,
        filename: str | None = None,
        content_type: str | None = None,
    ) -> str:
        """Create signed download URL for S3-compatible storage"""
        try:
            signing_client = self.client
            bucket_region = self._resolve_bucket_region(bucket)
            if not self.endpoint_url and bucket_region and bucket_region != self.client.meta.region_name:
                signing_client = self._create_client(bucket_region)

            params = {
                "Bucket": bucket,
                "Key": path,
            }
            content_disposition = _build_content_disposition(filename)
            if content_disposition:
                params["ResponseContentDisposition"] = content_disposition
            if content_type:
                params["ResponseContentType"] = content_type

            return signing_client.generate_presigned_url(
                "get_object",
                Params=params,
                ExpiresIn=expires_seconds,
            )
        except Exception as e:
            raise Exception(f"S3 presigned URL generation failed: {e}")


# Factory function to get appropriate storage backend
def get_storage_backend() -> StorageBackend:
    """Returns the configured storage backend"""
    if settings.storage_type == "s3":
        return S3Backend()
    else:  # Default to MinIO
        return MinIOBackend()


# Global storage instance
storage = get_storage_backend()
