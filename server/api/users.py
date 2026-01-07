import logging
from typing import List

import core.database as database
from core.authentication import get_admin_user_payload, get_current_user_payload
from core.database import (
    SQL_DELETE_USER_BY_ID,
    SQL_GET_ALL_USERS,
    SQL_GET_USER_BY_ID,
    SQL_SET_USER_ADMIN_STATUS,
    SQL_UPDATE_USER_LANGUAGE,
    SQL_UPSERT_USER,
)
from core.logging_setup import log_step
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel

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


def create_user_router() -> APIRouter:
    """
    Creates the REST API router for users.
    """
    router = APIRouter(
        prefix="/api/users",
    )
    LOG_STEP = "API-USERS"

    # NOTE: Requires User Auth
    @router.get("/me", response_model=UserResponse)
    async def get_me(payload: dict = Depends(get_current_user_payload)):
        """
        Get the profile for the currently authenticated user
        based on their 'app_auth_token' cookie.
        """
        with log_step(LOG_STEP):
            user_id = payload.get("sub")
            if not user_id:
                logger.warning("Auth token missing 'sub' (user_id) claim.")
                raise HTTPException(
                    status_code=401, detail="Invalid auth token payload"
                )

            if not database.DB_POOL:
                logger.error(
                    f"Database not initialized during get_me for user: {user_id}"
                )
                raise HTTPException(status_code=503, detail="Database not initialized.")

            async with database.DB_POOL.acquire() as conn:
                user_row = await conn.fetchrow(SQL_GET_USER_BY_ID, user_id)

            if not user_row:
                logger.error(f"Authenticated user {user_id} not found in DB.")
                raise HTTPException(status_code=404, detail="User not found.")

            logger.debug(f"Successfully retrieved profile for user: {user_id}")
            return UserResponse(**dict(user_row))

    # NOTE: Requires User Auth
    @router.put("/me/language", response_model=UserResponse)
    async def update_my_language(
        language_update: UserLanguageUpdate,
        payload: dict = Depends(get_current_user_payload),
    ):
        """
        Updates the preferred language for the currently authenticated user.
        """
        with log_step(LOG_STEP):
            user_id = payload.get("sub")
            if not user_id:
                logger.warning("Auth token missing 'sub' (user_id) claim.")
                raise HTTPException(
                    status_code=401, detail="Invalid auth token payload"
                )

            new_lang = language_update.language_code
            logger.debug(
                f"Request to update language for user {user_id} to '{new_lang}'"
            )

            if not database.DB_POOL:
                logger.error("Database not initialized during language update.")
                raise HTTPException(status_code=503, detail="Database not initialized.")

            async with database.DB_POOL.acquire() as conn:
                await conn.execute(SQL_UPDATE_USER_LANGUAGE, new_lang, user_id)

                user_row = await conn.fetchrow(SQL_GET_USER_BY_ID, user_id)

            if not user_row:
                logger.error(f"User {user_id} not found after language update.")
                raise HTTPException(status_code=404, detail="User not found.")

            logger.info(f"Successfully updated language for user: {user_id}")
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
        with log_step(LOG_STEP):
            if not database.DB_POOL:
                logger.error("Database not initialized during get_all_users.")
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
        with log_step(LOG_STEP):
            if not database.DB_POOL:
                logger.error(
                    f"Database not initialized during get_user_by_id: {user_id}"
                )
                raise HTTPException(status_code=503, detail="Database not initialized.")

            async with database.DB_POOL.acquire() as conn:
                user_row = await conn.fetchrow(SQL_GET_USER_BY_ID, user_id)

            if not user_row:
                logger.warning(f"User not found: {user_id}")
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
        with log_step(LOG_STEP):
            logger.debug(f"Request to update/create user: {user_id}")
            if not database.DB_POOL:
                logger.error(f"Database not initialized during update_user: {user_id}")
                raise HTTPException(status_code=503, detail="Database not initialized.")

            async with database.DB_POOL.acquire() as conn:
                await conn.execute(
                    SQL_UPSERT_USER, user_id, user_update.name, user_update.email
                )

            return UserResponse(id=user_id, is_admin=False, **user_update.dict())

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
        with log_step(LOG_STEP):
            logger.debug(f"Request to delete user: {user_id}")
            if not database.DB_POOL:
                logger.error(f"Database not initialized during delete_user: {user_id}")
                raise HTTPException(status_code=503, detail="Database not initialized.")

            async with database.DB_POOL.acquire() as conn:
                user_row = await conn.fetchrow(SQL_GET_USER_BY_ID, user_id)
                if not user_row:
                    logger.warning(f"User not found for deletion: {user_id}")
                    raise HTTPException(status_code=404, detail="User not found.")

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
        with log_step(LOG_STEP):
            logger.debug(
                f"Request to set admin status for user: {user_id} to {admin_update.is_admin}"
            )
            if not database.DB_POOL:
                logger.error(
                    f"Database not initialized during set_user_admin_status: {user_id}"
                )
                raise HTTPException(status_code=503, detail="Database not initialized.")

            async with database.DB_POOL.acquire() as conn:
                user_row = await conn.fetchrow(SQL_GET_USER_BY_ID, user_id)
                if not user_row:
                    logger.warning(
                        f"User not found while setting admin status: {user_id}"
                    )
                    raise HTTPException(status_code=404, detail="User not found.")

                await conn.execute(
                    SQL_SET_USER_ADMIN_STATUS, admin_update.is_admin, user_id
                )

                updated_user_row = await conn.fetchrow(SQL_GET_USER_BY_ID, user_id)

            if not updated_user_row:
                logger.error(f"User not found after admin status update: {user_id}")
                raise HTTPException(
                    status_code=404, detail="User not found after update."
                )

            return UserResponse(**dict(updated_user_row))

    return router
