import logging
from datetime import datetime
from typing import List

from core.authentication import (
    get_admin_user_payload,
    get_current_user_payload,
    validate_review_token,
)
from core.db import AsyncSessionLocal
from core.logging_setup import log_step
from fastapi import APIRouter, Depends, HTTPException
from models.reviews import Review
from models.users import User
from pydantic import BaseModel, Field
from sqlalchemy import select

logger = logging.getLogger(__name__)


class ReviewSubmitRequest(BaseModel):
    token: str
    rating: int = Field(ge=1, le=5)
    note: str = Field(min_length=1, max_length=2000)


class ReviewResponse(BaseModel):
    id: int
    user_id: str
    meeting_id: str | None
    rating: int
    note: str | None
    created_at: datetime


def _to_review_response(review: Review) -> ReviewResponse:
    return ReviewResponse(
        id=review.id,
        user_id=review.user_id,
        meeting_id=review.meeting_id,
        rating=review.rating,
        note=review.note,
        created_at=review.created_at,
    )

class AdminReviewResponse(BaseModel):
    id: int
    user_id: str
    user_name: str | None
    user_email: str | None
    rating: int
    note: str | None
    created_at: datetime


def create_review_router() -> APIRouter:
    router = APIRouter(prefix="/api/reviews")
    LOG_STEP = "API-REVIEWS"

    @router.post("/submit", response_model=ReviewResponse)
    async def submit_review(payload: ReviewSubmitRequest):
        with log_step(LOG_STEP):
            token_payload = validate_review_token(payload.token)
            user_id = token_payload.get("sub")
            meeting_id = token_payload.get("resource")

            if not user_id:
                raise HTTPException(status_code=401, detail="Invalid review token")

            note = payload.note.strip()
            if not note:
                raise HTTPException(status_code=422, detail="Note is required.")

            async with AsyncSessionLocal() as session:
                user_result = await session.execute(
                    select(User.id).where(User.id == user_id)
                )
                if not user_result.scalar_one_or_none():
                    raise HTTPException(status_code=404, detail="User not found.")

                review = Review(
                    user_id=user_id,
                    meeting_id=meeting_id,
                    rating=payload.rating,
                    note=note,
                )
                session.add(review)
                await session.flush()
                await session.commit()

            return _to_review_response(review)

    @router.get("/me", response_model=List[ReviewResponse])
    async def get_my_reviews(user_payload: dict = Depends(get_current_user_payload)):
        with log_step(LOG_STEP):
            user_id = user_payload.get("sub")
            if not user_id:
                raise HTTPException(status_code=401, detail="Invalid auth token payload")

            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(Review)
                    .where(Review.user_id == user_id)
                    .order_by(Review.created_at.desc())
                )
                reviews = result.scalars().all()

            return [_to_review_response(review) for review in reviews]

    @router.get("/", response_model=List[AdminReviewResponse], dependencies=[Depends(get_admin_user_payload)])
    async def get_all_reviews():
        with log_step(LOG_STEP):
            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(Review, User.name, User.email)
                    .join(User, User.id == Review.user_id, isouter=True)
                    .order_by(Review.created_at.desc())
                )
                rows = result.all()

            return [
                AdminReviewResponse(
                    id=review.id,
                    user_id=review.user_id,
                    user_name=user_name,
                    user_email=user_email,
                    rating=review.rating,
                    note=review.note,
                    created_at=review.created_at,
                )
                for review, user_name, user_email in rows
            ]

    return router
