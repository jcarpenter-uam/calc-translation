import contextvars
import logging
import os
import re
import sys
from contextlib import contextmanager
from datetime import datetime
from typing import Optional

from .config import settings

message_id_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "message_id_var", default=None
)
speaker_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "speaker_var", default=None
)
session_id_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "session_id_var", default=None
)
step_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "step_var", default="APP"
)

LOG_LEVELS = {"DEBUG": logging.DEBUG, "INFO": logging.INFO, "ERROR": logging.ERROR}

URL_REGEX = re.compile(r'https?://[^/]+(/[^"\'\s<]*)?')


def redact_url(message: str) -> str:
    """Finds URLs in a log message and replaces them with just the path."""

    def replacer(match):
        path = match.group(1)
        return path if path else "/"

    return URL_REGEX.sub(replacer, message)


class CustomFormatter(logging.Formatter):
    """
    A custom formatter that injects context variables into the log prefix.
    """

    base_format = "[%(asctime)s.%(msecs)03d][%(levelname)s] [%(step)s]"

    def format(self, record):
        record.step = step_var.get()
        log_format = self.base_format

        if speaker := speaker_var.get():
            log_format += f" [speaker={speaker}]"
        if message_id := message_id_var.get():
            log_format += f" [message_id={message_id}]"
        if session_id := session_id_var.get():
            log_format += f" [session={session_id}]"

        log_format += " %(message)s"

        temp_formatter = logging.Formatter(log_format, datefmt="%Y-%m-%dT%H:%M:%S")

        if record.exc_info:
            record.exc_text = temp_formatter.formatException(record.exc_info)

        formatted_message = temp_formatter.format(record)

        redacted_message = redact_url(formatted_message)

        return redacted_message


def setup_logging():
    """
    Configures the root logger for the application.
    """
    level_str = settings.LOGGING_LEVEL.upper()
    log_level = LOG_LEVELS.get(level_str, logging.INFO)

    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setLevel(log_level)
    stdout_handler.addFilter(lambda record: record.levelno < logging.ERROR)
    stdout_handler.setFormatter(CustomFormatter())

    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setLevel(logging.ERROR)
    stderr_handler.setFormatter(CustomFormatter())

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.DEBUG)

    if root_logger.hasHandlers():
        root_logger.handlers.clear()

    root_logger.addHandler(stdout_handler)
    root_logger.addHandler(stderr_handler)


@contextmanager
def log_step(name: str):
    """Context manager to set the 'step' for all logs within it."""
    token = step_var.set(name)
    try:
        yield
    finally:
        step_var.reset(token)


def add_session_log_handler(
    session_id: str, integration: str
) -> Optional[logging.FileHandler]:
    """
    Dynamically adds a file log handler for a specific session.
    """
    try:
        logs_dir = os.path.join("logs", integration)
        os.makedirs(logs_dir, exist_ok=True)

        date_str = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        log_file = os.path.join(logs_dir, f"{session_id}_{date_str}.log")

        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setLevel(logging.INFO)
        file_handler.setFormatter(CustomFormatter())

        logging.getLogger().addHandler(file_handler)

        return file_handler
    except Exception as e:
        logging.error(
            f"[SYSTEM] Failed to create log file handler for session {session_id}: {e}"
        )
        return None


def remove_session_log_handler(handler: logging.FileHandler):
    """
    Removes and closes a specific file log handler.
    """
    if handler:
        try:
            handler.close()
            logging.getLogger().removeHandler(handler)
        except Exception as e:
            logging.error(f"[SYSTEM] Failed to remove log file handler: {e}")
