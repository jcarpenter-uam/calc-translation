import logging
from typing import List

import core.database as database
from core.authentication import get_admin_user_payload, get_current_user_payload
from core.database import (
    SQL_DELETE_USER_BY_ID,
    SQL_GET_ALL_USERS,
    SQL_GET_USER_BY_ID,
    SQL_SET_USER_ADMIN_STATUS,
    SQL_UPSERT_USER,
)
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class UserResponse(BaseModel):
    id: str
    name: str | None
    email: str | None
    is_admin: bool


class UserUpdate(BaseModel):
    name: str | None
    email: str | None


class UserAdminUpdate(BaseModel):
    is_admin: bool


def create_user_router() -> APIRouter:
    """
    Creates the REST API router for users.
    """
    router = APIRouter(
        prefix="/api/users",
    )

    # NOTE: Requires User Auth
    @router.get("/me", response_model=UserResponse)
    async def get_me(payload: dict = Depends(get_current_user_payload)):
        """
        Get the profile for the currently authenticated user
        based on their 'app_auth_token' cookie.
        """
        user_id = payload.get("sub")
        if not user_id:
            logger.warning("Auth token missing 'sub' (user_id) claim.")
            raise HTTPException(status_code=401, detail="Invalid auth token payload")

        if not database.DB_POOL:
            raise HTTPException(status_code=503, detail="Database not initialized.")

        async with database.DB_POOL.acquire() as conn:
            user_row = await conn.fetchrow(SQL_GET_USER_BY_ID, user_id)

        if not user_row:
            logger.error(f"Authenticated user {user_id} not found in DB.")
            raise HTTPException(status_code=404, detail="User not found.")

        return UserResponse(**dict(user_row))

    # NOTE: Admin only
    @router.get(
        "/",
        response_model=List[UserResponse],
        dependencies=[Depends(get_admin_user_payload)],
    )
    async def get_all_users():
        """
        Get a list of all users.
        """
        if not database.DB_POOL:
            raise HTTPException(status_code=503, detail="Database not initialized.")

        async with database.DB_POOL.acquire() as conn:
            user_rows = await conn.fetch(SQL_GET_ALL_USERS)

        return [UserResponse(**dict(row)) for row in user_rows]

    # NOTE: Admin only
    @router.get(
        "/{user_id}",
        response_model=UserResponse,
        dependencies=[Depends(get_admin_user_payload)],
    )
    async def get_user_by_id(
        user_id: str,
    ):
        """
        Get a specific user by their ID.
        """
        if not database.DB_POOL:
            raise HTTPException(status_code=503, detail="Database not initialized.")

        async with database.DB_POOL.acquire() as conn:
            user_row = await conn.fetchrow(SQL_GET_USER_BY_ID, user_id)

        if not user_row:
            raise HTTPException(status_code=404, detail="User not found.")

        return UserResponse(**dict(user_row))

    # NOTE: Admin only
    @router.put(
        "/{user_id}",
        response_model=UserResponse,
        dependencies=[Depends(get_admin_user_payload)],
    )
    async def update_user(
        user_id: str,
        user_update: UserUpdate,
    ):
        """
        Update a user's details by their ID.
        Uses UPSERT logic: will create if not present, or update if present.
        """
        if not database.DB_POOL:
            raise HTTPException(status_code=503, detail="Database not initialized.")

        async with database.DB_POOL.acquire() as conn:
            await conn.execute(
                SQL_UPSERT_USER, user_id, user_update.name, user_update.email
            )

        return UserResponse(id=user_id, **user_update.dict())

    # NOTE: Admin only
    @router.delete(
        "/{user_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        dependencies=[Depends(get_admin_user_payload)],
    )
    async def delete_user(
        user_id: str,
    ):
        """
        Delete a user by their ID.
        """
        if not database.DB_POOL:
            raise HTTPException(status_code=503, detail="Database not initialized.")

        async with database.DB_POOL.acquire() as conn:
            user_row = await conn.fetchrow(SQL_GET_USER_BY_ID, user_id)
            if not user_row:
                raise HTTPException(status_code=44, detail="User not found.")

            await conn.execute(SQL_DELETE_USER_BY_ID, user_id)

        return Response(status_code=status.HTTP_204_NO_CONTENT)

    # NOTE: Admin only
    @router.put(
        "/{user_id}/admin",
        response_model=UserResponse,
        dependencies=[Depends(get_admin_user_payload)],
    )
    async def set_user_admin_status(
        user_id: str,
        admin_update: UserAdminUpdate,
    ):
        """
        Update a user's admin status. (Admin Only)
        """
        if not database.DB_POOL:
            raise HTTPException(status_code=503, detail="Database not initialized.")

        async with database.DB_POOL.acquire() as conn:
            user_row = await conn.fetchrow(SQL_GET_USER_BY_ID, user_id)
            if not user_row:
                raise HTTPException(status_code=404, detail="User not found.")

            await conn.execute(
                SQL_SET_USER_ADMIN_STATUS, admin_update.is_admin, user_id
            )

            updated_user_row = await conn.fetchrow(SQL_GET_USER_BY_ID, user_id)

        if not updated_user_row:
            raise HTTPException(status_code=404, detail="User not found after update.")

        return UserResponse(**dict(updated_user_row))

    return router
