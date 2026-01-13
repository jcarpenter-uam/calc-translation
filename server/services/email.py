import asyncio
import logging
import os
import smtplib
import urllib.parse
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from core.config import settings
from core.logging_setup import log_step

logger = logging.getLogger(__name__)


class EmailService:
    def __init__(self):
        self.smtp_host = settings.SMTP_HOST
        self.smtp_port = settings.SMTP_PORT
        self.smtp_user = settings.SMTP_USER
        self.smtp_password = settings.SMTP_PASSWORD
        self.sender_email = settings.SYSTEM_MAILER_EMAIL or self.smtp_user

    def _send_sync(
        self,
        to_email: str,
        subject: str,
        body_html: str,
        attachment_path: str = None,
        attachment_name: str = None,
    ):
        """
        Blocking SMTP function to be run in a separate thread.
        """
        try:
            msg = MIMEMultipart()
            msg["From"] = self.sender_email
            msg["To"] = to_email
            msg["Subject"] = subject

            msg.attach(MIMEText(body_html, "html"))

            if attachment_path and os.path.exists(attachment_path):
                try:
                    with open(attachment_path, "rb") as f:
                        part = MIMEBase("application", "octet-stream")
                        part.set_payload(f.read())

                    encoders.encode_base64(part)
                    part.add_header(
                        "Content-Disposition",
                        f'attachment; filename="{attachment_name}"',
                    )
                    msg.attach(part)
                except Exception as e:
                    logger.error(f"Failed to attach file {attachment_path}: {e}")

            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.send_message(msg)

            return True

        except Exception as e:
            logger.error(f"SMTP Error sending to {to_email}: {e}")
            return False

    async def send_session_transcripts(
        self, session_id: str, integration: str, attendees: list
    ):
        """
        Iterates through attendees, finds their localized transcript, and emails them.
        """
        if not attendees:
            return

        with log_step("EMAIL-SERVICE"):
            safe_session_id = urllib.parse.quote(session_id, safe="")
            output_dir = os.path.join("output", integration, safe_session_id)

            logger.info(
                f"Distributing transcripts to {len(attendees)} attendees for session {session_id}..."
            )

            loop = asyncio.get_running_loop()
            tasks = []

            for row in attendees:
                email = row.get("email")
                pref_lang = row.get("language_code") or "en"

                if not email:
                    continue

                filename = f"transcript_{pref_lang}.vtt"
                target_file = os.path.join(output_dir, filename)

                if not os.path.exists(target_file):
                    filename = "transcript_en.vtt"
                    target_file = os.path.join(output_dir, filename)
                    pref_lang = "en"

                if os.path.exists(target_file):
                    subject = f"Transcript: Meeting {session_id}"
                    body = f"""
                    <html>
                    <body style="font-family: Arial, sans-serif;">
                        <p>Thank you for using our app,</p>
                        <p>Attached is the transcript for your previous meeting.</p>
                        <p>Language: {pref_lang.upper()}</p>
                        <br>
                        <p style="font-size: 12px; color: #888;">
                            Sent by Calc-Translation Automation
                        </p>
                    </body>
                    </html>
                    """

                    task = loop.run_in_executor(
                        None,
                        self._send_sync,
                        email,
                        subject,
                        body,
                        target_file,
                        filename,
                    )
                    tasks.append(task)
                else:
                    logger.warning(
                        f"No transcript found for {email} (checked {pref_lang} & en)."
                    )

            if tasks:
                await asyncio.gather(*tasks)
                logger.info(f"Finished sending {len(tasks)} emails.")
