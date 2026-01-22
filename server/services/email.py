import asyncio
import base64
import logging
import os
import urllib.parse
from datetime import datetime

import httpx
import msal
from core.config import settings
from core.logging_setup import log_step

logger = logging.getLogger(__name__)

LOG_STEP = "EMAIL"


class EmailService:
    def __init__(self):
        self.client_id = settings.MAILER_CLIENT_ID
        self.client_secret = settings.MAILER_CLIENT_SECRET
        self.tenant_id = settings.MAILER_TENANT_ID
        self.sender_email = settings.MAILER_SENDER_EMAIL

        self.authority = f"https://login.microsoftonline.com/{self.tenant_id}"
        self.scope = ["https://graph.microsoft.com/.default"]

        self.logo_url = "https://github.com/jcarpenter-uam/calc-translation/raw/master/clients/web/public/icon.png"
        self.website_url = settings.APP_BASE_URL

        self.app = msal.ConfidentialClientApplication(
            self.client_id,
            authority=self.authority,
            client_credential=self.client_secret,
        )

    def _get_access_token(self):
        """
        Acquires a token for the Graph API using Client Credentials.
        """
        result = self.app.acquire_token_silent(self.scope, account=None)

        if not result:
            result = self.app.acquire_token_for_client(scopes=self.scope)

        if "access_token" in result:
            return result["access_token"]
        else:
            error = result.get("error")
            desc = result.get("error_description")
            raise Exception(f"Could not acquire token: {error} - {desc}")

    async def _send_graph_email(
        self,
        to_email: str,
        subject: str,
        body_html: str,
        attachment_path: str = None,
        attachment_name: str = None,
    ):
        """
        Async function to send email via Microsoft Graph API.
        """
        with log_step(LOG_STEP):
            try:
                token = self._get_access_token()
                endpoint = f"https://graph.microsoft.com/v1.0/users/{self.sender_email}/sendMail"

                message = {
                    "subject": subject,
                    "body": {"contentType": "HTML", "content": body_html},
                    "toRecipients": [{"emailAddress": {"address": to_email}}],
                }

                if attachment_path and os.path.exists(attachment_path):
                    try:
                        with open(attachment_path, "rb") as f:
                            file_content = f.read()

                        content_bytes = base64.b64encode(file_content).decode("utf-8")

                        message["attachments"] = [
                            {
                                "@odata.type": "#microsoft.graph.fileAttachment",
                                "name": attachment_name,
                                "contentType": "text/vtt",
                                "contentBytes": content_bytes,
                            }
                        ]
                    except Exception as e:
                        logger.error(
                            f"Failed to process attachment {attachment_path}: {e}"
                        )

                payload = {"message": message, "saveToSentItems": False}

                headers = {
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                }

                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        endpoint, json=payload, headers=headers
                    )

                    if response.status_code == 202:
                        return True
                    else:
                        logger.error(
                            f"Graph API Error ({response.status_code}): {response.text}"
                        )
                        return False

            except Exception as e:
                logger.exception(f"CRITICAL FAILURE sending to {to_email}")
                return False

    async def send_session_transcripts(
        self, session_id: str, integration: str, attendees: list
    ):
        """
        Iterates through attendees and emails them using the Graph API.
        """
        if not attendees:
            return

        with log_step(LOG_STEP):
            safe_session_id = urllib.parse.quote(session_id, safe="")
            output_dir = os.path.join("output", integration, safe_session_id)
            meeting_date = datetime.now().strftime("%B %d, %Y")

            logger.info(
                f"Distributing transcripts to {len(attendees)} attendees via Graph API..."
            )

            tasks = []

            for row in attendees:
                email = row.get("email")
                pref_lang = row.get("language_code") or "en"

                if not email:
                    continue

                vtt_filename = f"transcript_{pref_lang}.vtt"
                vtt_path = os.path.join(output_dir, vtt_filename)
                if not os.path.exists(vtt_path):
                    vtt_filename = "transcript_en.vtt"
                    vtt_path = os.path.join(output_dir, vtt_filename)

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
                        logger.warning(f"Failed to read summary file: {e}")

                if os.path.exists(vtt_path):
                    subject = f"Summary & Transcript: {meeting_date}"

                    body = f"""
                    <html>
                    <body style="font-family: Arial, sans-serif; color: #333;">
                        <div style="background-color: #f4f4f4; padding: 20px;">
                            <div style="background-color: #ffffff; padding: 20px; border-radius: 8px;">
                                <div style="text-align: center; margin-bottom: 30px;">
                                    <a href="{self.website_url}">
                                        <img src="{self.logo_url}" alt="Logo" style="max-width: 150px;">
                                    </a>
                                </div>
                                <p>Attached is the transcript for your meeting on <strong>{meeting_date}</strong>.</p>
                                <h2 style="color: #2c3e50;">Meeting Summary</h2>
                                <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #007bff;">
                                    {summary_content}
                                </div>
                                <br>
                                <div style="text-align: center;">
                                    <a href="{self.website_url}">Visit Calc-Translation</a>
                                </div>
                            </div>
                        </div>
                    </body>
                    </html>
                    """

                    tasks.append(
                        self._send_graph_email(
                            email,
                            subject,
                            body,
                            vtt_path,
                            vtt_filename,
                        )
                    )
                else:
                    logger.warning(f"No transcript found for {email}. Skipping.")

            if tasks:
                await asyncio.gather(*tasks)
                logger.info(f"Finished sending {len(tasks)} emails via Graph.")
