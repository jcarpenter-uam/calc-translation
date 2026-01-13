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

LOG_STEP = "EMAIL"


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
        with log_step(LOG_STEP):
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
        Iterates through attendees, finds their localized summary and transcript,
        and emails them.
        """
        if not attendees:
            return

        with log_step(LOG_STEP):
            safe_session_id = urllib.parse.quote(session_id, safe="")
            output_dir = os.path.join("output", integration, safe_session_id)

            logger.info(
                f"Distributing transcripts and summaries to {len(attendees)} attendees for session {session_id}..."
            )

            loop = asyncio.get_running_loop()
            tasks = []

            for row in attendees:
                email = row.get("email")
                pref_lang = row.get("language_code") or "en"

                if not email:
                    continue

                vtt_filename = f"transcript_{pref_lang}.vtt"
                vtt_path = os.path.join(output_dir, vtt_filename)
                final_lang = pref_lang

                if not os.path.exists(vtt_path):
                    vtt_filename = "transcript_en.vtt"
                    vtt_path = os.path.join(output_dir, vtt_filename)
                    final_lang = "en"

                summary_filename = f"summary_{pref_lang}.txt"
                summary_path = os.path.join(output_dir, summary_filename)

                if not os.path.exists(summary_path):
                    summary_path = os.path.join(output_dir, "summary_en.txt")

                summary_content = "<p><i>No summary available.</i></p>"

                if os.path.exists(summary_path):
                    try:
                        with open(summary_path, "r", encoding="utf-8") as f:
                            raw_summary = f.read()
                        summary_content = raw_summary.replace("\n", "<br>")
                    except Exception as e:
                        logger.warning(
                            f"Failed to read summary file {summary_path}: {e}"
                        )

                if os.path.exists(vtt_path):
                    subject = f"Summary & Transcript: Meeting {session_id}"
                    body = f"""
                    <html>
                    <body style="font-family: Arial, sans-serif; color: #333;">
                        <div style="background-color: #f4f4f4; padding: 20px;">
                            <div style="background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                                <h2 style="color: #2c3e50; margin-top: 0;">Meeting Summary</h2>
                                <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #007bff; margin: 15px 0;">
                                    {summary_content}
                                </div>
                                
                                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                                
                                <p>Hello,</p>
                                <p>Attached is the full transcript for <strong>Meeting {session_id}</strong>.</p>
                                <p><strong>Language:</strong> {final_lang.upper()}</p>
                                <br>
                                <p style="font-size: 12px; color: #888; text-align: center;">
                                    Sent by Calc-Translation Automation
                                </p>
                            </div>
                        </div>
                    </body>
                    </html>
                    """

                    task = loop.run_in_executor(
                        None,
                        self._send_sync,
                        email,
                        subject,
                        body,
                        vtt_path,
                        vtt_filename,
                    )
                    tasks.append(task)
                else:
                    logger.warning(
                        f"No transcript found for {email} (checked {pref_lang} & en). Skipping email."
                    )

            if tasks:
                await asyncio.gather(*tasks)
                logger.info(f"Finished sending {len(tasks)} emails.")
