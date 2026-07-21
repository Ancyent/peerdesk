from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from deps import get_db, get_current_user, get_current_membership
from models import Company, User, Membership
from schemas import CompanyCreate, CompanyOut

router = APIRouter(prefix="/companies", tags=["companies"])


@router.get("", response_model=list[CompanyOut])
async def list_companies(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(Company).where(Company.owner_id == user.id))
    return result.scalars().all()


@router.post("", response_model=CompanyOut, status_code=201)
async def create_company(
    body: CompanyCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    membership: Membership = Depends(get_current_membership),
):
    # account_id is stamped here (ahead of this router's own Task 7 migration)
    # because machines.py's placement handler already validates placement
    # targets by Company.account_id — without this, every company created
    # after Task 6 would be unplaceable. Task 7 still owns this router's own
    # read/update/delete authorization (owner_id, below), unchanged here.
    company = Company(name=body.name, owner_id=user.id, account_id=membership.account_id)
    db.add(company)
    await db.commit()
    await db.refresh(company)
    return company


@router.patch("/{company_id}", response_model=CompanyOut)
async def update_company(company_id: str, body: CompanyCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(Company).where(Company.id == company_id, Company.owner_id == user.id))
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(404, "Company not found")
    company.name = body.name
    await db.commit()
    await db.refresh(company)
    return company


@router.delete("/{company_id}", status_code=204)
async def delete_company(company_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(Company).where(Company.id == company_id, Company.owner_id == user.id))
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(404, "Company not found")
    await db.delete(company)
    await db.commit()
