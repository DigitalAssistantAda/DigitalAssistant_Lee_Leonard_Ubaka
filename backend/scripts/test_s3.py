"""
Test script to verify AWS S3 connection and operations
Run from backend directory: python scripts/test_s3.py
"""
import asyncio
import sys
import os

# Add parent directory to path to import config
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import settings
from utils.storage import storage


async def test_s3_connection():
    """Test S3 upload, download, and delete operations"""
    
    print("=" * 60)
    print("AWS S3 Connection Test")
    print("=" * 60)
    print(f"\nStorage Type: {settings.storage_type}")
    print(f"Bucket: {settings.storage_bucket}")
    print(f"Region: {settings.s3_region}")
    print(f"Endpoint: {settings.s3_endpoint_url or 'Default AWS S3'}")
    print(f"Access Key: {settings.s3_access_key_id[:10]}..." if settings.s3_access_key_id else "Access Key: Not set")
    print()
    
    # Test data
    test_filename = "test-file.txt"
    test_path = f"test/{test_filename}"
    test_data = b"Hello from Ada! This is a test file."
    test_content_type = "text/plain"
    
    try:
        # Test 1: Upload
        print("📤 Test 1: Uploading test file...")
        storage_uri = await storage.upload(
            bucket=settings.storage_bucket,
            path=test_path,
            data=test_data,
            content_type=test_content_type
        )
        print(f"✅ Upload successful! URI: {storage_uri}")
        print()
        
        # Test 2: Download
        print("📥 Test 2: Downloading test file...")
        downloaded_data = await storage.download(
            bucket=settings.storage_bucket,
            path=test_path
        )
        
        if downloaded_data == test_data:
            print(f"✅ Download successful! Data matches ({len(downloaded_data)} bytes)")
        else:
            print(f"❌ Download failed: Data mismatch")
            return False
        print()
        
        # Test 3: Delete
        print("🗑️  Test 3: Deleting test file...")
        deleted = await storage.delete(
            bucket=settings.storage_bucket,
            path=test_path
        )
        
        if deleted:
            print("✅ Delete successful!")
        else:
            print("❌ Delete failed")
            return False
        print()
        
        print("=" * 60)
        print("✅ ALL TESTS PASSED - AWS S3 is working correctly!")
        print("=" * 60)
        return True
        
    except Exception as e:
        print(f"\n❌ ERROR: {str(e)}")
        print("\nCommon issues:")
        print("  - Check your AWS credentials are correct")
        print("  - Verify the bucket exists and you have permissions")
        print("  - Ensure the AWS region is correct")
        print("  - Check if bucket name contains uppercase letters (not allowed)")
        print("=" * 60)
        return False


if __name__ == "__main__":
    success = asyncio.run(test_s3_connection())
    sys.exit(0 if success else 1)
