"""
Seed script to populate database with test data for development
Creates a user "Moira" with realistic workspaces, documents, and activity
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from passlib.context import CryptContext

# Add backend to path
sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal, engine
from models.tenant import Tenant, TenantStatus
from models.user import User
from models.workspace import Workspace, WorkspaceMember, WorkspaceRole, MemberStatus
from models.document import Document
from models.audit_log import AuditLog
from models.message import Message

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def clear_existing_data(db: Session):
    """Clear existing test data"""
    print("Clearing existing data...")
    db.query(Message).delete()
    db.query(AuditLog).delete()
    db.query(Document).delete()
    db.query(WorkspaceMember).delete()
    db.query(Workspace).delete()
    db.query(User).delete()
    db.query(Tenant).delete()
    db.commit()
    print("✓ Data cleared")


def create_tenant(db: Session) -> Tenant:
    """Create Figma tenant"""
    print("\nCreating tenant: Figma...")
    tenant = Tenant(
        name="Figma",
        status=TenantStatus.ACTIVE
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    print(f"✓ Tenant created (ID: {tenant.id})")
    return tenant


def create_user(db: Session, tenant: Tenant) -> User:
    """Create Moira, a project manager at Figma"""
    print("\nCreating user: Moira Rose...")
    user = User(
        email="moira.rose@figma.com",
        username="moira.rose",
        hashed_password=pwd_context.hash("FigmaProject2024!"),
        tenant_id=tenant.id,
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    print(f"✓ User created (ID: {user.id}, Email: {user.email})")
    print(f"  Password: FigmaProject2024!")
    return user


def create_workspaces(db: Session, user: User) -> list:
    """Create realistic workspaces for a project manager"""
    print("\nCreating workspaces...")
    
    workspaces_data = [
        {"name": "Product Design System", "days_ago": 45},
        {"name": "Q1 2026 Roadmap", "days_ago": 30},
        {"name": "User Research Repository", "days_ago": 60},
        {"name": "Marketing Assets", "days_ago": 15},
        {"name": "Engineering Handoffs", "days_ago": 20},
    ]
    
    workspaces = []
    for ws_data in workspaces_data:
        workspace = Workspace(
            name=ws_data["name"],
            tenant_id=user.tenant_id,
            created_by=user.id,
            created_at=datetime.now(timezone.utc) - timedelta(days=ws_data["days_ago"])
        )
        db.add(workspace)
        db.flush()
        
        # Add user as owner
        member = WorkspaceMember(
            workspace_id=workspace.id,
            user_id=user.id,
            role=WorkspaceRole.OWNER,
            status=MemberStatus.ACTIVE,
            joined_at=workspace.created_at
        )
        db.add(member)
        workspaces.append(workspace)
        print(f"  ✓ {workspace.name}")
    
    db.commit()
    return workspaces


def create_documents(db: Session, user: User, workspaces: list):
    """Create realistic documents across workspaces"""
    print("\nCreating documents...")
    
    documents_data = [
        # Product Design System workspace
        {"workspace_idx": 0, "filename": "Component Library v2.3.fig", "size_kb": 4500, "days_ago": 2},
        {"workspace_idx": 0, "filename": "Design Tokens Spec.pdf", "size_kb": 850, "days_ago": 5},
        {"workspace_idx": 0, "filename": "Accessibility Guidelines.docx", "size_kb": 320, "days_ago": 10},
        
        # Q1 2026 Roadmap workspace
        {"workspace_idx": 1, "filename": "Q1 OKRs Final.xlsx", "size_kb": 125, "days_ago": 1},
        {"workspace_idx": 1, "filename": "Feature Prioritization Matrix.pdf", "size_kb": 680, "days_ago": 3},
        {"workspace_idx": 1, "filename": "Stakeholder Deck.pptx", "size_kb": 2100, "days_ago": 7},
        
        # User Research Repository workspace
        {"workspace_idx": 2, "filename": "User Interview Transcripts - Jan 2026.txt", "size_kb": 450, "days_ago": 15},
        {"workspace_idx": 2, "filename": "Usability Test Results.pdf", "size_kb": 1200, "days_ago": 20},
        {"workspace_idx": 2, "filename": "Customer Journey Map.fig", "size_kb": 3200, "days_ago": 25},
        
        # Marketing Assets workspace
        {"workspace_idx": 3, "filename": "Brand Guidelines 2026.pdf", "size_kb": 5500, "days_ago": 8},
        {"workspace_idx": 3, "filename": "Social Media Templates.zip", "size_kb": 12000, "days_ago": 12},
        
        # Engineering Handoffs workspace
        {"workspace_idx": 4, "filename": "Mobile App Spec v1.2.pdf", "size_kb": 980, "days_ago": 4},
        {"workspace_idx": 4, "filename": "API Integration Requirements.md", "size_kb": 75, "days_ago": 6},
    ]
    
    for doc_data in documents_data:
        workspace = workspaces[doc_data["workspace_idx"]]
        created_time = datetime.now(timezone.utc) - timedelta(days=doc_data["days_ago"])
        
        document = Document(
            filename=doc_data["filename"],
            workspace_id=workspace.id,
            uploaded_by=user.id,
            size_bytes=doc_data["size_kb"] * 1024,  # Convert to bytes
            mime_type=get_mime_type(doc_data["filename"]),
            storage_uri=f"s3://documents/{workspace.id}/{doc_data['filename']}",
            created_at=created_time,
            status="uploaded"
        )
        db.add(document)
        print(f"  ✓ {document.filename} ({doc_data['size_kb']} KB)")
    
    db.commit()


def create_audit_logs(db: Session, user: User, workspaces: list):
    """Create recent activity audit logs"""
    print("\nCreating audit logs (recent activity)...")
    
    activities = [
        {"action": "document.uploaded", "object_type": "document", "days_ago": 0, "hours_ago": 2},
        {"action": "workspace.accessed", "object_type": "workspace", "days_ago": 0, "hours_ago": 3},
        {"action": "document.viewed", "object_type": "document", "days_ago": 0, "hours_ago": 5},
        {"action": "user.login", "object_type": "user", "days_ago": 1, "hours_ago": 0},
        {"action": "document.downloaded", "object_type": "document", "days_ago": 1, "hours_ago": 4},
        {"action": "workspace.updated", "object_type": "workspace", "days_ago": 2, "hours_ago": 0},
    ]
    
    for activity in activities:
        timestamp = datetime.now(timezone.utc) - timedelta(days=activity["days_ago"], hours=activity["hours_ago"])
        log = AuditLog(
            actor_user_id=user.id,
            tenant_id=user.tenant_id,
            action=activity["action"],
            object_type=activity["object_type"],
            object_id=workspaces[0].id,  # Reference first workspace
            created_at=timestamp,
            metadata_json={"source": "web_app"}
        )
        db.add(log)
        print(f"  ✓ {activity['action']} ({activity['days_ago']}d {activity['hours_ago']}h ago)")
    
    db.commit()


def get_mime_type(filename: str) -> str:
    """Get MIME type based on file extension"""
    ext = filename.split('.')[-1].lower()
    mime_types = {
        'pdf': 'application/pdf',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'txt': 'text/plain',
        'md': 'text/markdown',
        'fig': 'application/octet-stream',
        'zip': 'application/zip',
    }
    return mime_types.get(ext, 'application/octet-stream')


def create_messages(db: Session, user: User, workspaces: list[Workspace]):
    """Create sample chat messages in workspaces"""
    print("\nCreating messages...")
    
    messages_data = [
        {"workspace_idx": 0, "content": "Hey team! Just uploaded the new design mockups to the workspace.", "hours_ago": 2},
        {"workspace_idx": 0, "content": "Thanks! I'll review them this afternoon.", "hours_ago": 2},
        {"workspace_idx": 0, "content": "Looks great! Love the new color palette.", "hours_ago": 1},
        {"workspace_idx": 1, "content": "Q1 roadmap is ready for review. Please check the timeline.", "hours_ago": 5},
        {"workspace_idx": 1, "content": "Reviewed - looks solid. Approved!", "hours_ago": 4},
        {"workspace_idx": 2, "content": "New user research data uploaded. Key insights in the summary.", "hours_ago": 24},
        {"workspace_idx": 3, "content": "Updated brand guidelines are now available.", "hours_ago": 48},
        {"workspace_idx": 4, "content": "Engineering handoff document is complete. Ready for dev review.", "hours_ago": 3},
    ]
    
    for msg_data in messages_data:
        created_at = datetime.now(timezone.utc) - timedelta(hours=msg_data["hours_ago"])
        message = Message(
            workspace_id=workspaces[msg_data["workspace_idx"]].id,
            sender_id=user.id,
            content=msg_data["content"],
            created_at=created_at,
            updated_at=created_at
        )
        db.add(message)
        print(f"  ✓ Message in {workspaces[msg_data['workspace_idx']].name} ({msg_data['hours_ago']}h ago)")
    
    db.commit()
    print(f"✓ Created {len(messages_data)} messages")


def main():
    """Main seed function"""
    print("=" * 60)
    print("SEEDING DATABASE WITH TEST DATA")
    print("=" * 60)
    
    db = SessionLocal()
    try:
        # Clear and create fresh data
        clear_existing_data(db)
        tenant = create_tenant(db)
        user = create_user(db, tenant)
        workspaces = create_workspaces(db, user)
        create_documents(db, user, workspaces)
        create_audit_logs(db, user, workspaces)
        create_messages(db, user, workspaces)
        
        print("\n" + "=" * 60)
        print("✓ SEEDING COMPLETED SUCCESSFULLY!")
        print("=" * 60)
        print("\nLogin credentials:")
        print("  Email:    moira.rose@figma.com")
        print("  Password: FigmaProject2024!")
        print("\nStatistics:")
        print(f"  Workspaces: {len(workspaces)}")
        print(f"  Messages:   8")
        print(f"  Documents:  13")
        print(f"  Tenant:     Figma")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n✗ Error during seeding: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
