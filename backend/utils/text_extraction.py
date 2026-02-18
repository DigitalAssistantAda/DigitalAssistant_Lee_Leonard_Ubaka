"""
Text extraction helpers for stored documents.
"""
from io import BytesIO
from typing import Tuple

from docx import Document as DocxDocument
from pypdf import PdfReader

from config import settings
from models.document import Document
from utils.storage import get_storage_backend


def _parse_storage_uri(storage_uri: str) -> Tuple[str, str]:
    try:
        scheme_split = storage_uri.split("://", 1)
        path_part = scheme_split[1] if len(scheme_split) == 2 else scheme_split[0]
        bucket, path = path_part.split("/", 1)
        return bucket, path
    except ValueError as exc:
        raise ValueError("Invalid storage URI for document") from exc


async def extract_text_from_storage(document: Document) -> str:
    """Download and extract text from the document's stored object."""
    if not document.storage_uri:
        return ""

    bucket, path = _parse_storage_uri(document.storage_uri)
    storage = get_storage_backend()
    data = await storage.download(bucket=bucket, path=path)

    if not data:
        return ""

    if document.mime_type == "text/plain":
        return data.decode("utf-8", errors="ignore")

    if document.mime_type == "application/pdf":
        reader = PdfReader(BytesIO(data))
        return "\n".join((page.extract_text() or "") for page in reader.pages).strip()

    if document.mime_type in {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    }:
        if document.mime_type == "application/msword":
            raise ValueError("Legacy .doc files are not supported")

        doc = DocxDocument(BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs).strip()

    raise ValueError(f"Unsupported mime type: {document.mime_type}")
