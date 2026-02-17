import logging
from typing import List

from core.authentication import get_admin_user_payload, get_current_user_payload
from core.db import AsyncSessionLocal
from core.logging_setup import log_step
from fastapi import APIRouter, Depends, HTTPException, Response, status
from models.users import User
from pydantic import BaseModel
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert

logger = logging.getLogger(__name__)


class UserResponse(BaseModel):
    id: str
    name: str | None
    email: str | None
    is_admin: bool
    language_code: str | None


class UserUpdate(BaseModel):
    name: str | None
    email: str | None


class UserAdminUpdate(BaseModel):
    is_admin: bool


class UserLanguageUpdate(BaseModel):
    language_code: str


def _to_user_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        is_admin=user.is_admin,
        language_code=user.language_code,
    )


def create_user_router() -> APIRouter:
    router = APIRouter(prefix="/api/users")
    LOG_STEP = "API-USERS"

    @router.get("/me", response_model=UserResponse)
    async def get_me(payload: dict = Depends(get_current_user_payload)):
        with log_step(LOG_STEP):
            user_id = payload.get("sub")
            if not user_id:
                raise HTTPException(status_code=401, detail="Invalid auth token payload")

            async with AsyncSessionLocal() as session:
                result = await session.execute(select(User).where(User.id == user_id))
                user = result.scalar_one_or_none()

            if not user:
                raise HTTPException(status_code=404, detail="User not found.")
            return _to_user_response(user)

    @router.put("/me/language", response_model=UserResponse)
    async def update_my_language(
        language_update: UserLanguageUpdate,
        payload: dict = Depends(get_current_user_payload),
    ):
        with log_step(LOG_STEP):
            user_id = payload.get("sub")
            if not user_id:
                raise HTTPException(status_code=401, detail="Invalid auth token payload")

            async with AsyncSessionLocal() as session:
                await session.execute(
                    update(User).where(User.id == user_id).values(language_code=language_update.language_code)
                )
                await session.commit()
                result = await session.execute(select(User).where(User.id == user_id))
                user = result.scalar_one_or_none()

            if not user:
                raise HTTPException(status_code=404, detail="User not found.")
            return _to_user_response(user)

    @router.get("/", response_model=List[UserResponse], dependencies=[Depends(get_admin_user_payload)])
    async def get_all_users():
        with log_step(LOG_STEP):
            async with AsyncSessionLocal() as session:
                result = await session.execute(select(User))
                users = result.scalars().all()
            return [_to_user_response(user) for user in users]

    @router.get("/{user_id}", response_model=UserResponse, dependencies=[Depends(get_admin_user_payload)])
    async def get_user_by_id(user_id: str):
        with log_step(LOG_STEP):
            async with AsyncSessionLocal() as session:
                result = await session.execute(select(User).where(User.id == user_id))
                user = result.scalar_one_or_none()

            if not user:
                raise HTTPException(status_code=404, detail="User not found.")
            return _to_user_response(user)

    @router.put("/{user_id}", response_model=UserResponse, dependencies=[Depends(get_admin_user_payload)])
    async def update_user(user_id: str, user_update: UserUpdate):
        with log_step(LOG_STEP):
            stmt = insert(User).values(
                id=user_id,
                name=user_update.name,
                email=user_update.email,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=[User.id],
                set_={"name": stmt.excluded.name, "email": stmt.excluded.email},
            )

            async with AsyncSessionLocal() as session:
                await session.execute(stmt)
                await session.commit()
                result = await session.execute(select(User).where(User.id == user_id))
                user = result.scalar_one_or_none()

            if not user:
                raise HTTPException(status_code=404, detail="User not found.")
            return _to_user_response(user)

    @router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(get_admin_user_payload)])
    async def delete_user(user_id: str):
        with log_step(LOG_STEP):
            async with AsyncSessionLocal() as session:
                result = await session.execute(select(User).where(User.id == user_id))
                user = result.scalar_one_or_none()
                if not user:
                    raise HTTPException(status_code=404, detail="User not found.")

                await session.execute(delete(User).where(User.id == user_id))
                await session.commit()

            return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.put("/{user_id}/admin", response_model=UserResponse, dependencies=[Depends(get_admin_user_payload)])
    async def set_user_admin_status(user_id: str, admin_update: UserAdminUpdate):
        with log_step(LOG_STEP):
            async with AsyncSessionLocal() as session:
                result = await session.execute(select(User).where(User.id == user_id))
                user = result.scalar_one_or_none()
                if not user:
                    raise HTTPException(status_code=404, detail="User not found.")

                await session.execute(
                    update(User).where(User.id == user_id).values(is_admin=admin_update.is_admin)
                )
                await session.commit()

                updated_result = await session.execute(select(User).where(User.id == user_id))
                updated_user = updated_result.scalar_one_or_none()

            if not updated_user:
                raise HTTPException(status_code=404, detail="User not found after update.")
            return _to_user_response(updated_user)

    return router
