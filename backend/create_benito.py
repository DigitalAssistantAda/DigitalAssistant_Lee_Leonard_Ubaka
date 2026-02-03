from database import SessionLocal
from models import User, Workspace, WorkspaceMember, Tenant, Document
from utils.auth import get_password_hash
from datetime import datetime, timedelta
import random

db = SessionLocal()

# Show existing users
users = db.query(User).all()
print('=== EXISTING USERS ===')
for u in users:
    print(f'ID: {u.id}, Username: {u.username}, Email: {u.email}, Tenant ID: {u.tenant_id}')

# Show tenants
print('\n=== EXISTING TENANTS ===')
tenants = db.query(Tenant).all()
for t in tenants:
    print(f'ID: {t.id}, Name: {t.name}')

# Create new user Benito Ocasio
print('\n=== CREATING BENITO OCASIO ===')

# Get Moira's tenant to potentially share it
moira = db.query(User).filter(User.username == 'moira.rose').first()
tenant_id = moira.tenant_id if moira else 1

# Check if user already exists
existing = db.query(User).filter(User.username == 'benito.ocasio').first()
if existing:
    print(f'User already exists: {existing.username}')
    new_user = existing
else:
    new_user = User(
        username='benito.ocasio',
        email='benito.ocasio@example.com',
        hashed_password=get_password_hash('password123'),
        tenant_id=tenant_id
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    print(f'Created user: ID={new_user.id}, Username={new_user.username}, Email={new_user.email}')

# Show all workspaces Moira is in
if moira:
    print(f'\n=== MOIRA\'S WORKSPACES ===')
    moira_memberships = db.query(WorkspaceMember).filter(WorkspaceMember.user_id == moira.id).all()
    
    for membership in moira_memberships:
        workspace = db.query(Workspace).filter(Workspace.id == membership.workspace_id).first()
        print(f'Workspace: {workspace.name} (ID: {workspace.id}) - Role: {membership.role}')
        
        # Check if Benito is already a member
        existing_membership = db.query(WorkspaceMember).filter(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == new_user.id
        ).first()
        
        if not existing_membership and membership.role in ['owner', 'admin']:
            print(f'  -> Adding Benito as member to this workspace')
            benito_member = WorkspaceMember(
                workspace_id=workspace.id,
                user_id=new_user.id,
                role='member'
            )
            db.add(benito_member)
            db.commit()
            
            # Create a couple of documents for Benito
            print(f'  -> Creating sample documents for Benito')
            
            doc1 = Document(
                workspace_id=workspace.id,
                filename='benito_research_notes.pdf',
                size_bytes=245678,
                mime_type='application/pdf',
                storage_uri=f's3://ada-docs/{workspace.id}/benito_research_notes.pdf',
                uploaded_by=new_user.id,
                status='ready'
            )
            
            doc2 = Document(
                workspace_id=workspace.id,
                filename='project_proposal_v2.docx',
                size_bytes=128945,
                mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                storage_uri=f's3://ada-docs/{workspace.id}/project_proposal_v2.docx',
                uploaded_by=new_user.id,
                status='ready'
            )
            
            db.add(doc1)
            db.add(doc2)
            db.commit()
            
            print(f'     - Created: {doc1.filename}')
            print(f'     - Created: {doc2.filename}')
            
            break

# Create a personal workspace for Benito
print('\n=== CREATING BENITO\'S PERSONAL WORKSPACE ===')
benito_workspace = Workspace(
    name='Benito\'s Research Hub',
    tenant_id=tenant_id,
    created_by=new_user.id
)
db.add(benito_workspace)
db.commit()
db.refresh(benito_workspace)

benito_workspace_member = WorkspaceMember(
    workspace_id=benito_workspace.id,
    user_id=new_user.id,
    role='owner'
)
db.add(benito_workspace_member)
db.commit()

print(f'Created workspace: {benito_workspace.name} (ID: {benito_workspace.id})')

# Add some documents to Benito's workspace
doc3 = Document(
    workspace_id=benito_workspace.id,
    filename='literature_review_2026.pdf',
    size_bytes=512340,
    mime_type='application/pdf',
    storage_uri=f's3://ada-docs/{benito_workspace.id}/literature_review_2026.pdf',
    uploaded_by=new_user.id,
    status='ready'
)

doc4 = Document(
    workspace_id=benito_workspace.id,
    filename='data_analysis_q1.xlsx',
    size_bytes=89234,
    mime_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    storage_uri=f's3://ada-docs/{benito_workspace.id}/data_analysis_q1.xlsx',
    uploaded_by=new_user.id,
    status='ready'
)

db.add(doc3)
db.add(doc4)
db.commit()

print(f'  - Created: {doc3.filename}')
print(f'  - Created: {doc4.filename}')

db.close()
print('\n✓ Benito Ocasio created successfully!')
print('\nLogin credentials:')
print('  Username: benito.ocasio')
print('  Password: password123')
