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

    try:
        bucket, path = _parse_storage_uri(document.storage_uri)
        storage = get_storage_backend()
        data = await storage.download(bucket=bucket, path=path)
    except Exception as exc:
        raise ValueError("Document content could not be processed.") from exc

    if not data:
        return ""

    if document.mime_type == "text/plain":
        return data.decode("utf-8", errors="ignore")

    if document.mime_type == "application/pdf":
        try:
            reader = PdfReader(BytesIO(data))
            return "\n".join((page.extract_text() or "") for page in reader.pages).strip()
        except Exception as exc:
            raise ValueError("Document content could not be processed.") from exc

    if document.mime_type in {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    }:
        if document.mime_type == "application/msword":
            raise ValueError("Document format is not supported.")

        try:
            doc = DocxDocument(BytesIO(data))
            return "\n".join(p.text for p in doc.paragraphs).strip()
        except Exception as exc:
            raise ValueError("Document content could not be processed.") from exc

    raise ValueError("Document format is not supported.")
