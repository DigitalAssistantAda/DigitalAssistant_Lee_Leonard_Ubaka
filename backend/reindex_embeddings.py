#!/usr/bin/env python3
"""
Re-index all document chunk embeddings using the Voyage AI API.

Connects directly to the database, deletes stale chunk_embeddings rows,
and generates fresh embeddings for every document_chunk under the correct
model name (voyage-2).  No Celery worker required.

Usage:
    cd backend
    python reindex_embeddings.py            # re-index everything
    python reindex_embeddings.py --dry-run  # preview without writing
"""
import os
import sys
import time
import argparse
import requests
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
VOYAGE_API_KEY = os.getenv("VOYAGE_API_KEY")
VOYAGE_MODEL = os.getenv("VOYAGE_MODEL", "voyage-2")
VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings"
BATCH_SIZE = 25  # Voyage supports up to 128 texts, but keep batches small to avoid timeouts


def voyage_embed_batch(texts: list[str], input_type: str = "document") -> list[list[float]]:
    resp = requests.post(
        VOYAGE_API_URL,
        headers={
            "Authorization": f"Bearer {VOYAGE_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": VOYAGE_MODEL,
            "input": texts,
            "input_type": input_type,
        },
        timeout=60,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Voyage API error ({resp.status_code}): {resp.text[:300]}")
    data = resp.json()
    embeddings = sorted(data["data"], key=lambda x: x["index"])
    return [item["embedding"] for item in embeddings]


def main():
    parser = argparse.ArgumentParser(description="Re-index embeddings via Voyage AI")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing to the database")
    args = parser.parse_args()

    if not DATABASE_URL:
        sys.exit("ERROR: DATABASE_URL not set. Make sure backend/.env is configured.")
    if not VOYAGE_API_KEY:
        sys.exit("ERROR: VOYAGE_API_KEY not set. Make sure backend/.env is configured.")

    engine = create_engine(DATABASE_URL)
    Session = sessionmaker(bind=engine)
    db = Session()

    try:
        # 1. Count what we're working with
        total_chunks = db.execute(text("SELECT COUNT(*) FROM document_chunks")).scalar()
        stale_count = db.execute(
            text("SELECT COUNT(*) FROM chunk_embeddings WHERE model_name != :model"),
            {"model": VOYAGE_MODEL},
        ).scalar()
        current_count = db.execute(
            text("SELECT COUNT(*) FROM chunk_embeddings WHERE model_name = :model"),
            {"model": VOYAGE_MODEL},
        ).scalar()
        missing_count = total_chunks - current_count

        print(f"Total document chunks:          {total_chunks}")
        print(f"Embeddings with '{VOYAGE_MODEL}': {current_count}")
        print(f"Stale embeddings (wrong model): {stale_count}")
        print(f"Chunks needing new embeddings:  {missing_count}")
        print()

        if args.dry_run:
            print("[DRY RUN] No changes written.")
            return

        if total_chunks == 0:
            print("No document chunks found. Upload some documents first.")
            return

        # 2. Delete stale embeddings (wrong model name)
        if stale_count > 0:
            print(f"Deleting {stale_count} stale embedding(s)...")
            db.execute(
                text("DELETE FROM chunk_embeddings WHERE model_name != :model"),
                {"model": VOYAGE_MODEL},
            )
            db.commit()
            print("  Done.")

        # 3. Find all chunks that are missing a voyage-2 embedding
        rows = db.execute(text("""
            SELECT dc.id, dc.text
            FROM document_chunks dc
            LEFT JOIN chunk_embeddings ce
                ON ce.chunk_id = dc.id AND ce.model_name = :model
            WHERE ce.chunk_id IS NULL
            ORDER BY dc.id
        """), {"model": VOYAGE_MODEL}).fetchall()

        if not rows:
            print("All chunks already have up-to-date embeddings. Nothing to do.")
            return

        print(f"Generating embeddings for {len(rows)} chunk(s) in batches of {BATCH_SIZE}...")
        embedded = 0
        for i in range(0, len(rows), BATCH_SIZE):
            batch = rows[i : i + BATCH_SIZE]
            chunk_ids = [r[0] for r in batch]
            texts = [r[1] for r in batch]

            embeddings = voyage_embed_batch(texts)

            for chunk_id, embedding in zip(chunk_ids, embeddings):
                embedding_literal = "{" + ",".join(str(v) for v in embedding) + "}"
                db.execute(
                    text("""
                        INSERT INTO chunk_embeddings (chunk_id, model_name, embedding)
                        VALUES (:chunk_id, :model, CAST(:embedding AS real[]))
                        ON CONFLICT (chunk_id, model_name) DO UPDATE
                            SET embedding = CAST(:embedding AS real[]),
                                created_at = NOW()
                    """),
                    {"chunk_id": chunk_id, "model": VOYAGE_MODEL, "embedding": embedding_literal},
                )

            db.commit()
            embedded += len(batch)
            pct = int(embedded / len(rows) * 100)
            print(f"  [{pct:3d}%] {embedded}/{len(rows)} chunks embedded")

            if i + BATCH_SIZE < len(rows):
                time.sleep(0.3)

        print()
        print(f"Done! {embedded} chunk(s) re-indexed under model_name='{VOYAGE_MODEL}'.")

    except KeyboardInterrupt:
        print("\nInterrupted. Partial progress has been committed.")
    except Exception as e:
        db.rollback()
        print(f"\nERROR: {e}")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
