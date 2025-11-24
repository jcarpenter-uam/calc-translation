import logging

import core.database as database
from core.config import settings
from core.database import SQL_GET_USER_BY_ID
from core.security import get_current_user_payload
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class UserResponse(BaseModel):
    id: str
    name: str | None
    email: str | None


def create_user_router() -> APIRouter:
    """
    Creates the REST API router for users.
    """
    router = APIRouter(
        prefix="/api/users",
    )

    @router.get("/me", response_model=UserResponse)
    async def get_me(payload: dict = Depends(get_current_user_payload)):
        """
        Get the profile for the currently authenticated user
        based on their 'app_auth_token' cookie.
        """
        user_id = payload.get("resource")
        if not user_id:
            logger.warning("Auth token missing 'resource' (user_id) claim.")
            raise HTTPException(status_code=401, detail="Invalid auth token payload")

        if not database.DB_POOL:
            raise HTTPException(status_code=503, detail="Database not initialized.")

        async with database.DB_POOL.acquire() as conn:
            user_row = await conn.fetchrow(SQL_GET_USER_BY_ID, user_id)

        if not user_row:
            logger.error(f"Authenticated user {user_id} not found in DB.")
            raise HTTPException(status_code=404, detail="User not found.")

        return UserResponse(**dict(user_row))

    return router
